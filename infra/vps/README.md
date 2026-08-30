# Exploitation et migration du VPS TicketPro

## Déploiement

Les trois services sont :

- le hub WireGuard sur `127.0.0.1:8788` et UDP `51820` ;
- l'API de licences sur `127.0.0.1:8787` ;
- Caddy sur les ports publics HTTP/HTTPS avec certificats automatiques.

Configurer d'abord les deux enregistrements DNS vers le VPS, puis initialiser les
secrets et WireGuard sans les saisir dans l'application :

```bash
chmod +x vps/*.sh
export API_DOMAIN='api.ticketpro-ne.com'
export VPN_PUBLIC_ENDPOINT='vpn.ticketpro-ne.com'
# Facultatif au premier déploiement :
export IPAY_ENV='disabled'
./vps/initialize.sh
./vps/deploy.sh
```

`initialize.sh` refuse d'écraser une installation existante. Les secrets générés
doivent ensuite être sauvegardés avec `backup.sh`.

Pour activer les paiements plus tard, renseigner `IPAY_ENV`, `IPAY_PUBLIC_KEY`,
`IPAY_PRIVATE_KEY` et `IPAY_SECRET_HASH` dans `license-api/.env`, puis redémarrer
uniquement l'API de licences.

Le hub n'est jamais exposé en HTTP. Seule l'API de licences passe par Caddy.
Le pare-feu public doit autoriser TCP `80`, TCP `443`, UDP `51820` et le port SSH
d'administration.

Si le VPS possède déjà Nginx ou un autre reverse proxy, définir
`REVERSE_PROXY_MODE=external` avant `initialize.sh`. Le script de déploiement ne
démarrera alors pas Caddy et l'API locale `127.0.0.1:8787` devra être ajoutée au
reverse proxy existant. Un modèle Nginx est fourni dans `vps/nginx-ticketpro.conf`.

Avant le premier déploiement :

```bash
sudo cp vps/99-ticketpro.conf /etc/sysctl.d/99-ticketpro.conf
sudo sysctl --system
```

Configurer le pare-feu du fournisseur et celui du système. Ne pas automatiser la
règle SSH sans connaître votre port d'administration : une mauvaise règle
pourrait verrouiller le VPS.

## Données à ne jamais perdre

Une migration complète exige les quatre ensembles suivants :

- le snapshot SQLite de l'API de licences ;
- `license-api/.env`, notamment `LICENSE_HASH_SECRET`, `ROUTER_VAULT_KEY` et `TICKET_ARCHIVE_KEY` ;
- `wireguard-hub/.env` et `wireguard-hub/data/tenants.json` ;
- tout `wireguard-hub/wireguard`, notamment la clé privée et `wg0.conf`.

Sans la clé privée WireGuard, les routeurs déjà configurés ne reconnaîtront plus le
serveur. Sans `LICENSE_HASH_SECRET`, les clés, sessions et jetons existants ne
pourront plus être vérifiés. Sans `ROUTER_VAULT_KEY`, les identifiants RouterOS
du catalogue de reprise deviennent définitivement illisibles. Sans
`TICKET_ARCHIVE_KEY`, les archives de réimpression multi-PC des vouchers ne
peuvent plus être déchiffrées.

## Sauvegarde chiffrée

Depuis le dossier `infra` du VPS :

```bash
chmod +x vps/preflight.sh vps/backup.sh vps/restore.sh
./vps/preflight.sh
export BACKUP_PASSPHRASE='une-phrase-tres-longue-conservee-hors-du-vps'
export BACKUP_REMOTE='stockage-ticketpro:backups-vps'
./vps/backup.sh /var/backups/ticketpro
```

Pour une tâche cron, la phrase peut être placée dans un fichier root `600` et
référencée avec `BACKUP_PASSPHRASE_FILE`, sans apparaître dans la ligne de
commande.

Le script crée un snapshot SQLite cohérent avec `VACUUM INTO`, contrôle son
intégrité, rassemble l'identité WireGuard et les secrets, calcule les sommes
SHA-256 puis chiffre l'archive avec AES-256 et PBKDF2.

Copier chaque fichier `.enc` et son `.sha256` vers un stockage extérieur au VPS.
Une sauvegarde conservée uniquement sur le VPS ne protège ni d'une panne disque,
ni d'une suppression du serveur.

Si `BACKUP_REMOTE` est défini, le script utilise `rclone` pour envoyer
automatiquement l'archive et sa somme de contrôle hors du VPS. La rétention locale
est de 35 jours par défaut et peut être modifiée avec `BACKUP_RETENTION_DAYS`.

Exemple de planification quotidienne à 02:15 avec un fichier d'environnement
accessible uniquement à root :

```cron
15 2 * * * . /root/.ticketpro-backup-env && /opt/ticketpro/infra/vps/backup.sh /var/backups/ticketpro >> /var/log/ticketpro-backup.log 2>&1
```

Le transfert hors site et la rétention doivent être ajoutés selon le stockage
choisi. Recommandation : 7 sauvegardes quotidiennes, 4 hebdomadaires et
12 mensuelles.

## Migration vers un nouveau VPS

1. Installer Docker, Compose, WireGuard et OpenSSL sur le nouveau VPS.
2. Activer `net.ipv4.ip_forward=1` de façon persistante.
3. Copier le dossier `infra`, l'archive chiffrée et sa somme SHA-256.
4. Vérifier l'archive : `sha256sum -c ticketpro-vps-....enc.sha256`.
5. Lancer la restauration :

```bash
export BACKUP_PASSPHRASE='la-meme-phrase-secrete'
./infra/vps/restore.sh /chemin/ticketpro-vps-....tar.gz.enc
```

6. Faire pointer le DNS vers le nouveau VPS et conserver les mêmes domaines HTTPS.
7. Ouvrir UDP 51820 et les seuls ports HTTP/HTTPS du reverse proxy.
8. Vérifier `docker compose ps`, les endpoints `/health`, un login administrateur,
   une validation de licence et la remontée d'un routeur réel.

Si l'adresse publique WireGuard change mais que le nom de domaine utilisé dans les
configurations des routeurs reste identique, une mise à jour DNS suffit. Si une IP
brute a été injectée dans les routeurs, leur endpoint devra être mis à jour.

## Test obligatoire

Tester une restauration sur un VPS de préproduction au moins une fois par mois.
Une archive non restaurée avec succès ne doit pas être considérée comme une
sauvegarde fiable.
