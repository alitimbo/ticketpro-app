# Organisations, invitations, abonnements et postes TicketPro

Référence fonctionnelle et technique — 1er octobre 2026.

## 1. Principe fondamental

L’abonnement appartient à une **organisation**, pas à chacun de ses membres.
L’invitation crée une appartenance avec un rôle et un périmètre de routeurs.
Elle ne transfère ni la propriété de l’organisation ni un abonnement personnel.

Exemple : une organisation Pro autorise 20 routeurs, dont 12 enregistrés. Un
opérateur invité sur Nova peut travailler sur Nova sans payer un second forfait.
Il ne reçoit pas 20 places supplémentaires et ne voit pas automatiquement les
11 autres routeurs. Sa propre organisation éventuelle doit disposer de ses propres droits.

## 2. Parcours d’invitation

1. Le propriétaire, ou un administrateur autorisé, crée l’invitation.
2. Le rôle applicatif et l’accès à tous les routeurs ou à une sélection sont enregistrés.
3. Le destinataire accepte un lien valide ; un compte existant peut être réutilisé.
4. L’appartenance doit être active et l’invitation acceptée pour ouvrir une session dans cette organisation.
5. Après connexion, le backend utilise l’abonnement de l’organisation active.

Le délai d’acceptation dépend de `SAAS_INVITATION_TTL_HOURS`. Une invitation en
attente n’équivaut pas à un accès opérationnel. Seul le propriétaire peut accorder
le rôle administrateur via la gestion de l’équipe.

## 3. Propriété, rôle et périmètre

| Profil | Actions principales dans l’organisation |
| --- | --- |
| Propriétaire | Administration, équipe, facturation et abonnement |
| Administrateur invité | Administration des routeurs/plans/tickets et gestion de l’équipe selon les permissions ; pas la facturation du propriétaire |
| Opérateur invité | Lecture des plans, génération et réimpression de tickets, consultation des fichiers/rapports autorisés ; pas création de plans ni administration des routeurs |
| Agent invité | Génération et consultation/réimpression de ses propres lots et rapports autorisés |
| Invité en lecture seule | Consultation des écrans autorisés ; pas génération ni administration |

Le rôle ne suffit pas : les permissions d’action ET le périmètre des routeurs sont
contrôlés côté backend. Un utilisateur peut avoir des rôles différents dans plusieurs
organisations. Les permissions détaillées restent définies par
`ORGANIZATION_ROLE_PERMISSIONS` dans `infra/license-api/server.mjs`.

## 4. Quotas : routeurs et postes sont différents

- `router_limit` est une capacité commune à l’organisation. Ajouter un routeur
  consomme une place du même forfait, quel que soit le membre autorisé à l’ajouter.
- `max_devices` / `device_limit_mode` s’appliquent aux postes du propriétaire.
- Les postes collaborateurs sont hors quota commercial du propriétaire et ne
  nécessitent pas un deuxième abonnement. Leur accès reste identifié et révocable.
- Une formule illimitée retourne `max_devices = null`, avec `device_limit_mode = unlimited`.
- Aucun plafond commercial de membres n’est appliqué par le parcours d’invitation actuel.

Un poste n’est pas un routeur. Inviter un opérateur ne lui accorde pas de nouvelles
places de routeurs. Les compteurs propriétaire/collaborateurs utilisent les mêmes
requêtes que les quotas SaaS : appareils non révoqués, classés selon l’appartenance
du membre qui les a enregistrés. Ils ne sont pas des indicateurs de présence en ligne.
Un PC partagé ne doit pas être compté arbitrairement comme deux machines physiques.

## 5. Plusieurs organisations et réseau

Le changement d’organisation sélectionne une appartenance acceptée et active,
remplace la session précédente et recharge abonnement, rôle et droits de routeurs.
La capacité n’est pas fusionnée entre organisations.

L’identité VPN d’une installation est distincte des autorisations d’organisation.
La politique du hub autorise uniquement les chemins vers les routeurs permis.
Une plage routée large (par exemple `10.250.0.0/16`) n’est **pas** une autorisation
d’accéder à tous les tenants. Ne pas assouplir le firewall pour corriger un quota.

En mode local, les pages utilisent également le contexte d’organisation et les
permissions TicketPro. Cela ne protège pas contre quelqu’un disposant d’un accès
administrateur indépendant au MikroTik : les comptes RouterOS et le réseau restent
des barrières de sécurité séparées.

## 6. Expiration, suspension et révocation

Le statut effectif d’un abonnement peut être : actif, essai, délai de grâce,
suspendu, expiré ou résilié. Le statut stocké `active` ne garantit pas à lui seul
que l’abonnement reste utilisable.

Le délai de grâce d’un forfait payé dépend de `SAAS_PAID_GRACE_DAYS` ; l’essai ne
bénéficie pas de ce délai. L’autorisation effective est calculée par
`organizationSubscriptionLifecycle` / `organizationSubscriptionResponse`.

| Action | Portée |
| --- | --- |
| Suspendre/retirer une appartenance dans l’équipe | Ce membre dans cette organisation ; pas ses autres organisations |
| Révoquer un appareil | L’accès de l’appareil concerné selon le périmètre de révocation |
| Suspendre/résilier l’abonnement | L’organisation et tous ses membres |
| Désactiver globalement un compte depuis le dashboard | Le compte, pas seulement une de ses appartenances |
| Déconnexion/fermeture de l’application | Ne supprime pas automatiquement l’identité de l’appareil |

Le contrôleur réconcilie les accès VPN avec l’abonnement, l’appartenance et
l’appareil. Ne pas promettre une révocation réseau instantanée sans mesure du
délai effectif de réconciliation. En offline, ne pas présenter une observation
locale comme une nouvelle validation serveur.

## 7. Lecture du dashboard admin

### Liste utilisateurs

La ligne résume l’organisation de rattachement (`organization_users.organization_id`),
pas nécessairement la dernière organisation active dans l’application desktop.
Pour un utilisateur multi-organisation, ouvrir sa fiche pour voir toutes les appartenances.

- **Rôle dans l’organisation** : propriétaire ou rôle invité, jamais un rôle global fictif.
- **Forfait de l’organisation** : partagé ; l’invité ne l’a pas acheté personnellement.
- **Postes du compte** : appareils non révoqués enregistrés par ce compte dans
  toutes ses organisations ; ce n’est pas le quota du forfait affiché sur la ligne.
- `effective_subscription_status` fournit le statut calculé. Le champ historique
  `subscription_status` reste inchangé pour les anciens consommateurs.

### Fiche et abonnements

Les appartenances affichent rôle, statut d’invitation et périmètre attribué.
Les noms des routeurs sélectionnés proviennent des identifiants ACL, pas du parc
entier visible au support. Une attribution vers un routeur absent est signalée.

Chaque carte abonnement précise la capacité commune de routeurs, le quota de postes
du propriétaire et le nombre de postes collaborateurs hors quota. Les interventions
sur ce forfait concernent **tous les membres de l’organisation nommée**, même si
on a ouvert la fiche d’un invité. Pour retirer une seule personne, utiliser l’équipe.

Compatibilité avec une ancienne API : les nouveaux champs `router_ids`,
`device_usage` et `effective_subscription_status` sont optionnels côté dashboard.
L’interface signale un détail indisponible au lieu d’inventer des quotas ou des noms.
Sans le backend mis à jour, le statut historique reste le repli de compatibilité.

## 8. Implémentation et non-régression

Backend : `infra/license-api/server.mjs`, endpoints `/v1/admin/users/list`,
`/v1/admin/users/detail` et `/v1/admin/organizations/device-limit`.
La gestion indépendante des PC ajoute la table SQLite
`organization_device_limit_policies` au démarrage (`CREATE TABLE IF NOT EXISTS`).
Les organisations existantes restent en héritage du forfait, sans modification
de leurs droits. Prix, échéance et capacité de routeurs restent inchangés.

Dashboard : `features/users/model/organization-access.ts`, liste utilisateurs,
informations utilisateur, cycle d’abonnement et libellés du catalogue de forfaits.

Tests :

```powershell
# Dans C:\Ticketpro
npm.cmd run test:license-api

# Dans C:\ticketprodashboard, Node 24 avec prise en charge TypeScript
node --test features/users/model/organization-access.node-test.mjs features/users/model/device-limit-policy.node-test.mjs
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Les tests Node du dashboard vérifient les règles de présentation et certains textes
de sécurité ; ils ne remplacent pas une validation visuelle dans le navigateur.

Validation manuelle avant publication : propriétaire + opérateur sur un seul routeur,
administrateur invité, deux organisations avec rôles différents, forfait limité et
illimité, abonnement suspendu/expiré/en grâce, API ancienne, membre sans routeur,
révocation limitée à une organisation et intervention globale explicite.

## 9. Déploiement

Publier le backend avec `organization-device-limit.mjs` (inclus dans le Dockerfile),
puis le dashboard. La nouvelle version desktop est nécessaire pour l'actualisation
silencieuse périodique ; les anciens clients reçoivent déjà le quota lors d'une
nouvelle lecture serveur/connexion. Vérifier sur un invité et un compte
multi-organisation. La préparation de ces fichiers ne constitue pas un déploiement.

## 10. Limite de PC indépendante par organisation

Dans le dashboard : **Utilisateurs → fiche → Abonnements → carte de l'organisation
→ Modifier la limite de PC**. Seuls les administrateurs plateforme `owner` et
`admin` peuvent intervenir ; le support en lecture et les membres SaaS ne peuvent pas.

Trois modes sont disponibles :

| Mode | Effet |
| --- | --- |
| Hériter du forfait (`inherit`) | Le quota suit le forfait actuel et ses changements futurs |
| Limite personnalisée (`limited`) | Entier de 1 à 100 000, indépendant du forfait |
| Illimité (`unlimited`) | Aucun plafond commercial de PC propriétaire ; valeur `null`, pas zéro |

La dérogation appartient à l'organisation et survit au renouvellement ou au
changement de forfait. Elle n'est pas personnelle au membre dont on consulte
la fiche. Les collaborateurs restent **hors quota propriétaire**, conformément
aux règles existantes : ce réglage n'introduit pas un plafond global des invités.

Une baisse ne révoque aucun poste existant. Exemple : 5 PC enregistrés, quota
abaissé à 2 → les 5 restent autorisés ; tout nouveau PC propriétaire est refusé.
Pour retirer réellement un accès, révoquer explicitement le poste concerné.
L'interface signale le dépassement. Le hub conserve une capacité technique
suffisante pour les postes existants et les collaborateurs ; le backend applique
le véritable quota commercial à chaque nouvel enregistrement.

### Propagation et concurrence

1. L'API admin enregistre la politique et son audit dans une transaction SQLite.
2. L'admission des nouveaux PC utilise immédiatement cette politique côté serveur.
3. Le backend transmet la capacité au hub. Si le hub échoue, la réponse indique
   `propagation.hub_status = pending`, sans perdre l'enregistrement. La
   réconciliation VPN réessaie pour les organisations disposant de peers, selon
   `VPN_RECONCILIATION_INTERVAL_MS` (60 secondes par défaut). Une organisation
   sans peer transmet sa capacité lors du prochain provisionnement.
4. Le nouveau desktop relit silencieusement l'abonnement toutes les 60 secondes,
   ainsi qu'au retour du réseau ou du focus. Aucun profil local ni formulaire
   n'est réinitialisé. Les lectures HTTP sont annulées après 15 secondes ou au
   changement de contexte ; une réponse d'une autre organisation est ignorée.
5. En offline, la dernière observation est conservée ; la valeur serveur revient
   après reconnexion. Ce délai n'est pas une garantie de propagation instantanée.

L'enregistrement exige `organization_id`, `mode`, `max_devices` (null hors mode
limité), `reason` (5–500 caractères) et `expected_revision`. Une modification
concurrente retourne 409 `DEVICE_LIMIT_POLICY_CONFLICT` dans `details.code` :
actualiser la fiche plutôt qu'écraser l'autre intervention. Un renvoi identique
avec la révision courante ne crée ni nouvel audit ni nouvelle révision.

La fiche expose le quota effectif et celui du forfait séparément. L'historique
des abonnements conserve ses valeurs commerciales d'origine. Le journal trace
`organization_device_limit_changed`, l'administrateur, le motif, la révision et
les anciennes/nouvelles valeurs, sans secrets VPN ni identifiants sensibles.

Validation : passer de l'héritage à 3 PC, à illimité puis à l'héritage ; vérifier
un nouvel enregistrement, un poste existant après baisse, le renouvellement,
l'isolation d'une autre organisation, un invité et une indisponibilité du hub.
