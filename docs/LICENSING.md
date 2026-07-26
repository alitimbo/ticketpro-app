# Déploiement des licences TicketPro

## Serveur VPS

Le service est dans `infra/license-api`. Il doit être déployé derrière HTTPS et SQLite ne doit jamais être exposé.

```bash
cd infra/license-api
cp .env.example .env
# Définir LICENSE_MASTER_TOKEN et LICENSE_HASH_SECRET.
docker compose up -d --build
```

Les offres sont publiées par `GET /v1/plans`. Le setup peut ainsi afficher les prix et quotas actuels sans nouvelle build.

## Paiements intégrés

Le serveur initie les paiements iPay pour les organisations et les revendeurs. L’application ne reçoit aucune clé iPay. Elle reçoit uniquement un identifiant et un jeton de commande.

Le serveur accepte les MSISDN Niger au format national ou international, puis les normalise en `227XXXXXXXX`. Les moyens supportés sont `mobile`, `nita_online` et `amanata`.

Un paiement n’est jamais livré sur la seule déclaration de l’application ou du webhook. Le VPS relit son statut auprès d’iPay et compare la transaction, la référence, le montant et le MSISDN. Une contrainte transactionnelle garantit qu’un paiement confirmé plusieurs fois ne produit qu’une seule licence ou recharge.

Une organisation reçoit une licence standard. Un revendeur reçoit les crédits du pack acheté sur son compte existant. Toutes les commandes restent consultables depuis l’administration.

## VPN WireGuard lié à la licence

Une licence active donne accès à un tenant WireGuard isolé. L'application
s'authentifie auprès de l'API de licences avec son jeton d'activation et sa preuve
d'appareil. L'API contacte ensuite le hub sur la boucle locale du VPS avec le
secret maître. Ce secret n'est jamais présent dans le setup ou dans la base
locale du client.

Le hub attribue un sous-réseau distinct à chaque licence, puis une adresse `/32`
à chaque routeur ou poste opérateur. Les règles `iptables` autorisent les échanges
uniquement au sein de ce sous-réseau. Deux organisations ne peuvent donc pas
atteindre leurs MikroTik respectifs.

Un nouveau revendeur peut s’inscrire directement dans l’application avec `POST /v1/reseller/register-and-pay`. Son compte n’existe pas encore dans les comptes actifs pendant le paiement. Après confirmation, le serveur crée atomiquement le compte, les droits du pack et son solde initial.

## Premier lancement de l’application

L’écran initial propose trois parcours :

- acheter un pack organisation avec activation automatique ;
- activer une clé déjà reçue ;
- se connecter ou s’inscrire comme revendeur.

Les commandes organisation et inscriptions revendeur en attente sont conservées localement avec leur jeton protégé afin de reprendre la vérification après un redémarrage. Le mode revendeur charge une interface commerciale dédiée et n’initialise pas les fonctionnalités MikroTik.

## Administration propriétaire

Les deux comptes propriétaires initiaux sont `alitimbo.pro11@gmail.com` et `maitredoudos54@gmail.com`, avec le mot de passe temporaire `admin123`. Le serveur stocke uniquement son hachage et exige un changement avant de permettre la création d’une offre, d’une licence ou d’un revendeur.

Les sessions administrateur durent 12 heures. Les rôles disponibles sont `owner`, `admin` et `support`. Seuls `owner` et `admin` peuvent modifier les données commerciales ; `support` peut consulter les licences.

Le master token est réservé au bootstrap et aux opérations d’urgence sur le VPS.

## Licences standard

Une licence standard peut autoriser plusieurs PC d’une même organisation. Tous ces PC partagent la même échéance et le même quota global de routeurs. La première activation démarre la durée de la licence.

## Packs revendeur

Une offre marquée `is_reseller` crée un compte de distribution avec :

- une capacité globale de routeurs ;
- une échéance de droit à créer de nouvelles sous-clés ;
- une durée maximale et un nombre maximal de PC par sous-clé ;
- un compte email/mot de passe avec sessions séparées du master token.

Chaque sous-clé client est une licence autonome. Sa durée commence à sa propre première activation. Elle ne donne accès à aucune autre licence et le revendeur ne voit que les informations commerciales suivantes : libellé, quota, état, date d’émission, date limite d’activation et expiration.

La création d’une sous-clé consomme définitivement le nombre de crédits routeurs attribué. L’expiration, l’absence d’activation ou la révocation ne restitue aucun crédit. Le revendeur doit payer un nouveau pack, puis l’administrateur appelle `POST /v1/admin/resellers/top-up`. La consommation est transactionnelle afin d’empêcher deux ventes simultanées de dépasser le solde.

La révocation ou l’expiration du compte revendeur ne révoque pas les clients déjà actifs. Elle bloque uniquement la création de nouvelles sous-clés. Un renouvellement revendeur prolonge son droit de distribution.

En cas d’oubli, un administrateur émet un jeton à usage unique avec `POST /v1/admin/resellers/password-reset` et l’envoie manuellement au revendeur. Celui-ci choisit son nouveau mot de passe avec `POST /v1/reseller/auth/reset-password`. Le jeton expire après 30 minutes et toutes les anciennes sessions sont révoquées.

## Build de l’application

```powershell
$env:VITE_LICENSE_API_URL = "https://license.ticketpro.example"
npm.cmd run tauri:build:windows
```

En production, le premier lancement bloque la création du compte jusqu’à l’activation distante d’une clé valide. L’autorité réelle reste l’API VPS.

## Vérifications

```bash
npm run test:license-api
```

Le test couvre la première connexion des cofondateurs, le changement obligatoire du mot de passe, l’authentification revendeur, la réinitialisation après oubli, la révocation des anciennes sessions, la consommation définitive des crédits, le paiement d’un nouveau pack, les expirations distinctes et l’isolation des clients.
