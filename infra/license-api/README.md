# TicketPro SaaS API

API centrale TicketPro pour les comptes d'organisation, les abonnements, les
paiements iPay et le VPN distant. Les routes historiques de licences et de
revendeurs sont conservées temporairement uniquement pour la migration.

SQLite conserve les mots de passe avec `scrypt` et uniquement les HMAC des
sessions. Les jetons en clair ne sont retournés qu'au moment de leur création.

## Parcours SaaS principal

```text
POST /v1/saas/register-and-pay
→ création du compte en attente
→ paiement iPay
→ POST /v1/payments/orders/status
→ POST /v1/saas/registration/complete
→ session SaaS et abonnement actif
```

Une organisation peut se connecter depuis plusieurs PC. Le quota porte sur les
routeurs, pas sur le nombre d'installations. À l'expiration, la connexion, le
compte et le paiement restent accessibles, mais les services opérationnels et
le VPN répondent avec `402 SUBSCRIPTION_REQUIRED`.

Routes principales :

- `GET /v1/plans`
- `POST /v1/saas/register-trial`
- `POST /v1/saas/register-and-pay`
- `POST /v1/saas/registration/complete`
- `POST /v1/saas/auth/login`
- `GET /v1/saas/auth/me`
- `POST /v1/saas/auth/switch-organization`
- `POST /v1/saas/auth/logout`
- `POST /v1/saas/auth/forgot-password`
- `POST /v1/saas/auth/reset-password`
- `POST /v1/saas/invitations/inspect`
- `POST /v1/saas/invitations/accept`
- `POST /v1/saas/subscriptions/purchase`
- `GET /v1/saas/services/access`
- `POST /v1/saas/vpn/bootstrap`
- `POST /v1/saas/vpn/peers`
- `POST /v1/saas/devices/register`
- `GET /v1/saas/devices`
- `POST /v1/saas/devices/heartbeat`
- `POST /v1/saas/devices/revoke`
- `POST /v1/saas/migrate-license`
- `GET /v1/saas/team`
- `POST /v1/saas/team/members`
- `POST /v1/saas/team/members/update`
- `POST /v1/saas/team/members/resend-invitation`
- `POST /v1/saas/team/members/remove`

L'essai gratuit dure 7 jours et autorise un seul routeur. Il ne peut être
activé qu'une fois par organisation. Un achat effectué pendant l'essai le
remplace immédiatement.

Chaque employé possède une identité unique, mais peut appartenir à plusieurs
organisations avec un rôle et des affectations de routeurs différents dans
chacune. Les rôles applicatifs sont `admin`, `operator`, `agent` et `guest`.
Les invitations utilisent un lien temporaire : une nouvelle identité y définit
son mot de passe, tandis qu'une identité existante conserve le sien.

`POST /v1/saas/migrate-license` exige la preuve cryptographique d'une ancienne
activation encore valide. La migration conserve le quota et la date
d'expiration de la licence.

## Réinitialisation des mots de passe

Les emails sont envoyés directement par Nodemailer depuis le VPS. Pour LWS,
utiliser de préférence le port `465` avec `SMTP_SECURE=true`. Le serveur exact
est celui affiché dans les paramètres de la boîte LWS (`mail.domaine.com` ou
`mailXX.lwspanel.com`). `SMTP_FROM_EMAIL` doit correspondre à la boîte
authentifiée.

Les variables SMTP sont `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM_EMAIL` et `SMTP_FROM_NAME`. Aucun de ces secrets ne
doit être placé dans l'application Windows ou la landing page.

`SAAS_INVITATION_URL` doit pointer vers
`https://ticketpro.autoticket-ne.com/accept-invitation`. Une identité existante
accepte l'invitation sans changer son mot de passe. Une nouvelle identité crée
son mot de passe pendant l'acceptation.

Le lien d'invitation expire après 24 heures par défaut (durée configurable avec
`SAAS_INVITATION_TTL_HOURS`). Un renvoi invalide immédiatement tous les anciens
liens du membre. Une modification de rôle, de périmètre ou de statut révoque ses
sessions actives afin que les nouveaux droits s'appliquent sans délai. Un
propriétaire peut vérifier la configuration avec
`POST /v1/admin/email/test`.

## Démarrage VPS

```bash
cp .env.example .env
# Définir deux secrets longs et différents :
# LICENSE_MASTER_TOKEN et LICENSE_HASH_SECRET
docker compose up -d --build
```

Le service doit rester derrière un reverse-proxy HTTPS. Son port Docker ne doit pas être publié directement sur Internet.

## Relais VPN sécurisé

L'API de licences est l'unique intermédiaire entre l'application et le hub
WireGuard. Dans `.env`, `VPN_HUB_MASTER_TOKEN` doit être strictement identique à
`HUB_MASTER_TOKEN` du hub. Les deux services écoutent uniquement sur la boucle
locale du VPS, respectivement sur les ports `8787` et `8788`.

Les routes `POST /v1/vpn/bootstrap` et `POST /v1/vpn/peers` exigent la licence,
le jeton d'activation et la preuve cryptographique de l'appareil. L'identifiant
interne du tenant est l'identifiant de licence, ce qui permet aux PC autorisés
d'une même organisation de rejoindre le même réseau isolé. Aucun jeton WireGuard
administrateur ou tenant n'est renvoyé à l'application.

Les installations desktop SaaS sont persistées dans SQLite avec un
`installation_id` idempotent. La table `organization_vpn_peers` conserve la
clé publique, l'IP allouée, la version de clé et les états `desired/applied` ;
elle ne contient jamais la clé privée. Une boucle de réconciliation applique
ces états au hub chaque minute et peut être déclenchée manuellement par
`POST /v1/admin/vpn/reconcile` avec le jeton maître.

Un abonnement payé reste actif pendant sa grâce de sept jours. Après cette
grâce, les peers desktop sont `disabled` sans révoquer leur identité. Un
renouvellement réactive donc la même clé et la même IP. La route de révocation
d'un appareil utilise au contraire l'état définitif `revoked`.

## Comptes propriétaires initiaux

Au premier démarrage, deux comptes `owner` sont créés s’ils n’existent pas :

- `alitimbo.pro11@gmail.com`
- `maitredoudos54@gmail.com`

Le mot de passe initial demandé est `admin123`. Il est immédiatement haché avec `scrypt` et le serveur impose son remplacement avant toute opération administrative.

Connexion :

```bash
curl -X POST https://license.ticketpro.example/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alitimbo.pro11@gmail.com","password":"admin123"}'
```

La réponse retourne une session temporaire. Le premier changement exige un mot de passe d’au moins 12 caractères avec majuscule, minuscule, chiffre et symbole :

```bash
curl -X POST https://license.ticketpro.example/v1/admin/auth/change-password \
  -H 'Authorization: Bearer SESSION_ADMIN' \
  -H 'Content-Type: application/json' \
  -d '{"current_password":"admin123","new_password":"NouveauMotDePasseFort1!"}'
```

Le `LICENSE_MASTER_TOKEN` reste un accès de secours réservé à l’exploitation du VPS. L’interface d’administration doit utiliser les sessions email/mot de passe.

## Paiement iPay Niger

Les organisations et revendeurs paient avec la même intégration iPay. Les clés `IPAY_PUBLIC_KEY`, `IPAY_PRIVATE_KEY` et `IPAY_SECRET_HASH` restent exclusivement sur le VPS.

Règles appliquées :

- pays `NE` et devise `XOF` imposés par le serveur ;
- MSISDN normalisé au format `227XXXXXXXX` ;
- `mobile` pour Orange, Moov et Zamani ;
- `nita_online` pour Nita ;
- `amanata` pour Amana, conformément à la valeur attendue par l’API fournie ;
- prix et droits du forfait figés dans la commande ;
- webhook authentifié par `Secret-Hash` ou `x-iPayMoney-secret` ;
- nouvelle vérification serveur via `GET /api/v1/payments/{reference}` ;
- montant, MSISDN, référence et transaction contrôlés avant livraison ;
- livraison idempotente même si le webhook est reçu plusieurs fois.

Parcours organisation :

```text
POST /v1/payments/orders/organization
→ iPay
→ webhook ou consultation du statut
→ vérification iPay
→ création d’une licence
→ clé retournée à l’application via le jeton privé de commande
```

Parcours revendeur :

```text
Nouveau compte : POST /v1/reseller/register-and-pay
Compte existant : POST /v1/reseller/payments/orders
→ iPay
→ webhook ou consultation du statut
→ vérification iPay
→ création du compte ou ajout définitif des crédits du pack
```

Une inscription revendeur reste `pending` tant que le premier paiement n’est pas confirmé. Le compte et ses crédits sont créés ensemble dans la même transaction après vérification iPay.

URL webhook à déclarer chez iPay :

```text
https://license.ticketpro.example/v1/payments/ipay/webhook
```

Le contenu brut du webhook et les secrets ne doivent pas être écrits dans les journaux de production.

## Modèles de licence

- Une licence standard appartient à une même organisation. Ses PC partagent le quota de routeurs et la même expiration.
- Un pack revendeur donne une capacité de distribution. Il ne doit jamais être activé comme une licence standard.
- Le revendeur transforme sa capacité en sous-clés indépendantes.
- Chaque sous-clé possède son propre identifiant, ses appareils, ses routeurs et son expiration.
- La durée d’une sous-clé commence lors de sa première activation, et non lors de sa création.
- La création d’une sous-clé consomme définitivement ses crédits routeurs.
- L’expiration, la date limite d’activation ou la révocation d’une sous-clé ne rembourse aucun crédit.
- Lorsque le solde atteint zéro, le revendeur doit acheter un nouveau pack.
- L’expiration ou la révocation d’un revendeur bloque de nouvelles ventes, sans couper les sous-clés déjà vendues.

Le revendeur ne reçoit jamais les comptes, jetons d’appareil, identifiants de routeur ou statistiques opérationnelles de ses clients.

## Créer une offre

`POST /v1/admin/plans` utilise une session `owner` ou `admin`. Pour une offre revendeur, ajouter `"is_reseller": true`.

Pour un forfait SaaS, `device_limit_mode` vaut `limited` ou `unlimited`. En mode
`limited`, `max_devices` est obligatoire. En mode `unlimited`, l'API renvoie
`max_devices: null`; chaque PC garde malgré tout sa propre identité et sa propre
adresse WireGuard.

Le catalogue commercial accepte aussi `offer_code` pour regrouper les variantes
mensuelle et annuelle d'une même gamme, ainsi que `purchase_mode` (`online` ou
`contact`). Une offre `contact` apparaît dans `GET /v1/plans/catalog`, mais jamais
dans `GET /v1/plans` ni dans le parcours de paiement iPay.

Chaque paiement et abonnement conserve un instantané du prix, de la durée et des
limites au moment de l'achat. Modifier le catalogue ne change donc pas les droits
des abonnements déjà vendus ; désactivez une ancienne offre au lieu de la supprimer.

```json
{
  "id": "business-unlimited",
  "code": "BUSINESS-UNLIMITED",
  "name": "Business Illimité",
  "router_limit": 50,
  "device_limit_mode": "unlimited",
  "duration_days": 30,
  "price_cfa": 50000,
  "billing_period": "monthly",
  "is_reseller": false,
  "is_active": true
}
```

```bash
curl -X POST https://license.ticketpro.example/v1/admin/plans \
  -H 'Authorization: Bearer SESSION_ADMIN' \
  -H 'Content-Type: application/json' \
  -d '{
    "id":"reseller-10",
    "code":"RESELLER-10",
    "name":"Pack Revendeur 10",
    "router_limit":10,
    "max_devices":5,
    "duration_days":30,
    "price_cfa":10000,
    "billing_period":"monthly",
    "is_reseller":true,
    "is_active":true
  }'
```

## Ouvrir un compte revendeur

```bash
curl -X POST https://license.ticketpro.example/v1/admin/resellers \
  -H 'Authorization: Bearer SESSION_ADMIN' \
  -H 'Content-Type: application/json' \
  -d '{
    "plan_id":"reseller-10",
    "name":"Revendeur Bamako",
    "email":"revendeur@example.com",
    "max_child_devices":3,
    "max_child_duration_days":30
  }'
```

La réponse contient un `temporary_password` une seule fois. Le revendeur se connecte avec son email et ce mot de passe, puis doit immédiatement le remplacer. Sa session ne donne accès qu’à son compte et à ses sous-licences.

## Créer une sous-clé client

```bash
curl -X POST https://license.ticketpro.example/v1/reseller/licenses \
  -H 'Authorization: Bearer SESSION_REVENDEUR' \
  -H 'Content-Type: application/json' \
  -d '{
    "router_limit":3,
    "max_devices":1,
    "duration_days":30,
    "activation_window_days":90,
    "label":"Client A"
  }'
```

Si le revendeur achète 10 crédits routeurs, il peut par exemple créer des sous-clés de `3 + 2 + 5`. Son solde devient alors définitivement nul. L’expiration de ces clients ne recharge pas son compte. La vérification et la consommation sont effectuées dans une transaction SQLite.

Le client reçoit uniquement la `key` retournée. Lors de sa première activation, le serveur calcule :

```text
expires_at = date_de_première_activation + duration_days
```

Deux clients activant leurs clés à des dates différentes ont donc des échéances différentes.

## Acheter un nouveau pack

Après confirmation manuelle du paiement, l’administrateur recharge le revendeur :

```bash
curl -X POST https://license.ticketpro.example/v1/admin/resellers/top-up \
  -H 'Authorization: Bearer SESSION_ADMIN' \
  -H 'Content-Type: application/json' \
  -d '{
    "reseller_id":"IDENTIFIANT_REVENDEUR",
    "plan_id":"reseller-10"
  }'
```

Cette opération ajoute 10 nouveaux crédits au total acheté. Elle ne modifie pas les expirations des anciennes sous-clés.

## Routes

Administration propriétaire :

- `POST /v1/admin/auth/login`
- `GET /v1/admin/auth/me`
- `POST /v1/admin/auth/logout`
- `POST /v1/admin/auth/change-password`
- `POST /v1/admin/auth/reset-password`
- `POST /v1/admin/admins`
- `POST /v1/admin/admins/list`
- `POST /v1/admin/admins/password-reset`
- `POST /v1/admin/plans`
- `POST /v1/admin/licenses`
- `POST /v1/admin/licenses/list`
- `POST /v1/admin/licenses/detail`
- `POST /v1/admin/licenses/activations`
- `POST /v1/admin/licenses/revoke`
- `POST /v1/admin/licenses/reset-device`
- `POST /v1/admin/resellers`
- `POST /v1/admin/resellers/list`
- `POST /v1/admin/resellers/renew`
- `POST /v1/admin/resellers/top-up`
- `POST /v1/admin/resellers/revoke`
- `POST /v1/admin/resellers/password-reset`
- `POST /v1/admin/payments/list`
- `POST /v1/admin/payments/reconcile`

Revendeur :

- `POST /v1/reseller/auth/login`
- `GET /v1/reseller/auth/me`
- `POST /v1/reseller/auth/logout`
- `POST /v1/reseller/auth/change-password`
- `POST /v1/reseller/auth/reset-password`
- `POST /v1/reseller/register-and-pay`
- `GET /v1/reseller/overview`
- `POST /v1/reseller/licenses`
- `POST /v1/reseller/licenses/list`
- `POST /v1/reseller/licenses/revoke`
- `POST /v1/reseller/payments/orders`
- `POST /v1/reseller/payments/list`

Application TicketPro :

- `GET /v1/plans`
- `POST /v1/payments/orders/organization`
- `POST /v1/payments/orders/status`
- `POST /v1/payments/ipay/webhook` (iPay uniquement)
- `POST /v1/licenses/activate`
- `POST /v1/licenses/validate`
- `POST /v1/vpn/bootstrap`
- `POST /v1/vpn/peers`
- `GET /health`

## Sécurité de production

Les mots de passe utilisent `scrypt`, les sessions et jetons de réinitialisation ne sont conservés que sous forme de HMAC, les sessions expirent et cinq échecs verrouillent temporairement le compte pendant 15 minutes. Les jetons de réinitialisation expirent après 30 minutes et ne sont utilisables qu’une fois.

Utiliser HTTPS, des secrets aléatoires distincts, une sauvegarde chiffrée et testée de `/data`, une rotation contrôlée des jetons, un pare-feu et une supervision des événements. L’autorité de licence reste toujours sur le VPS ; les données locales ne sont qu’un cache protégé.
