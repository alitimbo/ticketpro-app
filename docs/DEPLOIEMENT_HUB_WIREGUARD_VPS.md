# Déployer le hub WireGuard TicketPro sur le VPS

Cette procédure met à jour **uniquement** le code du hub WireGuard
(`ticketpro-wireguard-hub`). Elle ne touche ni à l’API de licences, ni au
reverse proxy, ni aux clés WireGuard, ni aux pairs déjà enregistrés.

Pour l’API de licences, suivre [DEPLOIEMENT_API_VPS.md](DEPLOIEMENT_API_VPS.md).
Ne pas utiliser `infra/vps/deploy.sh` pour une simple mise à jour : ce script
reconstruit tous les services.

## Architecture de production

- VPS : `31.207.34.201` (`vps122761`)
- Racine TicketPro : `/opt/ticketpro`
- Hub : `/opt/ticketpro/infra/wireguard-hub`
- Conteneur : `ticketpro-wireguard-hub` (`network_mode: host`)
- Interface WireGuard : `wg0`, UDP `51820`
- API interne du hub : `http://127.0.0.1:8788` (jamais exposée)
- Clé SSH locale : `C:\Ticketpro\secrets\ticketpro_vps_ed25519`

### Ce qui est déployé, ce qui ne l’est jamais

| Déployé par cette procédure | Jamais copié depuis Git |
| --- | --- |
| `server.mjs` | `.env` (jeton maître, clés publiques, domaine) |
| `peer-lifecycle.mjs` | `wireguard/` (clé privée serveur, `wg0.conf`) |
| `tenant-firewall.mjs` | `data/` (`tenants.json`, pairs enregistrés) |
| `start.sh` | |
| `Dockerfile` | |

`docker-compose.yml` n’est pas copié automatiquement : la version de production
peut contenir des réglages propres au VPS. Une modification de ce fichier se
reporte à la main après comparaison (étape 5).

### Pourquoi les tunnels ne tombent pas

Le hub tourne en `network_mode: host` : `wg0` est une interface du VPS lui-même,
pas du conteneur. Quand le conteneur redémarre, `start.sh` retrouve `wg0` déjà
active et applique seulement `wg syncconf`. Les tunnels des routeurs et des
postes restent établis. Seule l’API interne du hub (port `8788`) est
indisponible quelques secondes : une création ou révocation de pair lancée à
cet instant précis doit être relancée.

Ne jamais copier `.env`, une clé privée WireGuard, un jeton ou une phrase de
sauvegarde dans Git, un ticket ou une capture d’écran.

## Toutes les commandes, dans l’ordre

Depuis PowerShell, dans `C:\Ticketpro`. Exécuter les blocs un par un, vérifier
le résultat attendu avant de passer au suivant, et garder la même fenêtre
PowerShell jusqu’au bout (les variables y restent définies).

### 0. Choisir la version à déployer

Déployer de préférence depuis `main`, après fusion de la PR. Pour tester une
correction avant fusion, remplacer `main` par `development`.

```powershell
Set-Location C:\Ticketpro
git fetch origin
git switch main
git pull
git status --short
git log --oneline -1
```

`git status --short` doit être vide : on déploie exactement le commit affiché.

### 1. Contrôles locaux obligatoires

```powershell
Set-Location C:\Ticketpro

node --check infra/wireguard-hub/server.mjs
node --check infra/wireguard-hub/peer-lifecycle.mjs
node --check infra/wireguard-hub/tenant-firewall.mjs
node --test infra/wireguard-hub/peer-lifecycle.node-test.mjs infra/wireguard-hub/tenant-firewall.node-test.mjs
```

Ne pas déployer si une vérification ou un test échoue.

Relire les changements qui partiront en production (comparer avec la dernière
version déployée, par exemple le tag ou le commit du déploiement précédent) :

```powershell
git log --oneline -10 -- infra/wireguard-hub
git diff HEAD~1 -- infra/wireguard-hub
```

### 2. Variables et état du VPS avant modification

```powershell
$TicketProSshKey = "C:\Ticketpro\secrets\ticketpro_vps_ed25519"
$TicketProVps = "root@31.207.34.201"

ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  'docker ps --filter name=ticketpro-license-api --filter name=ticketpro-wireguard-hub; curl -fsS http://127.0.0.1:8787/health; echo; curl -fsS http://127.0.0.1:8788/health; echo; wg show wg0 latest-handshakes | head -20; iptables -t mangle -S FORWARD'
```

Attendu :

- les deux conteneurs `healthy` ;
- `"ok":true` pour l’API (8787) et une réponse du hub (8788) ;
- des handshakes récents (horodatages proches de maintenant) ;
- noter les règles `mangle FORWARD` affichées, pour comparer après déploiement.

### 3. Sauvegarde chiffrée fraîche

Identique à la procédure API. Ne jamais afficher la phrase de sauvegarde.

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  'set -eu; cd /opt/ticketpro/infra; BACKUP_PASSPHRASE_FILE=/root/.ticketpro-backup-passphrase ./vps/backup.sh /var/backups/ticketpro'
```

Recopier le nom exact affiché :

```powershell
$TicketProBackup = "ticketpro-vps-AAAAMMJJTHHMMSSZ.tar.gz.enc"

scp -i $TicketProSshKey "${TicketProVps}:/var/backups/ticketpro/$TicketProBackup" "C:\Ticketpro\backups\"
scp -i $TicketProSshKey "${TicketProVps}:/var/backups/ticketpro/$TicketProBackup.sha256" "C:\Ticketpro\backups\"

$TicketProExpectedHash = (Get-Content "C:\Ticketpro\backups\$TicketProBackup.sha256").Split(' ')[0]
$TicketProActualHash = (Get-FileHash "C:\Ticketpro\backups\$TicketProBackup" -Algorithm SHA256).Hash
if ($TicketProExpectedHash -ne $TicketProActualHash) {
  throw "Checksum de sauvegarde invalide. Déploiement annulé."
}
"Sauvegarde vérifiée"
```

### 4. Préparer les fichiers sans toucher à la production

L’archive est produite par Git à partir du commit choisi, avec des fins de ligne
Unix (`core.autocrlf=false`) : un `start.sh` en fins de ligne Windows ne
démarrerait pas. Seuls les fichiers de code partent ; ni `.env`, ni
`wireguard/`, ni `data/`.

```powershell
$TicketProDeployId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$TicketProStage = "/opt/ticketpro/staging/wireguard-hub-$TicketProDeployId"
$TicketProHubArchive = "$env:TEMP\wireguard-hub-$TicketProDeployId.tar"
"ID de déploiement à conserver : $TicketProDeployId"

git -c core.autocrlf=false archive --format=tar -o $TicketProHubArchive HEAD `
  infra/wireguard-hub/server.mjs `
  infra/wireguard-hub/peer-lifecycle.mjs `
  infra/wireguard-hub/tenant-firewall.mjs `
  infra/wireguard-hub/start.sh `
  infra/wireguard-hub/Dockerfile

$TicketProHubArchiveHash = (Get-FileHash $TicketProHubArchive -Algorithm SHA256).Hash.ToLowerInvariant()
"SHA-256 local : $TicketProHubArchiveHash"

ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps "install -d -m 700 $TicketProStage"
scp -i $TicketProSshKey -o BatchMode=yes $TicketProHubArchive "${TicketProVps}:$TicketProStage/hub.tar"

ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps "set -eu; cd $TicketProStage; sha256sum hub.tar; tar -xf hub.tar --strip-components=2; rm hub.tar; ls -l; for f in server.mjs peer-lifecycle.mjs tenant-firewall.mjs; do node --check `$f; done; sh -n start.sh; grep -c `$(printf '\r') start.sh || true; echo PREPARATION_OK"
```

Attendu :

- le SHA-256 affiché par le VPS est identique au SHA-256 local ;
- les cinq fichiers sont listés ;
- aucune erreur de `node --check` ni de `sh -n` ;
- le nombre de retours chariot affiché est `0` ;
- la dernière ligne est `PREPARATION_OK`.

### 5. Comparer avec la production

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps "cd /opt/ticketpro/infra/wireguard-hub; for f in server.mjs peer-lifecycle.mjs tenant-firewall.mjs start.sh Dockerfile; do echo ===== `$f; diff -u `$f $TicketProStage/`$f || true; done"
```

Le diff doit correspondre exactement aux changements relus à l’étape 1. Tout
écart inattendu signifie que la production a été modifiée à la main : s’arrêter
et comprendre avant de continuer.

Si `docker-compose.yml` a changé dans Git, comparer aussi :

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps 'cat /opt/ticketpro/infra/wireguard-hub/docker-compose.yml'
git show HEAD:infra/wireguard-hub/docker-compose.yml
```

et reporter à la main, sur le VPS, uniquement les lignes nouvelles.

### 6. Déployer le hub seul

À faire de préférence à une heure calme. La commande :

1. conserve les cinq fichiers actuels dans
   `/opt/ticketpro/deploy-backups/wireguard-hub-before-<ID>` ;
2. marque l’image Docker actuelle `ticketpro-wireguard-hub:rollback-<ID>` ;
3. installe les nouveaux fichiers ;
4. reconstruit et redémarre **uniquement** `wireguard-hub` (`--no-deps`).

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps "set -eu; H=/opt/ticketpro/infra/wireguard-hub; B=/opt/ticketpro/deploy-backups/wireguard-hub-before-$TicketProDeployId; install -d -m 700 `$B; for f in server.mjs peer-lifecycle.mjs tenant-firewall.mjs start.sh Dockerfile; do cp -p `$H/`$f `$B/`$f; done; docker image tag `$(docker inspect --format '{{.Config.Image}}' ticketpro-wireguard-hub) ticketpro-wireguard-hub:rollback-$TicketProDeployId; for f in server.mjs peer-lifecycle.mjs tenant-firewall.mjs Dockerfile; do install -m 644 $TicketProStage/`$f `$H/`$f; done; install -m 755 $TicketProStage/start.sh `$H/start.sh; cd `$H; docker compose up -d --build --no-deps wireguard-hub"
```

Le caractère `` ` `` devant `$` est volontaire : il empêche PowerShell
d’interpréter ces variables, qui doivent l’être par le shell du VPS.

### 7. Validation après déploiement

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps `
  'sleep 20; docker ps --filter name=ticketpro-license-api --filter name=ticketpro-wireguard-hub; docker logs --tail 80 ticketpro-wireguard-hub; curl -fsS http://127.0.0.1:8788/health; echo; curl -fsS http://127.0.0.1:8787/health; echo; wg show wg0 latest-handshakes | head -20; iptables -t mangle -S FORWARD'

curl.exe -fsS https://api.ticketpro-ne.com/health
```

Attendu :

- `ticketpro-wireguard-hub` : `healthy`, sans boucle de redémarrage ;
- `ticketpro-license-api` : toujours `healthy` et **non redémarrée** (son
  « Up depuis » n’a pas changé) ;
- santé du hub, de l’API locale et de l’API publique : réponses OK ;
- handshakes toujours récents : les tunnels n’ont pas été coupés ;
- règles `mangle FORWARD` : celles attendues par la nouvelle version, sans
  doublon (voir l’annexe A pour le MSS).

Validation fonctionnelle dans TicketPro :

1. ouvrir un routeur par le VPN depuis le poste ;
2. la page Maison doit s’afficher en quelques secondes, listes comprises ;
3. activer puis désactiver « Accès à distance » sur un routeur de test pour
   vérifier la création et la suppression d’un pair.

Une fois tout validé, nettoyer la zone d’attente et l’archive locale :

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps "rm -rf $TicketProStage"
Remove-Item $TicketProHubArchive
```

Les copies de `deploy-backups` et l’image `rollback-<ID>` sont conservées pour
un retour arrière.

### 8. Retour arrière rapide

Utiliser l’identifiant du déploiement à annuler :

```powershell
$TicketProSshKey = "C:\Ticketpro\secrets\ticketpro_vps_ed25519"
$TicketProVps = "root@31.207.34.201"
$TicketProDeployId = "AAAAMMJJTHHMMSSZ"

ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps "set -eu; H=/opt/ticketpro/infra/wireguard-hub; B=/opt/ticketpro/deploy-backups/wireguard-hub-before-$TicketProDeployId; for f in server.mjs peer-lifecycle.mjs tenant-firewall.mjs start.sh Dockerfile; do cp -p `$B/`$f `$H/`$f; done; cd `$H; docker image tag ticketpro-wireguard-hub:rollback-$TicketProDeployId `$(docker inspect --format '{{.Config.Image}}' ticketpro-wireguard-hub); docker compose up -d --no-deps --force-recreate wireguard-hub; sleep 20; docker ps --filter name=ticketpro-wireguard-hub; curl -fsS http://127.0.0.1:8788/health"
```

Le retour arrière remet les fichiers et l’image précédents sans toucher aux
clés, aux pairs ni à l’API. Une règle `iptables` ajoutée par la nouvelle
version peut rester active après retour arrière : la retirer avec la commande
correspondante de l’annexe A si nécessaire.

Restaurer les données elles-mêmes (`wireguard/`, `data/`) passe par l’archive
chiffrée et `infra/vps/restore.sh`. Cette opération arrête plusieurs services :
ne la faire que si les clés ou `tenants.json` sont réellement perdus ou
corrompus.

## Annexe A — Limitation du MSS TCP (depuis le commit `922137b`)

`start.sh` borne le MSS des connexions TCP relayées par `wg0` (1240 octets par
défaut). Sans cette limite, sur un routeur raccordé en PPPoE ou en 4G, les
grandes réponses RouterOS (liste des vouchers, sessions) se perdent dans le
double tunnel poste → VPS → routeur : le routeur paraît en ligne mais les
pages ne finissent jamais de charger.

Valeur par défaut : `1240`. Pour la changer, ajouter dans `environment:` du
`docker-compose.yml` de production, puis redéployer (étape 6) :

```yaml
      TICKETPRO_WG_TCP_MSS: "1360"
```

### Activer la règle tout de suite, sans redémarrage

Utile pour corriger immédiatement, avant le déploiement complet de l’étape 6.
La commande retire d’abord les règles identiques, puis les ajoute : elle peut
être relancée sans créer de doublon.

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps 'set -eu
for d in "-i wg0" "-o wg0"; do
  while docker exec ticketpro-wireguard-hub iptables -t mangle -D FORWARD $d -p tcp --tcp-flags SYN,RST SYN -m tcpmss --mss 1241:65535 -j TCPMSS --set-mss 1240 2>/dev/null; do :; done
  docker exec ticketpro-wireguard-hub iptables -t mangle -A FORWARD $d -p tcp --tcp-flags SYN,RST SYN -m tcpmss --mss 1241:65535 -j TCPMSS --set-mss 1240
done
docker exec ticketpro-wireguard-hub iptables -t mangle -S FORWARD'
```

Attendu : exactement deux lignes `TCPMSS --set-mss 1240`, une avec `-i wg0`,
une avec `-o wg0`.

### Retirer la règle

```powershell
ssh -i $TicketProSshKey -o BatchMode=yes $TicketProVps 'for d in "-i wg0" "-o wg0"; do while docker exec ticketpro-wireguard-hub iptables -t mangle -D FORWARD $d -p tcp --tcp-flags SYN,RST SYN -m tcpmss --mss 1241:65535 -j TCPMSS --set-mss 1240 2>/dev/null; do :; done; done; docker exec ticketpro-wireguard-hub iptables -t mangle -S FORWARD'
```

Si une valeur autre que 1240 est configurée, remplacer `1240` par cette valeur
et `1241` par cette valeur + 1 dans les deux commandes.

## Annexe B — Dépannage

| Symptôme | Vérification | Cause probable |
| --- | --- | --- |
| Le hub redémarre en boucle | `docker logs --tail 100 ticketpro-wireguard-hub` | `wg0.conf` absent, `net.ipv4.ip_forward` désactivé, ou `start.sh` en fins de ligne Windows |
| `exec /app/start.sh: no such file or directory` | `grep -c $(printf '\r') start.sh` | Fins de ligne Windows : refaire l’étape 4 avec `core.autocrlf=false` |
| Plus aucun handshake récent | `wg show wg0` | Interface laissée DOWN : `start.sh` la remonte, vérifier les logs |
| Routeur « en ligne » mais pages qui chargent sans fin | `iptables -t mangle -S FORWARD \| grep TCPMSS` | Règle MSS absente : annexe A |
| Création ou révocation de pair en échec juste après le déploiement | `curl -fsS http://127.0.0.1:8788/health` | API du hub en cours de redémarrage : relancer l’action |

## Historique des déploiements

Ajouter une ligne après chaque déploiement réussi.

| Date (UTC) | ID de déploiement | Commit | Sauvegarde | Objet |
| --- | --- | --- | --- | --- |
| | | `922137b` | | Limitation du MSS TCP sur `wg0` (pages Maison qui chargent sans fin) |
