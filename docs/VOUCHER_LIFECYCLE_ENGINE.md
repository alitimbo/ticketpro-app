# Moteur d'expiration autonome des vouchers

## Objectif

TicketPro applique deux limites indépendantes sur chaque voucher :

1. `limit-uptime` limite le temps de connexion cumulé réellement consommé.
2. La métadonnée TicketPro `validity` limite la période calendaire à partir de
   la première connexion réussie.

Exemple : un plan avec une durée de 3 heures et une validité de 5 heures permet
au client de consommer au maximum 3 heures de connexion pendant les 5 heures
qui suivent sa première connexion. La première limite atteinte désactive
l'accès.

Le calcul de validité est exécuté dans RouterOS. Il reste donc actif si
TicketPro, le PC ou le VPS est temporairement indisponible.

## Installation automatique

TicketPro installe ou répare le moteur :

- lors de l'ajout ou de la modification d'un routeur ;
- avant chaque génération de vouchers ;
- lors d'une restauration ou d'une réconciliation après perte du PC.

L'installation est idempotente. Elle conserve les scripts `on-login` déjà
présents et remplace uniquement le bloc délimité par :

```text
# TICKETPRO-LIFECYCLE-BEGIN v1
# TICKETPRO-LIFECYCLE-END v1
```

Le moteur nécessite RouterOS 7 ou une version plus récente. TicketPro vérifie
également que la date du routeur est plausible, active le client NTP et ajoute
des serveurs NTP publics si aucun serveur n'est configuré.

## Objets créés dans RouterOS

TicketPro gère :

- le script `ticketpro-voucher-expiration-v1` ;
- le Scheduler `ticketpro-voucher-expiration-v1`, exécuté toutes les minutes ;
- un bloc `on-login` versionné dans chaque profil HotSpot.

Chaque nouveau voucher limité porte une métadonnée de cette forme :

```text
TicketPro:v1;validity=300;expires=0;state=new;
```

À la première connexion, `expires=0` est remplacé par une échéance absolue en
nanosecondes depuis l'époque Unix. Cette valeur n'est plus repoussée lors des
connexions suivantes.

À l'expiration, RouterOS :

1. déconnecte toutes les sessions actives du voucher ;
2. supprime ses cookies HotSpot ;
3. désactive le compte HotSpot ;
4. conserve le compte et marque `state=expired` pour l'audit et la
   restauration.

Le voucher n'est volontairement pas supprimé.

## Vérification dans WinBox ou le terminal

Vérifier le script :

```routeros
/system script print detail where name="ticketpro-voucher-expiration-v1"
```

Vérifier le Scheduler :

```routeros
/system scheduler print detail where name="ticketpro-voucher-expiration-v1"
```

Résultat attendu :

- `disabled=no`
- `interval=1m`
- `on-event=ticketpro-voucher-expiration-v1`

Vérifier le bloc de première connexion d'un plan :

```routeros
/ip hotspot user profile print detail where name="NOM-DU-PLAN"
```

Vérifier l'état d'un voucher :

```routeros
/ip hotspot user print detail where name="CODE-DU-VOUCHER"
```

Avant la première connexion :

```text
expires=0;state=new;
```

Après la première connexion :

```text
expires=...;state=active;
```

Après expiration :

```text
disabled=yes
state=expired;
```

Vérifier l'horloge et NTP :

```routeros
/system clock print
/system ntp client print
/system ntp client servers print
```

## Test fonctionnel court

1. Créer dans TicketPro un plan de test avec une durée de 10 minutes et une
   validité de 2 minutes.
2. Générer un voucher.
3. Confirmer que son commentaire contient `validity=2;expires=0;state=new;`.
4. Se connecter au portail captif avec ce voucher.
5. Confirmer que le commentaire passe à `state=active` avec une échéance non
   nulle.
6. Attendre au maximum 3 minutes.
7. Confirmer que la session disparaît et que le voucher est désactivé avec
   `state=expired`.

Commandes de contrôle :

```routeros
/ip hotspot active print detail where user="CODE-DU-VOUCHER"
/ip hotspot cookie print detail where user="CODE-DU-VOUCHER"
/ip hotspot user print detail where name="CODE-DU-VOUCHER"
/log print where message~"TicketPro voucher expired"
```

Le script d'expiration peut aussi être déclenché manuellement pour vérifier
son exécution :

```routeros
/system script run ticketpro-voucher-expiration-v1
```

## Sécurité

- Aucun jeton SaaS, secret API ou mot de passe TicketPro n'est stocké dans le
  script.
- Le routeur ne dépend pas d'un appel HTTP externe pour couper un voucher.
- Les scripts concurrents ne sont pas copiés ni réutilisés.
- La source de vérité locale RouterOS reste récupérable par TicketPro après
  perte ou réinstallation du PC.

La clé ou le jeton tiers partagé pendant l'analyse doit être révoqué par son
propriétaire. Il ne doit jamais être utilisé dans TicketPro.
