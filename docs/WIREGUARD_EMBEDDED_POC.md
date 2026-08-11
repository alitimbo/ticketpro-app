# POC WireGuard embarque TicketPro

## Objectif

Prouver sur un Windows x64 propre que TicketPro peut etablir un tunnel vers le
gateway TicketPro sans installer ni configurer l'application WireGuard
classique.

## Regles de migration

- Le provider actif reste `legacy` tant que le POC n'est pas valide.
- Le provider embarque s'active uniquement avec
  `TICKETPRO_VPN_PROVIDER=embedded`.
- Aucune cle privee ne doit entrer dans React, SQLite, les logs, les arguments
  CLI ou les requetes HTTP.
- Le MikroTik continue de connaitre uniquement le gateway TicketPro.
- Aucun composant legacy ne sera supprime avant la validation complete du POC.

## Etat actuel

Le crate `src-tauri/vpn-service` pose :

- le processus separe `ticketpro-vpn-service.exe` ;
- un protocole IPC local, versionne et limite, sans execution de commande
  arbitraire ;
- les modeles de statut et de configuration non secrete ;
- la validation split-tunnel qui refuse `0.0.0.0/0` ;
- l'abstraction `TunnelService` ;
- un lifecycle SCM install/status/uninstall sans commande shell ;
- un stockage d'identite DPAPI appartenant au service ;
- un provider Tauri capable de lire le statut et de demander uniquement
  l'identite publique.

Le service SCM, DPAPI, le named pipe et le chargement FFI des composants sont
implementes. Le broker `TicketProVpnService` sait maintenant installer et
piloter le service enfant officiel `WireGuardTunnel$TicketProTunnel`, appeler
`WireGuardTunnelService`, lire l'etat de l'adaptateur, le dernier handshake et
les compteurs RX/TX via WireGuardNT. Le pair POC VPS et la validation elevee sur
une VM propre restent a realiser. La cle privee reste dans la memoire native du
service, n'est jamais serialisee en JSON et est effacee a la sortie de sa
portee.

Le pipe `\\.\pipe\TicketProVpnService.v1` refuse les connexions distantes,
borne les messages a 64 Kio et n'accepte qu'un enumere ferme de commandes.
Sa DACL autorise LocalSystem et les administrateurs, ainsi que la lecture et
l'ecriture par les utilisateurs interactifs locaux. Aucune commande shell,
aucun chemin arbitraire et aucune configuration contenant une cle privee ne
sont acceptes par le protocole.

La configuration du tunnel est construite en memoire puis enregistree
uniquement sous la forme `TicketProTunnel.conf.dpapi`. Elle utilise le nom du
tunnel comme description DPAPI, conformement au chargeur officiel WireGuard.
Le remplacement du fichier chiffre est atomique et aucun `.conf` en clair
n'est cree.

L'installateur cible est desormais `perMachine`. Le service, l'application et
les DLL seront donc places sous Program Files, hors d'un repertoire modifiable
par un utilisateur standard. Les hooks NSIS arretent les services avant une
mise a jour, puis reinstalle le broker apres copie. Cette migration n'est pas
encore publiee et doit etre testee sur une VM ayant une ancienne installation
`currentUser`.

## Etat backend SaaS SQLite

La base VPS possede maintenant deux tables separees des routeurs :

- `organization_devices` : une ligne par installation desktop ;
- `organization_vpn_peers` : cle publique, IP, versions et etats
  `desired_state/applied_state`.

`POST /v1/saas/devices/register` est idempotent par organisation et
`installation_id`. Un retry reseau ne cree donc ni nouvel appareil ni nouveau
pair. Les routes de liste, heartbeat et revocation sont egalement disponibles.
La cle privee n'entre jamais dans cette base.

Le client desktop possede maintenant un orchestrateur progressif : lorsque
`TICKETPRO_VPN_PROVIDER=embedded`, il demande l'identite publique au service,
enregistre l'installation dans l'API SaaS, applique uniquement la
configuration non secrete retournee par le VPS et demarre le tunnel. Il attend
ensuite un etat reel `CONNECTED` ou `DEGRADED` et envoie un heartbeat toutes les
deux minutes. Lorsque le provider reste `legacy`, le workflow historique est
conserve sans modification.

Une reconciliation periodique repousse l'etat SQLite vers le hub. La
suspension apres la grace d'abonnement utilise `disabled`, ce qui conserve la
cle et l'IP pour un renouvellement. La revocation volontaire utilise
`revoked`, qui rend la cle definitivement inutilisable.

Reference d'implementation :
[WireGuard embeddable-dll-service](https://github.com/WireGuard/wireguard-windows/tree/master/embeddable-dll-service).

L'identite persistante utilise `identity.dat` comme unique autorite locale.
Ce fichier contient un payload binaire protege par DPAPI sous l'identite du
processus service. `metadata.json` ne contient que `installationId`, la cle
publique et `keyVersion`; il peut etre reconstruit depuis `identity.dat`.

En release, le repertoire et les deux fichiers recoivent une DACL protegee qui
n'autorise que LocalSystem et les administrateurs locaux. Les auto-tests debug
utilisent un repertoire aleatoire dans `%TEMP%` et ne modifient jamais les ACL
de la machine de developpement.

## Composants x64 epingles

- wireguard-windows commit :
  `4e6726c23ae9c5cb58e0c9910f3b7515621d133d`
- WireGuardNT SDK : `1.1`
- SHA-256 archive WireGuardNT :
  `DCEB30A9BC4BE48CCE0F74160FC88A585A2C2627366E8F846FC6658F9038DACE`
- SHA-256 `wireguard.dll` amd64 :
  `B1B85E072C45D81358BE29D94C599DC76652F912BE8C0F0A41E2D5D89A6461D3`
- SHA-256 `tunnel.dll` amd64 :
  `439D93D593170C6B81C92F4627CFC9B4788C53C01A71658E5215BB1CE300D8BE`

`wireguard.dll` porte une signature Authenticode valide WireGuard LLC.
`tunnel.dll` est construit depuis le commit officiel epingle et devra etre
signe avec le certificat TicketPro avant une distribution publique.

## Commandes de validation

```powershell
npm run vpn:components:check
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/vpn-service/Cargo.toml
cargo run --manifest-path src-tauri/vpn-service/Cargo.toml -- --self-test
$env:TICKETPRO_VPN_COMPONENT_DIR = (Resolve-Path "src-tauri/resources/vpn/x86_64")
cargo run --manifest-path src-tauri/vpn-service/Cargo.toml -- --component-self-test
cargo run --manifest-path src-tauri/vpn-service/Cargo.toml -- --dpapi-self-test
cargo run --manifest-path src-tauri/vpn-service/Cargo.toml -- --identity-self-test
cargo run --manifest-path src-tauri/vpn-service/Cargo.toml -- --ipc-self-test
cargo run --manifest-path src-tauri/vpn-service/Cargo.toml -- --tunnel-config-self-test
cargo run --manifest-path src-tauri/vpn-service/Cargo.toml -- --service-status
```

## Prochaine etape native

1. Construire un installateur POC non public et valider ses hooks NSIS sur VM.
2. Deployer les nouvelles routes device/reconciliation sur le VPS de test.
3. Laisser l'inscription idempotente configurer le pair desktop POC sur le VPS.
4. Appliquer sa configuration non secrete par IPC via le workflow desktop.
5. Valider interface, route, handshake, ping gateway, RX/TX et arret propre.
6. Tester reboot, veille/reprise et changement de reseau.
7. Durcir ensuite la validation du processus client IPC avant la distribution
   publique signee.

## Gate de sortie

La phase est validee uniquement si une VM sans WireGuard classique obtient :

- le service Windows actif ;
- l'interface TicketPro active ;
- une adresse et une route privees ;
- un handshake recent ;
- un ping du gateway ;
- une reconnexion apres reboot ;
- un arret et une reparation propres.
