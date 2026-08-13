# Procédure de mise à jour TicketPro

Ce document décrit la procédure complète de mise à jour de TicketPro en
simulant le passage de la version `0.2.0` à la version `0.2.1`.

## Fonctionnement général

```text
TicketPro 0.2.0
      |
      | Vérification automatique
      v
API TicketPro
      |
      |-- Aucune version plus récente : HTTP 204
      |
      `-- Version 0.2.1 disponible
              |
              | URL HTTPS + signature + notes
              v
        Sauvegarde SQLite locale
              |
              v
        Téléchargement du setup
              |
              v
        Vérification Ed25519
              |
              v
        Installation et redémarrage
```

## 1. Installer la première version compatible

Les utilisateurs qui disposent d'une ancienne version sans Updater doivent
installer manuellement :

```text
TicketPro-Setup-0.2.0-x64.exe
```

À partir de `0.2.0`, TicketPro peut rechercher et installer les versions
suivantes automatiquement.

Le fichier `.sig` n'est pas destiné à être ouvert par l'utilisateur. Il permet
à TicketPro de vérifier que le setup provient réellement d'Akicorp Solutions
et qu'il n'a pas été modifié.

## 2. Distribuer officiellement la version initiale 0.2.0

### Lien permanent

Le bouton **Télécharger pour Windows** de la landing page doit toujours
utiliser cette URL :

```text
https://api.ticketpro-ne.com/download/windows
```

Ce lien ne change jamais. Caddy le redirige vers le setup versionné
actuellement publié :

```text
https://api.ticketpro-ne.com/download/windows
        |
        `-- HTTP 302
              |
              `-- /releases/TicketPro-Setup-0.2.0-x64.exe
```

L'URL versionnée permet de conserver chaque release sans remplacer
silencieusement un ancien binaire.

### Fichiers publics sur le VPS

Les releases Windows sont stockées dans :

```text
/opt/ticketpro/releases
```

Pour `0.2.0`, le dossier contient :

```text
/opt/ticketpro/releases/
|-- TicketPro-Setup-0.2.0-x64.exe
|-- TicketPro-Setup-0.2.0-x64.exe.sig
`-- TicketPro-Setup-0.2.0-x64.exe.sha256
```

Les fichiers sont servis publiquement par Caddy sous :

```text
https://api.ticketpro-ne.com/releases/
```

Le VPS ne doit jamais recevoir la clé privée `updater.key` ni son mot de
passe.

### Envoyer la première version

Depuis `C:\Ticketpro` :

```powershell
scp -i secrets\ticketpro_vps_ed25519 `
  "src-tauri\target\release\bundle\nsis\TicketPro-Setup-0.2.0-x64.exe" `
  "src-tauri\target\release\bundle\nsis\TicketPro-Setup-0.2.0-x64.exe.sig" `
  "src-tauri\target\release\bundle\nsis\TicketPro-Setup-0.2.0-x64.exe.sha256" `
  root@31.207.34.201:/tmp/
```

Puis installer les fichiers sur le VPS :

```powershell
ssh -i secrets\ticketpro_vps_ed25519 root@31.207.34.201 `
  "install -m 644 /tmp/TicketPro-Setup-0.2.0-x64.exe /opt/ticketpro/releases/ && \
  install -m 644 /tmp/TicketPro-Setup-0.2.0-x64.exe.sig /opt/ticketpro/releases/ && \
  install -m 644 /tmp/TicketPro-Setup-0.2.0-x64.exe.sha256 /opt/ticketpro/releases/"
```

La variable suivante, dans `/opt/ticketpro/infra/vps/.env`, détermine la
version téléchargée par le lien permanent :

```text
TICKETPRO_LATEST_WINDOWS_SETUP=TicketPro-Setup-0.2.0-x64.exe
```

Après sa modification, Caddy doit être recréé :

```sh
docker compose \
  -f /opt/ticketpro/infra/vps/docker-compose.yml \
  --project-directory /opt/ticketpro/infra/vps \
  up -d --force-recreate reverse-proxy
```

Cette opération est déjà réalisée pour `0.2.0`.

### Vérifier la distribution initiale

Vérifier la redirection :

```powershell
curl.exe -I "https://api.ticketpro-ne.com/download/windows"
```

Résultat attendu :

```text
HTTP/2 302
location: /releases/TicketPro-Setup-0.2.0-x64.exe
```

Vérifier le téléchargement :

```powershell
curl.exe -L `
  "https://api.ticketpro-ne.com/download/windows" `
  -o "$env:TEMP\TicketPro-Setup-0.2.0-x64.exe"
```

Vérifier son SHA-256 :

```powershell
Get-FileHash `
  "$env:TEMP\TicketPro-Setup-0.2.0-x64.exe" `
  -Algorithm SHA256
```

SHA-256 officiel de `0.2.0` :

```text
256bcfc8b09c0a832a66d37087cfff19e6cac08e7f1ae99037ddbdff4e1fa4a8
```

Pour cette première version, aucun manifeste Updater n'est publié. Les
utilisateurs doivent installer `0.2.0` manuellement.

## 3. Préparer la version 0.2.1

Depuis la racine du projet :

```powershell
Set-Location C:\Ticketpro
npm.cmd run version:set -- 0.2.1
cargo generate-lockfile --offline --manifest-path src-tauri\Cargo.toml
```

Cette commande synchronise la version dans :

- `package.json` ;
- `package-lock.json` ;
- `src-tauri/tauri.conf.json` ;
- `src-tauri/Cargo.toml` ;
- `src-tauri/Cargo.lock`.

Ne jamais republier un même numéro de version avec un autre binaire.

## 4. Exécuter les tests

```powershell
npm.cmd test
npm.cmd run type-check
npm.cmd run test:license-api
```

La version ne doit pas être construite ou publiée si l'un de ces contrôles
échoue.

## 5. Charger la clé privée Updater

Toutes les versions doivent être signées avec la même clé privée.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.ticketpro\updater.key"
```

Vérifier le chemin :

```powershell
Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH
```

Le résultat doit être `True`.

La clé privée et son mot de passe ne doivent jamais être envoyés sur le VPS,
ajoutés à GitHub ou partagés avec un client.

## 6. Construire la version 0.2.1

```powershell
npm.cmd run release:build:windows
```

Les fichiers attendus sont :

```text
TicketPro-Setup-0.2.1-x64.exe
TicketPro-Setup-0.2.1-x64.exe.sig
TicketPro-Setup-0.2.1-x64.exe.sha256
```

Ils se trouvent normalement dans :

```text
C:\Ticketpro\src-tauri\target\release\bundle\nsis
```

Si la compilation réussit mais que la signature doit être relancée
séparément :

```powershell
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue

npm.cmd run tauri -- signer sign `
  -f "$env:TAURI_SIGNING_PRIVATE_KEY_PATH" `
  "src-tauri\target\release\bundle\nsis\TicketPro_0.2.1_x64-setup.exe"

node scripts\rename-windows-installer.mjs
```

Tauri demandera directement le mot de passe de la clé.

## 7. Créer le manifeste

Le manifeste indique au serveur quelle version proposer.

```powershell
npm.cmd run release:manifest:windows -- `
  --installer "src-tauri\target\release\bundle\nsis\TicketPro-Setup-0.2.1-x64.exe" `
  --signature "src-tauri\target\release\bundle\nsis\TicketPro-Setup-0.2.1-x64.exe.sig" `
  --url "https://api.ticketpro-ne.com/releases/TicketPro-Setup-0.2.1-x64.exe" `
  --notes "Amélioration de la stabilité, corrections VPN et optimisation des vouchers."
```

Le fichier suivant est alors créé :

```text
output\app-updates\stable.json
```

Exemple de contenu :

```json
{
  "version": "0.2.1",
  "notes": "Amélioration de la stabilité, corrections VPN et optimisation des vouchers.",
  "pub_date": "2026-07-29T15:00:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://api.ticketpro-ne.com/releases/TicketPro-Setup-0.2.1-x64.exe",
      "signature": "SIGNATURE_ED25519"
    }
  }
}
```

## 8. Envoyer les fichiers sur le VPS

Depuis `C:\Ticketpro` :

```powershell
scp -i secrets\ticketpro_vps_ed25519 `
  "src-tauri\target\release\bundle\nsis\TicketPro-Setup-0.2.1-x64.exe" `
  "src-tauri\target\release\bundle\nsis\TicketPro-Setup-0.2.1-x64.exe.sig" `
  "output\app-updates\stable.json" `
  root@31.207.34.201:/tmp/
```

Puis publier :

```powershell
ssh -i secrets\ticketpro_vps_ed25519 root@31.207.34.201 `
  "sh /opt/ticketpro/infra/vps/publish-update.sh \
  /tmp/TicketPro-Setup-0.2.1-x64.exe \
  /tmp/TicketPro-Setup-0.2.1-x64.exe.sig \
  /tmp/stable.json"
```

Le script copie le setup et sa signature avant de publier le manifeste. Le
manifeste constitue l'interrupteur qui rend la mise à jour visible.

Le même script :

- génère le fichier `.sha256` sur le VPS ;
- met à jour `TICKETPRO_LATEST_WINDOWS_SETUP` ;
- recrée Caddy ;
- actualise le lien permanent `/download/windows` ;
- publie le manifeste Updater.

Le manifeste est publié en dernier. Ainsi, un client ne peut pas recevoir
l'annonce d'une version dont le setup n'est pas encore disponible.

## 9. Vérifier le serveur

### Simuler un poste en version 0.2.0

```powershell
curl.exe -i "https://api.ticketpro-ne.com/v1/app-updates/check?target=windows&arch=x86_64&current_version=0.2.0"
```

Résultat attendu :

```text
HTTP/2 200
```

La réponse doit contenir la version `0.2.1`, son URL, sa signature et les notes
de version.

### Simuler un poste déjà en version 0.2.1

```powershell
curl.exe -i "https://api.ticketpro-ne.com/v1/app-updates/check?target=windows&arch=x86_64&current_version=0.2.1"
```

Résultat attendu :

```text
HTTP/2 204
```

Cela signifie qu'aucune version plus récente n'est disponible.

## 10. Parcours dans l'application

Lorsqu'un utilisateur ouvre TicketPro `0.2.0` :

1. l'application contacte le serveur de mise à jour ;
2. une notification annonce la version `0.2.1` ;
3. l'utilisateur clique sur **Voir la mise à jour** ;
4. TicketPro ouvre **Paramètres > Mise à jour** ;
5. l'utilisateur clique sur **Sauvegarder et installer** ;
6. TicketPro crée un backup complet de la base SQLite ;
7. le setup est téléchargé par HTTPS ;
8. la signature Ed25519 est vérifiée ;
9. Windows installe la nouvelle version en mode passif ;
10. TicketPro redémarre en version `0.2.1`.

Les routeurs, tickets, plans, fichiers, comptes et paramètres doivent rester
présents.

## 11. Comportement en cas d'erreur

### Téléchargement interrompu

Aucune installation partielle n'est lancée. L'utilisateur peut recommencer
plus tard.

### Fichier modifié ou compromis

La signature ne correspond plus. Tauri refuse l'installation.

### Serveur indisponible

TicketPro continue à fonctionner normalement et pourra refaire la vérification
ultérieurement.

### Abonnement expiré

Les mises à jour restent accessibles, notamment pour permettre l'installation
des correctifs de sécurité.

### Problème après installation

Une sauvegarde locale a été créée avant l'installation. Elle peut être
restaurée depuis les paramètres de TicketPro.

## 12. Première simulation recommandée

1. Installer manuellement `0.2.0` uniquement sur un PC de test.
2. Vérifier que les données et les fonctionnalités principales fonctionnent.
3. Créer une modification visible dans `0.2.1`.
4. Construire et signer `0.2.1` avec la même clé.
5. Publier `0.2.1` sur le VPS.
6. Relancer TicketPro `0.2.0`.
7. Vérifier l'apparition de la notification.
8. Cliquer sur **Sauvegarder et installer**.
9. Vérifier le redémarrage en `0.2.1`.
10. Contrôler que toutes les données locales sont toujours présentes.

Il est préférable de réaliser cette simulation avant de distribuer `0.2.0` à
des clients. Si `0.2.1` passe tous les tests, elle peut devenir la première
version publique stable.

## 13. Nettoyage du terminal

Après chaque build ou signature :

```powershell
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
```

`TAURI_SIGNING_PRIVATE_KEY_PATH` peut rester défini : cette variable contient
uniquement un chemin, pas la clé privée elle-même.

## 14. Signature Windows

La signature Ed25519 protège le système de mise à jour TicketPro. Pour une
distribution publique sans avertissement **Éditeur inconnu**, le setup devra
également recevoir une signature Windows Authenticode avec un certificat de
signature de code Akicorp Solutions.
