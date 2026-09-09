# TicketPro 0.3.10

## Routeurs et synchronisation

- Propagation des suppressions entre PC, même lorsque les identifiants locaux diffèrent.
- Prise en compte des traces de suppression conservées après retrait de la ligne routeur.
- Conservation de la liste locale en cas d'indisponibilité du VPS.
- Blocage de la restauration d'un routeur retiré par une sauvegarde obsolète.
- Conservation des historiques de tickets ; une simple absence du catalogue cloud ne vaut pas suppression.

## Rapports

- Correction des compteurs de tickets disponibles, expirés et imprimés.
- Les impressions historiques sans date ne sont pas attribuées arbitrairement à une période.
- Contrôle des permissions de rapport côté API et respect des rapports personnels.
- Signalement des erreurs cloud même lorsque la lecture RouterOS réussit.
- Pas de publication du catalogue depuis le rapport sans permission correspondante.

## Ordre de diffusion

1. Sauvegarder et vérifier la base VPS, conserver l'image API précédente pour retour arrière.
2. Déployer uniquement l'API TicketPro : ni WireGuard, ni Caddy, ni AutoTicket ne nécessitent de modification pour cette release.
3. Vérifier la santé API, la récupération du parc et les rapports avec les rôles autorisés.
4. Construire l'installateur Windows avec `scripts/run-signed-windows-build.ps1`.
5. Vérifier les scénarios de `PR6_CORRECTIONS_VALIDATION.md`, le checksum et la signature Updater.
6. Publier les artefacts puis le manifeste, seulement après validation.

Pas de nouvelle migration de schéma dans cette release. Pas de rotation de clé ni de reconfiguration MikroTik requise. La signature Updater n'est pas une signature Authenticode de l'éditeur Windows.

## Publication du 9 septembre 2026

- API déployée avant le manifeste ; image précédente conservée sous `ticketpro-license-api:rollback-0.3.10`.
- Sauvegarde SQLite avec contrôle d'intégrité `ok` : `/opt/ticketpro/backups/release-0.3.10-20260909T125720Z`.
- Installateur : `TicketPro-Setup-0.3.10-x64.exe`.
- SHA-256 : `be805a0358ac62a3d52a3081773c915cf189ba1390a20cadeb2ffde4a7dabe8f`.
- Signature Updater vérifiée cryptographiquement avec la clé publique embarquée.
- Téléchargement public vérifié par hash, manifeste 0.3.10 vérifié, client déjà à jour : HTTP 204.
- Contrôles de santé API/AutoTicket réussis ; services WireGuard et AutoTicket non redémarrés.
- Proxy recréé pour le lien de téléchargement ; Caddyfile inchangé. Manifeste remplacé atomiquement.
- Ces contrôles de publication ne constituent pas un test d'installation Windows ni un test métier authentifié sur un routeur client.
