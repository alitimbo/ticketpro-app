# Mises à jour TicketPro

TicketPro utilise l'Updater officiel Tauri. Une mise à jour Windows suit ce
parcours :

1. l'application interroge publiquement
   `https://license.autoticket-ne.com/v1/app-updates/check` ;
2. l'API répond `204` lorsqu'aucune version plus récente n'existe ;
3. sinon, elle renvoie l'URL HTTPS, les notes et la signature Ed25519 ;
4. TicketPro crée une sauvegarde SQLite locale ;
5. l'installateur est téléchargé, sa signature est vérifiée, puis il est lancé
   en mode passif ;
6. l'application redémarre sur la nouvelle version.

L'endpoint reste public : une organisation dont l'abonnement est expiré doit
toujours pouvoir recevoir un correctif de sécurité.

## Première cérémonie de clé

Cette opération doit être faite une seule fois par les cofondateurs, sur une
machine de confiance. Choisir un mot de passe long et conserver deux copies
hors ligne de la clé privée.

```powershell
npx.cmd tauri signer generate -w "$env:USERPROFILE\.ticketpro\updater.key"
```

La commande produit :

- `updater.key` : secret absolu, jamais envoyé au VPS ni ajouté au dépôt ;
- `updater.key.pub` : clé publique à placer dans
  `src-tauri/tauri.conf.json`, propriété `plugins.updater.pubkey`.

La clé publique officielle est enregistrée dans `tauri.conf.json`. Le
préflight empêche toujours un build officiel si la clé privée ou son mot de
passe ne sont pas chargés dans les variables d'environnement du terminal.

Avant le build, charger les secrets uniquement dans le terminal courant :

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.ticketpro\updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Read-Host "Mot de passe de la clé"
npm.cmd run release:build:windows
```

Perdre cette clé privée empêcherait les installations déjà diffusées
d'accepter les futures mises à jour.

## Publication d'une version

Après le build, trois fichiers doivent être présents :

```text
TicketPro-Setup-<version>-x64.exe
TicketPro-Setup-<version>-x64.exe.sig
TicketPro-Setup-<version>-x64.exe.sha256
```

Créer le manifeste :

```powershell
npm.cmd run release:manifest:windows -- `
  --installer "CHEMIN\TicketPro-Setup-<version>-x64.exe" `
  --signature "CHEMIN\TicketPro-Setup-<version>-x64.exe.sig" `
  --url "https://license.autoticket-ne.com/releases/TicketPro-Setup-<version>-x64.exe" `
  --notes "Résumé des changements"
```

Envoyer le setup, sa signature et `output/app-updates/stable.json` sur le VPS,
puis exécuter depuis le dépôt présent sur le serveur :

```sh
sudo sh ./infra/vps/publish-update.sh \
  /tmp/TicketPro-Setup-<version>-x64.exe \
  /tmp/TicketPro-Setup-<version>-x64.exe.sig \
  /tmp/stable.json
```

Caddy sert les installateurs depuis `/opt/ticketpro/releases`. Le manifeste
reste dans le volume Docker persistant de l'API, sous
`/data/app-updates/stable.json`.

## Règles de version

- utiliser SemVer : `MAJEURE.MINEURE.CORRECTIF` ;
- ne jamais republier un même numéro avec un autre binaire ;
- publier d'abord une version interne, puis la version stable ;
- tester installation, redémarrage, sauvegarde et restauration sur un PC
  Windows propre ;
- Authenticode signe l'éditeur Windows ; la signature Ed25519 Tauri protège le
  canal de mise à jour. Les deux protections sont complémentaires.
