# Plan de transformation — TicketPro ultra fonctionnel

## 1. Mission

Transformer TicketPro d’un prototype desktop riche en interface en une application réellement exploitable au quotidien par un gestionnaire de hotspots MikroTik.

L’application devra être fiable hors ligne, persistante, sécurisée, connectée aux routeurs réels, utilisable par plusieurs profils internes et capable de conserver l’historique complet des opérations.

Ce document est la feuille de route de référence du projet. Chaque phase doit être terminée, testée et validée avant de considérer la fonctionnalité comme opérationnelle.

## État d’avancement

| Phase | État |
| --- | --- |
| Phase 0 — Socle, inventaire et protection de l’existant | Socle terminé |
| Phase 1 — Persistance SQLite et source de vérité unique | Socle SQLite et réconciliation principale terminés |
| Phase 2 — Authentification, profils et sécurité réelle | Connexion Tauri vérifiée depuis SQLite, profils et mots de passe persistants — durcissement final à poursuivre |
| Phase 3 — Gestion réelle des routeurs | Connexions réelles et TLS implémentés |
| Phase 4 — Plans Hotspot et synchronisation RouterOS | Synchronisation, import et conflits implémentés |
| Phase 5 — Génération et synchronisation des tickets | Génération réelle et reprise anti-doublon implémentées |
| Phase 6 — PDF, fichiers et impression | Implémentée — validation sur imprimante réelle à faire |
| Phase 7 — Monitoring et snapshots | Implémentée — validation routeur réel à faire |
| Phase 8 — Rapports, logs et audit métier | Rapports PDF/CSV et logs persistants implémentés — audit à finaliser |
| Phase 9 — Abonnement et facturation | Implémentée — abonnement et factures persistants dans SQLite Tauri |
| Phase 10 — Compte principal et profils internes | Coordonnées, mot de passe, premier lancement et gestion des profils raccordés à SQLite |
| Phase 11 — Paramètres, audit et livraison | Paramètres avancés implémentés — validation imprimante/routeur et livraison à finaliser |

Les décisions d’architecture et l’inventaire des sources sont documentés dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) et [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md).

Le socle documentaire et le garde-fou runtime sont terminés. L’isolation complète des fixtures sera clôturée avec le raccordement de chaque écran à sa source persistante, afin de ne pas déplacer des données de démonstration sans remplacer leur alimentation.

La base applicative partagée est maintenant en place et le parcours Routeurs lit, crée et modifie les routeurs dans SQLite Tauri. Les connexions locales/distantes sont également persistées. Les écrans Plans, Tickets et Génération de tickets lisent et écrivent désormais SQLite ; un lot et ses tickets sont créés dans une transaction. La génération persistante crée maintenant les utilisateurs Hotspot sur le MikroTik réel ticket par ticket, conserve les succès, marque les échecs reprenables et vérifie après erreur si un ticket a déjà été créé afin d’éviter les doublons. Les opérations de plans et de resynchronisation des tickets utilisent le service MikroTik réel en Tauri. Les tickets présents uniquement sur le routeur peuvent être importés, les conflits de plan peuvent être résolus vers le plan local, les statuts distants sont reportés localement et les suppressions sont propagées au routeur. L’API-SSL est activée côté Rust avec TLS natif. Les PDF sont maintenant écrits dans l’espace de fichiers Tauri, archivés dans SQLite, ouvrables depuis Fichiers et imprimables via l’intégration Windows native. Le monitoring et les clients connectés utilisent maintenant le routeur persistant en Tauri, avec cache hors ligne, snapshots et journaux SQLite. Les rapports sont désormais chargés depuis les tickets SQLite et exportables en CSV UTF-8 ou PDF réel, archivés dans Fichiers. L’abonnement et les factures sont maintenant rattachés au compte SQLite en Tauri, avec changement de pack, paiement manuel, création et changement de statut des factures, ainsi qu’export PDF local. Le compte principal, le premier lancement et les profils internes utilisent désormais SQLite en Tauri pour la vérification et les mutations. Les paramètres avancés sont persistants dans app_settings, le timeout de session est resynchronisé au démarrage et les sauvegardes/restaurations SQLite sont opérables depuis l’interface Admin. La prochaine étape est la validation terrain sur routeur et imprimante réels.

## 2. Vision produit

TicketPro doit permettre à un administrateur ou opérateur de :

- configurer son entreprise et ses profils internes ;
- enregistrer, tester et administrer plusieurs routeurs MikroTik ;
- créer les plans Hotspot réellement présents sur les routeurs ;
- générer des tickets localement et les créer sur MikroTik ;
- conserver les lots et tickets dans SQLite ;
- détecter les divergences entre le poste local et le routeur ;
- imprimer ou exporter les tickets ;
- suivre les clients connectés et l’état du réseau ;
- consulter des rapports, fichiers et journaux persistants ;
- administrer l’abonnement, les factures et les paramètres ;
- fonctionner de manière prévisible lorsqu’un routeur est hors ligne.

## 3. État de départ

### Déjà présent

- Application Tauri 2, React 19, TypeScript, Vite et SQLite/Rust.
- Routage global et espace routeur.
- Premier lancement, compte principal, profils internes et sessions.
- Modèle de permissions par rôle.
- Migrations SQLite versionnées.
- Repositories locaux et client SQLite Tauri déjà préparés.
- Adaptateur MikroTik RouterOS et transport API TCP déjà préparés.
- Services pour tickets, PDF, impression, journalisation et synchronisation.
- Modèles métier et tests unitaires nombreux.
- Build et tests TypeScript actuellement valides.

### À remplacer ou finaliser

- Les écrans principaux utilisent encore `FakeRouterAdapter`.
- Plusieurs pages utilisent des données de démonstration en mémoire.
- Les logs, rapports et certaines statistiques restent à relier à SQLite ; les routeurs, plans, tickets et fichiers principaux le sont désormais.
- L’authentification et une partie des paramètres utilisent `localStorage` plutôt que la base applicative.
- L’impression Windows native est implémentée ; la validation avec une imprimante physique reste à effectuer.
- Certains exports affichent un message sans produire réellement le fichier attendu.
- Le mode agent distant n’est pas implémenté.
- L’agent distant n’est pas implémenté ; son protocole et son service d’exécution restent à définir.
- Le raccordement entre les secrets enregistrés et les connexions réelles doit être sécurisé et finalisé.
- Les statistiques globales et certains historiques sont encore codés en dur ou issus de données fictives.

## 4. Principes directeurs

1. **SQLite est la source de vérité.** L’état métier ne doit pas dépendre d’un tableau React ou d’un jeu de données de démonstration.
2. **Les composants d’interface ne parlent pas directement à MikroTik.** Ils passent par des services métier testables.
3. **Chaque donnée est rattachée à un compte et, si nécessaire, à un profil interne.**
4. **Toute action importante est journalisée sans secret ni mot de passe.**
5. **Le mode hors ligne est explicite.** Une donnée locale non synchronisée ne doit jamais être présentée comme synchronisée.
6. **Les permissions sont contrôlées dans l’interface et dans les services.** Le masquage d’un bouton ne suffit pas.
7. **Aucune fonctionnalité déclarée terminée sans test de succès, d’échec, d’interruption et de reprise.**
8. **Les migrations doivent préserver les anciennes installations et les données existantes.**

## 5. Architecture cible

```text
React pages
  -> hooks / view models
  -> application services
  -> repositories + RouterService + file/print services
  -> Tauri commands
  -> SQLite / système de fichiers / réseau local
  -> routeur MikroTik RouterOS
```

### Composants à stabiliser

- `src/domain` : types métier sans dépendance à l’interface.
- `src/services/database` : client SQLite, repositories et transactions.
- `src/services/auth` : compte, profils, sessions et permissions persistants.
- `src/services/router` : sélection de l’adaptateur, connexion, actions et traduction des erreurs.
- `src/services/sync` : comparaison, résolution de conflits et reprise.
- `src/services/pdf` et `src/services/printing` : génération, enregistrement et impression réels.
- `src/pages/*` : écrans connectés à des hooks/services persistants, sans données de démonstration en production.
- `src-tauri` : commandes minimales et sécurisées pour SQLite, secrets, fichiers, ouverture de dossiers et impression.

## 6. Plan d’exécution par phases

## Phase 0 — Socle, inventaire et protection de l’existant

**Priorité : P0 — obligatoire avant les gros changements**

### Objectifs

- figer le comportement actuel qui doit être conservé ;
- identifier les flux réellement utilisés par chaque écran ;
- éviter les régressions pendant le remplacement des mocks.

### Travaux

- Ajouter une documentation courte de l’architecture et des flux de données.
- Définir les conventions d’identifiants, dates, statuts et erreurs.
- Ajouter des factories de données de test séparées des données de démonstration.
- Ajouter une configuration explicite `development`, `test` et `production`.
- Identifier chaque page qui utilise encore un modèle `demo` ou un adaptateur fake.
- Ajouter des tests d’intégration de base pour le démarrage, l’authentification et la persistance.
- Prévoir une stratégie de migration des données existantes avant toute suppression de schéma historique.

### Critères d’acceptation

- L’application démarre avec une configuration connue.
- Les données de test ne sont jamais injectées automatiquement en production.
- Une liste claire indique pour chaque page sa source de données.
- Les tests actuels restent verts.

## Phase 1 — Persistance SQLite et source de vérité unique

**Priorité : P0 — fondation fonctionnelle**

### Objectifs

Relier les écrans et services au SQLite Tauri afin que toute action survive au redémarrage de l’application.

### Travaux

- Centraliser l’initialisation de `TauriSqliteDatabase` au démarrage.
- Créer un conteneur de dépendances applicatif pour partager le client base et les services.
- Compléter les repositories pour les opérations nécessaires : lecture, création, modification, suppression logique et restauration.
- Ajouter les filtres par compte, routeur, profil, période et statut.
- Ajouter les transactions pour la génération d’un lot et de ses tickets.
- Remplacer les écritures temporaires de l’interface par les repositories.
- Persister les paramètres généraux, imprimantes, snapshots, fichiers et logs.
- Ajouter les migrations nécessaires sans casser les bases existantes.
- Vérifier les index et contraintes de clés étrangères.

### Tables concernées

- comptes et profils internes ;
- abonnements et factures ;
- routeurs et connexions ;
- plans Hotspot ;
- lots et tickets ;
- fichiers générés ;
- sessions/cache clients ;
- snapshots réseau ;
- logs applicatifs ;
- paramètres et imprimantes.

### Critères d’acceptation

- Un routeur créé reste présent après fermeture et relance.
- Un plan, un lot et ses tickets sont récupérables après relance.
- Une suppression logique n’efface pas l’historique par accident.
- Les données d’un autre compte ne sont jamais retournées par un repository.
- Une génération partiellement échouée ne laisse pas une transaction incohérente.

## Phase 2 — Authentification, profils et sécurité réelle

**Priorité : P0 — sécurité et contrôle d’accès**

### Objectifs

Rendre l’authentification persistante, cohérente avec SQLite et réellement fiable pour un usage multi-profil.

### Travaux

- Migrer compte principal, profils, mots de passe et paramètres de session vers SQLite.
- Conserver une compatibilité contrôlée avec les anciennes données `localStorage`.
- Définir une procédure de migration unique et idempotente.
- Vérifier le statut du compte à chaque ouverture de session.
- Vérifier l’appartenance du profil au compte actif.
- Faire respecter les permissions dans les services métier et non seulement dans les routes.
- Ajouter les permissions manquantes ou incohérentes entre migrations, rôles et navigation.
- Remplacer les secrets conservés dans `localStorage` par un stockage protégé côté Tauri lorsque possible.
- Ajouter une vraie fonction de déchiffrement contrôlée pour les connexions autorisées.
- Ne jamais écrire de mot de passe, token ou secret dans les logs, exports ou erreurs utilisateur.
- Ajouter verrouillage, expiration, reconnexion et déconnexion complète testés.

### Critères d’acceptation

- Un profil désactivé ne peut plus ouvrir de session.
- Un profil ne peut accéder qu’aux données de son compte.
- Une action interdite échoue même si elle est appelée directement sans passer par l’interface.
- Une session expirée ne permet plus d’exécuter d’action sensible.
- Les secrets ne sont pas lisibles depuis les logs ou les exports.

## Phase 3 — Gestion réelle des routeurs

**Priorité : P0 — cœur du produit**

### Objectifs

Faire de la page Routeurs une gestion persistante et connectée aux routeurs réels.

### Travaux

- Charger les routeurs depuis SQLite par compte.
- Persister création, modification, archivage et restauration.
- Construire la configuration d’adaptateur à partir du routeur enregistré.
- Remplacer les tests systématiquement fake par une sélection explicite entre fake et MikroTik.
- Tester réellement les connexions locales.
- Récupérer et persister les informations système après connexion.
- Mettre à jour statut, dernière présence et dernière erreur.
- Gérer les ports API et API-SSL séparément — validé côté transport Rust.
- Vérifier les limites d’abonnement au moment de l’ajout, pas seulement à l’affichage.
- Implémenter la découverte locale réelle ou afficher clairement la limitation si elle reste dépendante d’un mécanisme Windows spécifique.
- Ajouter des timeouts, annulations et reprises propres.

### Connexions distantes

- Finaliser le mode IP distante avec avertissements de sécurité.
- Définir clairement le mode VPN : prérequis, validation et messages.
- Décider puis implémenter l’agent distant dans une phase dédiée, ou le retirer de l’interface tant qu’il n’est pas disponible.
- Activer l’API-SSL de façon sûre si la bibliothèque et le contexte Tauri le permettent — validé avec `native-tls`.
- Ne jamais présenter une connexion distante comme sécurisée sans validation réelle du transport.

### Critères d’acceptation

- Un routeur réel peut être ajouté, testé, modifié et rouvert après redémarrage.
- Une mauvaise adresse, un mauvais mot de passe, une API inactive et un timeout produisent des messages distincts.
- Le statut affiché correspond à la dernière vérification connue.
- Le mode fake est réservé aux tests et à une éventuelle démonstration explicite.

## Phase 4 — Plans Hotspot et synchronisation RouterOS

**Priorité : P0 — configuration métier**

### Objectifs

Synchroniser les plans locaux avec les profils Hotspot du routeur.

### Travaux

- Charger les plans depuis le routeur et la base locale.
- Décider la stratégie d’identité entre `id`, nom de profil MikroTik et métadonnées TicketPro.
- Persister les plans créés ou modifiés localement.
- Marquer `local`, `pending`, `synced` ou `conflict` selon le résultat réel.
- Gérer les plans présents sur le routeur mais absents localement.
- Gérer les plans supprimés ou désactivés sur MikroTik.
- Vérifier les conversions de durée, débit, volume et utilisateurs partagés.
- Empêcher la suppression d’un plan encore utilisé sans confirmation et stratégie de remplacement.
- Ajouter synchronisation manuelle et rafraîchissement contrôlé.

### Critères d’acceptation

- Une création de plan apparaît dans SQLite et sur MikroTik.
- Une modification reflète clairement les deux états.
- Une erreur réseau ne détruit pas la configuration locale.
- Un conflit est visible, explicable et résolvable.

## Phase 5 — Génération, cycle de vie et synchronisation des tickets

**Priorité : P0 — valeur principale du produit**

### Objectifs

Rendre la génération de tickets fiable, atomique, traçable et récupérable.

### Travaux

- Générer les identifiants et secrets selon une politique configurable.
- Créer le lot et les tickets dans SQLite dans une transaction.
- Créer les utilisateurs Hotspot sur MikroTik avec suivi ticket par ticket — implémenté pour la génération persistante.
- Gérer les échecs partiels sans perdre les tickets réussis — implémenté avec reprise depuis Tickets.
- Ajouter reprise et resynchronisation d’un ticket, d’un lot et d’un routeur.
- Mettre à jour statuts, identifiants MikroTik, activation, expiration et compteurs.
- Synchroniser les utilisateurs présents sur le routeur mais absents localement.
- Gérer les conflits de plan, suppression et changement de statut — synchronisation et reprise couvertes.
- Protéger l’affichage des mots de passe par permission explicite et action confirmée.
- Ajouter un historique des actions sur les tickets.
- Faire respecter la séparation entre tickets de l’agent et tickets globaux.

### Critères d’acceptation

- Un lot de 100 tickets peut être généré avec rapport de réussite et d’échec.
- Une coupure réseau au milieu du lot permet une reprise sans doublons.
- Les tickets sont disponibles dans la liste après relance.
- Les droits Agent, Opérateur, Admin et Invité produisent des vues et actions différentes.
- Le mot de passe n’est révélé qu’après contrôle de permission.

## Phase 6 — PDF, fichiers et impression

**Priorité : P1 — exploitation quotidienne**

### Objectifs

Produire des fichiers réels, les stocker à un emplacement fiable et les retrouver depuis l’application.

### Travaux

- Définir les dossiers configurables pour PDF, exports et sauvegardes.
- Écrire réellement les bytes PDF via une commande Tauri sécurisée — implémenté pour les PDF de tickets.
- Enregistrer chaque fichier dans `generated_files` après écriture confirmée — implémenté.
- Vérifier l’existence du fichier avant affichage comme disponible — implémenté dans Fichiers.
- Implémenter ouverture du fichier et ouverture du dossier parent — ouverture du fichier implémentée.
- Ajouter export CSV réel avec encodage et échappement corrects.
- Implémenter export PDF réel des rapports et factures.
- Remplacer la détection d’imprimantes simulée par une intégration adaptée à Windows — EnumPrintersW implémenté.
- Gérer imprimante absente, format incompatible, erreur d’impression et réimpression — envoi PDF natif et erreurs remontées.
- Persister l’historique des impressions — migration SQLite et repository implémentés.
- Préserver les fichiers existants lors des migrations de chemin.

### Critères d’acceptation

- Un PDF généré existe réellement à son chemin déclaré.
- Le fichier apparaît dans Fichiers après redémarrage.
- Un fichier absent est détecté comme absent, pas comme disponible.
- Un export rapport produit un fichier téléchargeable/ouvrable.
- Une impression réussie et une impression échouée ont des historiques distincts.

## Phase 7 — Clients connectés, monitoring et snapshots

**Priorité : P1 — supervision opérationnelle**

### Objectifs

Afficher des données réseau réelles et conserver un historique minimal utile.

### Travaux

- Lire les utilisateurs actifs depuis MikroTik — implémenté dans Clients connectés.
- Persister un cache local avec date de collecte — implémenté.
- Afficher clairement données en direct, cache et données obsolètes — repli cache hors ligne implémenté.
- Implémenter déconnexion client avec permission contrôlée.
- Collecter CPU, mémoire, uptime, température si disponible et trafic interfaces — implémenté.
- Persister des snapshots périodiques et limiter leur rétention — snapshots SQLite implémentés, rétention à durcir.
- Remplacer les séries artificielles par des mesures réelles ou les présenter explicitement comme tendances estimées — historique réel utilisé lorsqu’il existe.
- Ajouter rafraîchissement manuel, intervalle configurable et annulation des requêtes.
- Afficher les causes d’indisponibilité : routeur hors ligne, API inactive, permission ou service Hotspot absent.

### Critères d’acceptation

- Les clients affichés correspondent à la réponse RouterOS.
- Un cache expiré est signalé.
- Une déconnexion retire le client après confirmation du routeur.
- Le monitoring ne présente pas de chiffres fictifs comme des mesures réelles.

## Phase 8 — Rapports, logs et audit métier

**Priorité : P1 — traçabilité**

### Objectifs

Rendre l’historique fiable, filtrable, exportable et utile au diagnostic.

### Travaux

- Charger les logs depuis SQLite — implémenté dans Logs.
- Enregistrer succès, erreurs, changements de configuration et synchronisations — journaliseur routeur SQLite implémenté.
- Associer chaque action à compte, profil, routeur, date et identifiant technique non sensible — implémenté.
- Ajouter rétention et nettoyage contrôlé par permission — nettoyage persistant implémenté ; politique à finaliser.
- Construire les rapports à partir des tickets persistants.
- Ajouter filtres période, plan, profil, statut et routeur.
- Implémenter exports PDF et CSV réellement écrits sur disque — rapports PDF/CSV implémentés et archivés dans Fichiers.
- Ajouter des compteurs cohérents avec les données affichées.
- Distinguer montants théoriques, revenus réellement encaissés et données inconnues.

### Critères d’acceptation

- Une action effectuée apparaît dans les logs après relance.
- Aucun secret n’est présent dans un log exporté.
- Les chiffres d’un rapport correspondent aux tickets sélectionnés.
- Un export peut être ouvert dans un tableur ou lecteur PDF.

## Phase 9 — Compte, abonnement, factures et paramètres

**Priorité : P1 — gestion applicative**

### Objectifs

Unifier la gestion globale avec les mêmes données persistantes que le reste de l’application.

### Travaux

- Migrer comptes, abonnements et factures vers SQLite.
- Lier chaque facture au compte et à l’abonnement concerné.
- Faire respecter les limites de routeurs côté service.
- Gérer statuts actif, essai, expiré, suspendu et annulé.
- Générer les factures manuelles avec numérotation sûre et non ambiguë.
- Persister les paiements manuels et les dates associées.
- Brancher la page Compte sur les routeurs réels du compte.
- Persister les paramètres globaux et routeur avec validation.
- Finaliser la gestion des profils : nom, activation, mot de passe et permissions autorisées.
- Ajouter sauvegarde et restauration de la base et des paramètres.

### Hors périmètre de cette version

- Vente de tickets en ligne.
- Paiement en ligne et Mobile Money.
- Portail captif.
- Éditeur HTML/CSS MikroTik.

Ces sujets pourront faire l’objet d’une version produit ultérieure, mais ne doivent pas être simulés comme disponibles.

## Phase 10 — UX, robustesse et accessibilité

**Priorité : P1**

### Travaux

- Ajouter états de chargement, vide, erreur, hors ligne et données obsolètes sur chaque écran.
- Empêcher les doubles clics et doubles soumissions.
- Ajouter confirmations adaptées aux actions destructives ou sensibles.
- Uniformiser les messages et traductions françaises.
- Corriger l’encodage des caractères accentués dans les sources et données affichées.
- Vérifier navigation clavier, focus des dialogues, labels et messages accessibles.
- Améliorer l’affichage aux différentes tailles de fenêtre.
- Ajouter annulation des requêtes longues et gestion de fermeture d’écran.
- Découper le bundle si nécessaire pour réduire le chargement initial.
- Vérifier que les erreurs techniques restent dans les logs et que les messages utilisateur restent compréhensibles.

## Phase 11 — Qualité, sécurité et livraison Windows

**Priorité : P0 avant livraison**

### Tests obligatoires

- Tests unitaires des modèles métier.
- Tests des repositories avec SQLite de test.
- Tests des migrations sur base vide et base historique.
- Tests des permissions par rôle.
- Tests de persistance après redémarrage simulé.
- Tests de l’adaptateur MikroTik avec transport simulé.
- Tests de timeouts, erreurs réseau et réponses RouterOS invalides.
- Tests de génération partielle et reprise de lots.
- Tests PDF, CSV et fichiers absents.
- Tests d’impression disponible, absente et incompatible.
- Tests d’intégration Tauri pour commandes SQLite, fichiers et secrets.
- Parcours end-to-end : premier lancement, connexion, ajout routeur, plan, tickets, PDF, synchronisation et relance.

### Contrôles sécurité

- Aucun secret dans les logs, commits, fixtures publiques ou messages d’erreur.
- Validation stricte des chemins de fichiers pour éviter les écritures hors dossiers autorisés.
- Validation stricte des paramètres transmis aux commandes Tauri.
- Permissions vérifiées dans les services et commandes sensibles.
- Secrets non récupérables par simple lecture de `localStorage` si une protection native est disponible.
- Vérification des migrations et sauvegardes avant mise à jour.

### Livraison

- Vérification TypeScript.
- Tests JavaScript.
- Tests Rust.
- Build Vite.
- Build Tauri Windows x64.
- Installation sur machine propre.
- Migration depuis une ancienne installation.
- Vérification de conservation de la base, du profil local et des fichiers.
- Vérification de désinstallation et de réinstallation sans perte non documentée.

## 7. Ordre de priorité global

### P0 — Bloquant pour une vraie utilisation

1. Persistance SQLite et injection des services.
2. Authentification et permissions persistantes.
3. Gestion réelle des routeurs et connexion MikroTik.
4. Plans Hotspot réels.
5. Génération et synchronisation des tickets.
6. Sécurité des secrets.
7. Tests d’intégration et migrations.

### P1 — Nécessaire pour un produit quotidien complet

1. PDF et fichiers réels.
2. Impression Windows.
3. Clients connectés et monitoring réel.
4. Logs et rapports persistants.
5. Abonnements, factures et paramètres persistants.
6. Robustesse UX, accessibilité et performance.

### P2 — Évolutions après stabilisation

1. Agent distant.
2. Synchronisation multi-postes ou serveur central.
4. Paiement en ligne et Mobile Money.
5. Portail captif et fonctions commerciales avancées.

## 8. Definition of Done

Une fonctionnalité est considérée comme terminée uniquement si :

- elle utilise les données persistantes prévues ;
- elle fonctionne après fermeture et relance ;
- elle possède un état de chargement, succès, erreur et absence de données ;
- elle respecte les permissions du profil courant ;
- elle journalise l’action sans secret ;
- elle gère l’indisponibilité réseau lorsque cela s’applique ;
- elle possède des tests adaptés ;
- elle ne dépend plus d’un jeu de données de démonstration en production ;
- elle est vérifiée dans le build desktop Tauri, pas seulement dans Vite.

## 9. Indicateurs de réussite du projet

- Aucun écran métier principal ne dépend de `FakeRouterAdapter` en production.
- Aucun écran métier principal ne dépend d’un tableau `demo` pour ses données.
- Toutes les créations et modifications importantes survivent à un redémarrage.
- Un routeur réel peut être administré de bout en bout.
- Un lot de tickets peut être généré, synchronisé, imprimé, retrouvé et audité.
- Les conflits et erreurs réseau sont explicites et récupérables.
- Les comptes et profils sont isolés correctement.
- Les tests unitaires, intégration, Rust et build Windows sont verts.
- Une installation neuve et une migration historique sont validées.

## 10. Première séquence de travail recommandée

1. Créer le conteneur de dépendances applicatif.
2. Initialiser et partager `TauriSqliteDatabase`.
3. Brancher les repositories routeurs et comptes.
4. Remplacer la liste de routeurs de démonstration par SQLite.
5. Construire l’adaptateur MikroTik à partir d’un routeur enregistré.
6. Brancher la page Routeurs sur le vrai test de connexion.
7. Brancher plans, tickets et génération sur SQLite et le routeur sélectionné.
8. Ajouter les tests d’intégration de ces flux.
9. Traiter ensuite fichiers, impression, rapports, logs et monitoring.

Cette séquence réduit le risque de construire de nouvelles fonctionnalités sur des données temporaires et fournit rapidement un premier parcours réellement opérationnel.
