# Reprise TicketPro après perte ou remplacement d'un PC

## Objectif

Un compte TicketPro doit retrouver son parc après connexion sur un nouveau PC, sans restaurer manuellement l'ancienne base SQLite.

Le VPS conserve l'état métier nécessaire à la reconstruction. Le MikroTik reste la source de vérité pour son état d'exécution réel.

## Données restaurées

- routeurs et identité physique stable ;
- nom, modèle, série, version RouterOS et adresse Hotspot/DNS ;
- paramètres de connexion locale et VPN ;
- identifiant RouterOS et mot de passe conservé dans le coffre chiffré ;
- plans Hotspot ;
- pair WireGuard du routeur, sans clé privée locale du routeur ;
- politique anti-partage TTL/IPv6 ;
- bypass des antennes et équipements d'infrastructure ;
- vouchers relus directement depuis l'API RouterOS après rétablissement du tunnel.

Les fichiers PDF déjà générés ne sont pas recréés automatiquement. Les vouchers importés peuvent ensuite être réimprimés depuis TicketPro lorsque leur mot de passe est lisible dans RouterOS.

## Parcours automatique

1. L'utilisateur installe TicketPro sur le nouveau PC et se connecte à son compte.
2. Si la base locale ne contient aucun routeur, l'application télécharge le catalogue autorisé depuis le VPS.
3. Le mot de passe RouterOS est déchiffré par le VPS via le coffre, transmis uniquement dans la session HTTPS, puis immédiatement rechiffré avec la protection locale du nouveau PC.
4. Les routeurs, connexions, plans et pairs VPN sont reconstruits localement.
5. Tous les pairs routeurs restaurés restent en `draft`. Aucun ancien statut `active` n'est considéré comme fiable.
6. L'utilisateur crée ou active le pair opérateur WireGuard du nouveau PC.
7. TicketPro contrôle les routeurs par lots, sans bloquer l'interface.
8. Pour chaque routeur joignable, TicketPro :
   - confirme l'API RouterOS à travers WireGuard ;
   - lit le modèle, le numéro de série et la version réels ;
   - réapplique puis vérifie la politique TTL/IPv6 ;
   - réconcilie les bypass d'infrastructure ;
   - réconcilie les plans avec les profils réellement présents ;
   - importe les vouchers absents de la nouvelle base locale ;
   - passe enfin le routeur et son pair au statut actif.
9. Un routeur hors ligne reste en avertissement et sera retenté. Il n'est jamais déclaré actif sans confirmation RouterOS.

## Sécurité du coffre

La variable serveur `ROUTER_VAULT_KEY` doit être une clé aléatoire de 32 octets encodée en base64. Les identifiants RouterOS sont chiffrés avec AES-256-GCM et liés à l'organisation et au routeur par des données authentifiées.

La base SQLite du VPS ne contient pas le mot de passe RouterOS en clair. Les archives de réimpression contenant les identifiants vouchers sont chiffrées séparément avec `TICKET_ARCHIVE_KEY`, en AES-256-GCM et avec un contexte authentifié organisation/routeur/fichier. Les journaux d'audit ne contiennent ni mot de passe voucher, ni mot de passe RouterOS, ni clé WireGuard privée.

`ROUTER_VAULT_KEY` et `TICKET_ARCHIVE_KEY` doivent être sauvegardées hors du VPS avec les sauvegardes de la base. Perdre une clé rend les données correspondantes définitivement illisibles. Exposer une clé impose sa rotation et le rechiffrement du coffre concerné.

## Sauvegarde à conserver hors VPS

Une restauration complète du serveur exige au minimum :

- la base `licenses.sqlite` et ses fichiers SQLite associés si présents ;
- `ROUTER_VAULT_KEY` ;
- `TICKET_ARCHIVE_KEY` ;
- `LICENSE_HASH_SECRET` ;
- les secrets SMTP et iPay ;
- la configuration Caddy ;
- l'état et les clés du serveur WireGuard ;
- les manifestes et installateurs de mise à jour.

Ne jamais placer ces secrets dans Git.

## Test de reprise avant production

1. Sauvegarder la base locale actuelle.
2. Vérifier qu'au moins un routeur possède un snapshot récent sur le VPS.
3. Utiliser un profil Windows de test ou une VM propre.
4. Installer la même version de TicketPro.
5. Se connecter au même compte.
6. Vérifier la restauration du routeur, de son DNS Hotspot et de ses plans.
7. Créer le pair opérateur du nouveau PC.
8. Vérifier que le routeur passe de brouillon à actif.
9. Contrôler dans WinBox :
   - le handshake WireGuard ;
   - les règles `TicketPro anti-tethering:` ;
   - les bindings `TicketPro infrastructure:` ;
   - les profils Hotspot ;
   - les utilisateurs Hotspot.
10. Vérifier dans TicketPro que les vouchers RouterOS ont été réimportés.

Ne supprimer l'ancien environnement qu'après ce test.
