# Hub WireGuard TicketPro

Ce service est le plan de contrôle du VPN. Il ajoute et révoque les pairs sur `wg0` avec `wg set`, puis sauvegarde la configuration. Son secret maître n'est connu que par l'API de licences sur le même VPS : il n'est jamais transmis à l'application cliente.

Chaque licence obtient automatiquement un sous-réseau `/24` dans le supernet `10.250.0.0/16`. Les adresses des pairs sont attribuées par le hub afin d'éviter les collisions entre plusieurs PC. Une chaîne `iptables` autorise uniquement les communications à l'intérieur du sous-réseau de la licence et bloque les échanges entre organisations.

## Déploiement sur un VPS Linux

1. Installer Docker et ouvrir uniquement UDP `51820`. Publier l’API locale `8788` derrière HTTPS (reverse proxy, VPN d’administration ou tunnel privé) ; ne pas exposer l’API HTTP directement à Internet. L’API de licences conserve le port local `8787`.
2. Copier ce dossier sur le VPS, créer `wireguard/wg0.conf` à partir de l’exemple et générer la clé serveur :

```bash
umask 077
wg genkey | tee wireguard/server_private.key | wg pubkey > wireguard/server_public.key
sed -i "s/REMPLACER_PAR_LA_CLE_PRIVEE_DU_SERVEUR/$(cat wireguard/server_private.key)/" wireguard/wg0.conf
```

3. Créer `.env` à partir de `.env.example` et générer le secret d’administration : `openssl rand -hex 32`.
4. Démarrer le hub : `docker compose up -d --build`.
5. Copier la clé publique dans `HUB_SERVER_PUBLIC_KEY`, définir le domaine WireGuard dans `HUB_PUBLIC_ENDPOINT`, puis recopier exactement `HUB_MASTER_TOKEN` dans `VPN_HUB_MASTER_TOKEN` de l'API de licences.
6. L'application récupère automatiquement son endpoint, sa clé publique et son sous-réseau auprès de l'API de licences. L'utilisateur ne saisit aucune configuration VPS.

Le serveur WireGuard ne reçoit jamais les clés privées des routeurs ou des opérateurs. TicketPro conserve ces clés localement chiffrées et le hub ne reçoit que leur clé publique.

## Cycle de vie sécurisé des clés

Chaque pair possède un `resource_id` stable : identifiant du routeur ou identifiant unique du poste opérateur. Le hub sérialise les mutations d'un même compte et refuse deux clés actives pour la même ressource.

- `upsert` crée une clé ou retourne la même configuration lors d'une répétition identique ; il refuse de remplacer silencieusement une autre clé active.
- `rotate` exige `previous_public_key`, retire d'abord l'ancienne clé de `wg0`, conserve son historique comme révoqué, puis active la nouvelle clé avec la même adresse. Une nouvelle installation reçoit en revanche une adresse jamais attribuée auparavant dans le tenant.
- `disable` retire le pair de `wg0` sans libérer son adresse et autorise sa
  réactivation après renouvellement de l'abonnement.
- `revoke` retire immédiatement la clé de `wg0`. Une clé révoquée ne peut jamais être réactivée.
- `POST /v1/peers/list` expose l'état réel `connected`, `disconnected` ou `revoked` ainsi que la date du dernier handshake.

Après une mise à jour du service, le démarrage révoque automatiquement les anciens doublons éventuels avant de resynchroniser `wg0`.
