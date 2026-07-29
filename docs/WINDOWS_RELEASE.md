# Release Windows TicketPro

## Release Candidate interne

Le build Windows utilise l'API publique :

```text
https://license.autoticket-ne.com
```

Les clés iPay, les secrets de licences et le jeton maître WireGuard restent
exclusivement sur le VPS. Le préflight refuse leur présence dans
`.env.production`.

Depuis la racine du projet :

```powershell
npm.cmd run release:build:windows
```

La commande exécute les tests frontend et backend, le typage TypeScript, le
contrôle Rust, le préflight de production et le build NSIS. La compilation Rust
est limitée à un job afin de rester fiable sur les machines disposant de peu de
mémoire.

Artefacts générés :

```text
src-tauri/target/release/bundle/nsis/TicketPro-Setup-<version>-x64.exe
src-tauri/target/release/bundle/nsis/TicketPro-Setup-<version>-x64.exe.sig
src-tauri/target/release/bundle/nsis/TicketPro-Setup-<version>-x64.exe.sha256
```

Le build officiel exige aussi la clé privée Ed25519 de l'Updater dans les
variables `TAURI_SIGNING_PRIVATE_KEY` et
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Voir
[`APP_UPDATES.md`](./APP_UPDATES.md) pour la création de clé et la publication.

## Validation avant diffusion

1. Vérifier le SHA-256.
2. Installer sur une machine Windows propre.
3. Tester activation, paiement, redémarrage, désinstallation et réinstallation.
4. Tester un routeur MikroTik réel et le handshake WireGuard.
5. Signer le binaire et le setup avec le certificat Authenticode officiel.
6. Vérifier la signature avec `Get-AuthenticodeSignature`.
7. Publier le setup, son checksum et les notes de version sur le canal officiel.

Une RC non signée est réservée aux tests internes. Elle ne doit pas être
présentée comme la version publique définitive.
