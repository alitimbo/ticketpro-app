# Sprint 4 laboratoire — Synchronisation et observabilité

## Objectif

Prouver qu'une coupure réseau, la fermeture de TicketPro ou un délai d'attente RouterOS ne perd aucune opération et ne crée aucun voucher en double.

Ce sprint reste limité à **TicketPro Lab sous Hyper-V**. Nova ne doit pas être utilisé avant validation complète.

## Ce qui est maintenant protégé

- L'intention de créer un voucher est enregistrée dans SQLite avant l'appel RouterOS.
- Une clé d'idempotence stable existe pour chaque commande de création.
- Un lot est corrélé par son identifiant ; chaque ticket avance indépendamment.
- Une opération interrompue reste en `pending`, `processing` ou `retry` et reprend au redémarrage ou au retour du réseau.
- Après un délai d'attente, TicketPro relit RouterOS avant toute nouvelle création.
- Un voucher déjà activé, consommé ou historisé n'est jamais recréé silencieusement.
- La publication du catalogue d'une organisation sur le VPS est découpée en fragments de 40 tickets et reprend uniquement le fragment en échec.
- Les erreurs permanentes et les conflits restent visibles ; ils ne sont jamais transformés en succès.
- Aucun mot de passe de voucher, token ou clé privée n'entre dans l'outbox.

## Carte « Synchronisation et diagnostic »

L'accueil du routeur affiche désormais :

- le nombre d'opérations en attente et en erreur ;
- la fraîcheur de la dernière vraie lecture RouterOS ;
- la dernière corrélation d'incident ;
- les dérives du manifeste RouterOS ;
- les doublons locaux, conflits VPN et anciennes données mal encodées ;
- les reprises automatiques et les échecs définitifs.

Un point vert ne doit apparaître qu'après une lecture RouterOS réussie. Si le rafraîchissement échoue, l'indicateur passe hors ligne au lieu de conserver un faux état connecté.

## Préparation du laboratoire

1. Démarrer la VM `TicketPro Lab`.
2. Vérifier que WinBox reste accessible sur le port 8291.
3. Lancer TicketPro en développement depuis `C:\Ticketpro` :

   ```powershell
   npm.cmd run tauri:dev
   ```

4. Ouvrir TicketPro Lab, puis son accueil.
5. Vérifier que la carte « Synchronisation et diagnostic » apparaît.
6. Charger `docs/routeros-sprint4-verify.rsc` dans WinBox > Files.
7. Exécuter :

   ```routeros
   /import file-name=routeros-sprint4-verify.rsc verbose=yes
   ```

Résultat de référence : un seul script lifecycle, un seul scheduler, aucune entrée `DUPLICATE-VOUCHER`, aucune entrée `CLEANUP-ERROR`.

## Test A — Coupure API pendant un lot

Utiliser un petit lot de 10 à 20 vouchers sur un profil de laboratoire.

1. Aller jusqu'à « Aperçu avant création » et être prêt à confirmer.
2. Cliquer sur « Confirmer et créer ».
3. Dès que quelques vouchers sont créés, garder WinBox ouvert et exécuter :

   ```routeros
   /ip service disable [find where name="api"]
   ```

4. TicketPro doit signaler l'interruption. Les commandes non confirmées doivent rester dans la file durable.
5. Ne jamais cliquer plusieurs fois pour recréer le lot.
6. Réactiver l'API :

   ```routeros
   /ip service enable [find where name="api"]
   ```

7. Revenir sur la page Tickets ou remettre la fenêtre TicketPro au premier plan.
8. Attendre la reprise automatique ; elle est également tentée toutes les 15 secondes.
9. Relancer le script de vérification Sprint 4.

Critères :

- tous les vouchers du lot sont présents une seule fois ;
- `duplicate-voucher-entries=0` ;
- la file durable revient à zéro opération active ;
- les tickets confirmés avant la coupure ne sont pas recréés ;
- la base locale contient les identifiants MikroTik réellement observés.

## Test B — Fermeture de TicketPro pendant une reprise

1. Refaire le Test A et laisser volontairement l'API désactivée après l'échec.
2. Fermer complètement TicketPro.
3. Réactiver l'API depuis WinBox.
4. Relancer TicketPro et ouvrir la page Tickets du routeur.
5. Attendre la reprise automatique.
6. Relancer `routeros-sprint4-verify.rsc`.

Critères : mêmes résultats que le Test A, sans doublon et sans perte d'intention.

## Test C — Délai d'attente après écriture RouterOS

Ce cas précis est difficile à déclencher manuellement : RouterOS reçoit la création, mais la réponse n'arrive jamais au PC. Il est couvert par le test automatisé `RouterVoucherOutboxService.test.ts`.

Le résultat exigé est le suivant : TicketPro relit le nom d'utilisateur sur RouterOS, récupère son identifiant MikroTik et clôture l'opération sans second `add`.

## Tests automatisés

Depuis `C:\Ticketpro` :

```powershell
npx.cmd vitest run `
  src/services/database/repositories/SyncOutboxRepository.test.ts `
  src/services/sync/SyncOutboxService.test.ts `
  src/services/sync/RouterVoucherOutboxService.test.ts `
  src/services/sync/OrganizationTicketCatalogService.test.ts `
  src/services/sync/SyncObservabilityService.test.ts `
  src/services/database/migrations.test.ts

npx.cmd tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

## Interprétation des états de la file

- `pending` : enregistrée, pas encore exécutée ;
- `processing` : réclamée par une instance TicketPro ;
- `retry` : échec temporaire, reprise automatique planifiée ;
- `succeeded` : effet distant confirmé ;
- `conflict` : incohérence réelle nécessitant une décision ;
- `failed` : erreur permanente ou limite de tentatives atteinte ;
- `cancelled` : opération annulée explicitement.

Seuls `succeeded` et `cancelled` sont considérés terminés sans anomalie. Un statut `conflict` ou `failed` reste visible pour diagnostic.

## Validation de référence — TicketPro Lab, 28 août 2026

Le contrôle de référence effectué sur la VM Hyper-V `ticketpro-lab` confirme :

- moteur lifecycle : `1` script et `1` scheduler ;
- scheduler actif, intervalle `1m`, compteur d'exécution en progression ;
- profils lifecycle revendiqués : `6h`, `7-jours`, `forfait-mois` ;
- profil `default` laissé intact ;
- vouchers gérés : `15` ;
- vouchers désactivés : `0` ;
- doublons : `0` ;
- erreurs de nettoyage : `0` ;
- sessions, cookies et bindings de voucher résiduels : `0` ;
- WireGuard : `1` interface, `1` peer actif et handshake récent ;
- NTP : synchronisé sur `time.google.com`, stratum `1`, offset final `0.307 ms`.

Pour stabiliser l'horloge de cette VM de laboratoire, les deux serveurs NTP utilisent
temporairement `min-poll=6` et `max-poll=6`. Ce réglage accéléré n'est pas imposé
aux routeurs clients par TicketPro.

Cette validation couvre l'état nominal. Les tests de coupure et de reprise A et B
restent nécessaires avant de déclarer le Sprint 4 entièrement terminé.

## Conditions de sortie du Sprint 4

Le sprint est validé uniquement si :

- les tests automatisés passent ;
- les Tests A et B passent sur Hyper-V ;
- aucune clé privée, aucun token et aucun mot de passe n'apparaît dans SQLite ou les logs ;
- aucune opération n'est perdue après fermeture de TicketPro ;
- aucune coupure ne crée de doublon RouterOS ;
- la carte de diagnostic cesse d'afficher une alerte après reprise confirmée ;
- Nova reste inchangé pendant cette validation.

Après cette validation, le Sprint 5 pourra commencer avec les tests de charge de 1 000 puis 5 000 vouchers et la bêta fermée.
