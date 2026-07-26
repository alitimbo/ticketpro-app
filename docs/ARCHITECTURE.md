# Architecture de TicketPro

## Positionnement

TicketPro est une application desktop Windows local-first pour administrer des hotspots MikroTik. L’interface React est exécutée dans Tauri ; les opérations système, SQLite, réseau et fichiers doivent passer par des services dédiés et des commandes Tauri contrôlées.

## Flux cible

```text
Page React
  -> view model / hook
  -> service applicatif
  -> repository SQLite ou RouterService
  -> commande Tauri / adaptateur réseau
  -> SQLite, système de fichiers ou MikroTik
```

Les pages ne doivent pas contenir de logique de connexion RouterOS, de SQL libre, de chiffrement de secret ou de gestion directe des fichiers.

## Responsabilités par couche

### `src/domain`

Types métier et contrats indépendants de React, Tauri et SQLite.

### `src/pages`

Composition des écrans, états d’affichage, formulaires et navigation. Les pages consomment des services et transforment les résultats en view models.

### `src/services/auth`

Compte principal, profils internes, permissions, sessions, migration des anciennes sessions et audit de sécurité.

### `src/services/database`

Client `DatabaseClient`, implémentation SQLite Tauri, client mémoire de test et repositories. Les repositories sont responsables du filtrage par compte/profil et des opérations persistantes.

### `src/services/router`

`RouterService` applique les permissions et traduit les erreurs. Un `RouterAdapter` représente soit MikroTik réel, soit un fake de test explicite. Le choix de l’adaptateur ne doit pas être implicite dans les pages de production.

### `src/services/sync`

Comparaison entre état local et état RouterOS, détection des tickets manquants/conflits et opérations de resynchronisation.

### `src/services/pdf`, `src/services/printing`

Génération des documents, préparation de l’impression et historique. L’écriture réelle sur disque et l’intégration imprimante devront passer par Tauri.

### `src-tauri`

Commandes minimales pour SQLite, réseau MikroTik, secrets protégés et système de fichiers. Les commandes doivent valider leurs arguments et ne jamais exposer de secrets dans les erreurs ou logs.

## Source de vérité

| Domaine | État actuel | Cible |
| --- | --- | --- |
| Compte, profil, session | `localStorage` | SQLite + session protégée |
| Routeurs | SQLite + état d’écran | SQLite |
| Plans Hotspot | SQLite + synchronisation RouterOS partielle | SQLite + synchronisation RouterOS complète |
| Lots et tickets | SQLite + RouterOS avec reprises | SQLite + RouterOS avec génération et reprise complètes |
| Fichiers | SQLite + fichiers Tauri dans AppData | système de fichiers + SQLite + ouverture/impression réelle |
| Logs | état React / localStorage partiel | SQLite |
| Rapports | calcul sur fixtures | requêtes SQLite |
| Abonnements et factures | localStorage | SQLite |
| Monitoring | données fake ou réponse ponctuelle | RouterOS + snapshots SQLite |

## Règles d’isolement

Toute donnée métier persistante doit porter un `account_id` lorsqu’elle appartient à un compte. Les données créées par un profil doivent également porter `created_by_profile_id` lorsque le périmètre « mes données » est applicable.

Les repositories doivent filtrer les données supprimées logiquement et vérifier l’appartenance du profil au compte avant toute écriture.

## Environnements

Le module [`src/config/runtime.ts`](../src/config/runtime.ts) distingue `development`, `test` et `production`. Les fixtures et capacités de démonstration pourront être utilisées en développement/test, mais doivent être refusées par les flux de production au fur et à mesure du raccordement des écrans.

## Démarrage applicatif cible

1. Résoudre l’environnement.
2. Initialiser Tauri et SQLite.
3. Exécuter les migrations idempotentes.
4. Migrer les anciennes données locales si nécessaire.
5. Construire le conteneur de services avec la base et les providers.
6. Monter React avec ce conteneur.
7. Restaurer la session après validation du compte et du profil.
