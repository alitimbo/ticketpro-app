# Déployer l’API TicketPro sur le VPS

Cette procédure met à jour uniquement `ticketpro-license-api`. Elle ne reconstruit
pas le hub WireGuard et ne modifie pas ses clés.
Pour mettre à jour le hub WireGuard, suivre
[DEPLOIEMENT_HUB_WIREGUARD_VPS.md](DEPLOIEMENT_HUB_WIREGUARD_VPS.md).

## Architecture de production

- VPS : `31.207.34.201` (`vps122761`)
- Racine TicketPro : `/opt/ticketpro`
- API : `/opt/ticketpro/infra/license-api`
- Conteneur : `ticketpro-license-api`
- API locale : `http://127.0.0.1:8787`
- API publique : `https://api.ticketpro-ne.com`
- Clé SSH locale : `C:\Ticketpro\secrets\ticketpro_vps_ed25519`

Ne jamais copier `.env`, une clé privée WireGuard, un jeton ou une phrase de
sauvegarde dans Git, un ticket ou une capture d’écran.

## 1. Contrôles locaux obligatoires

Depuis PowerShell :

```powershell
Set-Location C:\Ticketpro

node --check infra/license-api/server.mjs
npm.cmd run type-check
npm.cmd run test:license-api

Set-Location C:\Ticketpro\infra\license-api
npm.cmd audit --omit=dev
```

Ne pas déployer si la syntaxe, le type-check ou les tests échouent. Examiner aussi
toute alerte de sécurité `npm audit` avant le déploiement.

Vérifier les changements à publier :

```powershell
Set-Location C:\Ticketpro
git status --short
git diff -- infra/license-api
```

## 2. Vérifier le VPS avant toute modification

```powershell
$TicketProSshKey = "C:\Ticketpro\secrets\ticketpro_vps_ed25519"
$TicketProVps = "root@31.207.34.201"

ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  'docker ps --filter name=ticketpro-license-api --filter name=ticketpro-wireguard-hub; curl -fsS http://127.0.0.1:8787/health'
```

Les deux conteneurs doivent être sains et `/health` doit retourner `"ok":true`.

## 3. Créer une sauvegarde chiffrée fraîche

Le VPS contient la phrase de sauvegarde dans un fichier root protégé. Ne jamais
l’afficher.

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  'set -eu; cd /opt/ticketpro/infra; BACKUP_PASSPHRASE_FILE=/root/.ticketpro-backup-passphrase ./vps/backup.sh /var/backups/ticketpro'
```

Noter le nom exact retourné, par exemple :

```text
ticketpro-vps-AAAAMMJJTHHMMSSZ.tar.gz.enc
```

Copier l’archive et son checksum hors du VPS :

```powershell
$TicketProBackup = "ticketpro-vps-AAAAMMJJTHHMMSSZ.tar.gz.enc"

scp -i $TicketProSshKey "${TicketProVps}:/var/backups/ticketpro/$TicketProBackup" `
  "C:\Ticketpro\backups\"
scp -i $TicketProSshKey "${TicketProVps}:/var/backups/ticketpro/$TicketProBackup.sha256" `
  "C:\Ticketpro\backups\"

$TicketProExpectedHash = (Get-Content "C:\Ticketpro\backups\$TicketProBackup.sha256").Split(' ')[0]
$TicketProActualHash = (Get-FileHash "C:\Ticketpro\backups\$TicketProBackup" -Algorithm SHA256).Hash
if ($TicketProExpectedHash -ne $TicketProActualHash) {
  throw "Checksum de sauvegarde invalide. Déploiement annulé."
}
```

## 4. Préparer le fichier sans écraser la production

Utiliser un identifiant UTC unique :

```powershell
$TicketProDeployId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$TicketProStage = "/opt/ticketpro/staging/license-api-$TicketProDeployId"

ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  "install -d -m 700 $TicketProStage"

scp -i $TicketProSshKey -o BatchMode=yes `
  "C:\Ticketpro\infra\license-api\server.mjs" `
  "${TicketProVps}:$TicketProStage/server.mjs"

$TicketProLocalApiHash = (Get-FileHash "C:\Ticketpro\infra\license-api\server.mjs" -Algorithm SHA256).Hash.ToLowerInvariant()
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  "sha256sum $TicketProStage/server.mjs; node --check $TicketProStage/server.mjs"
```

Le SHA-256 distant doit être identique à `$TicketProLocalApiHash` et la vérification
Node ne doit afficher aucune erreur.

## 5. Déployer uniquement l’API

La commande suivante conserve le fichier précédent et marque l’image Docker
actuelle avant de reconstruire l’API :

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  "set -eu; cp -p /opt/ticketpro/infra/license-api/server.mjs /opt/ticketpro/deploy-backups/server.mjs.before-$TicketProDeployId; docker image tag license-api-license-api ticketpro-license-api:rollback-$TicketProDeployId; install -m 664 $TicketProStage/server.mjs /opt/ticketpro/infra/license-api/server.mjs; cd /opt/ticketpro/infra/license-api; docker compose up -d --build --no-deps license-api"
```

Ne pas utiliser `infra/vps/deploy.sh` pour une simple mise à jour de l’API : ce
script reconstruit également le hub WireGuard.

## 6. Validation après déploiement

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  'docker ps --filter name=ticketpro-license-api --filter name=ticketpro-wireguard-hub; docker logs --tail 100 ticketpro-license-api; curl -fsS http://127.0.0.1:8787/health'

curl.exe -fsS https://api.ticketpro-ne.com/health
```

Résultat attendu :

- `ticketpro-license-api` : `healthy` ;
- `ticketpro-wireguard-hub` : toujours `healthy`, sans redémarrage ;
- santé locale et publique : `"ok":true` ;
- aucune boucle de redémarrage ou erreur SQLite dans les logs.

Après une migration SQLite, contrôler aussi l’intégrité :

```bash
docker exec -i ticketpro-license-api node --experimental-sqlite <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/data/licenses.sqlite', { readOnly: true });
console.log(db.prepare('PRAGMA integrity_check').get());
console.log('foreign-key-errors=', db.prepare('PRAGMA foreign_key_check').all().length);
NODE
```

Le résultat doit indiquer `ok` et `foreign-key-errors= 0`.

## 7. Rollback rapide de l’API

Utiliser l’identifiant du déploiement à annuler :

```powershell
$TicketProDeployId = "AAAAMMJJTHHMMSSZ"

ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  "set -eu; cp -p /opt/ticketpro/deploy-backups/server.mjs.before-$TicketProDeployId /opt/ticketpro/infra/license-api/server.mjs; docker image tag ticketpro-license-api:rollback-$TicketProDeployId license-api-license-api:latest; cd /opt/ticketpro/infra/license-api; docker compose up -d --no-deps --force-recreate license-api; curl -fsS http://127.0.0.1:8787/health"
```

Ce rollback remet le code précédent sans toucher au hub. Pour restaurer les
données SQLite elles-mêmes, utiliser l’archive chiffrée et
`infra/vps/restore.sh`. Cette opération arrête plusieurs services et ne doit être
faite que si la base est réellement corrompue ou si la migration de données doit
être annulée.

## 8. Validation fonctionnelle mobile

Après le déploiement du provisioning mobile :

1. ouvrir l’app Android/iOS et se connecter au compte TicketPro ;
2. vérifier que le téléphone apparaît dans **Mes appareils** avec sa plateforme ;
3. connecter le tunnel et confirmer qu’émis/reçu augmentent ;
4. demander **Nouvelle clé** depuis le desktop ;
5. attendre le heartbeat mobile et vérifier que la version de clé augmente ;
6. révoquer le téléphone depuis **Mes appareils** ;
7. confirmer que le pair est supprimé immédiatement du hub et que l’app détecte
   la révocation au plus tard au heartbeat suivant.

## Historique du déploiement mobile initial

Le 22 septembre 2026, le provisioning Android/iOS a été déployé avec :

- sauvegarde : `ticketpro-vps-20260922T105803Z.tar.gz.enc` ;
- sauvegarde locale vérifiée par SHA-256 ;
- ancien fichier :
  `/opt/ticketpro/deploy-backups/server.mjs.before-mobile-provisioning-20260922T1105Z` ;
- image de rollback :
  `ticketpro-license-api:rollback-mobile-provisioning-20260922T1105Z`.

