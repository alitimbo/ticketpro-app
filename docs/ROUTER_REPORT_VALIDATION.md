# Rapports des vouchers : validation

## Sources et droits

Le rapport fusionne SQLite, le catalogue de l'organisation et une observation RouterOS toutes les 15 secondes lorsque la page est visible. Les compteurs cumulés et les états terminaux ne régressent pas lorsque le cloud est plus ancien. Les identifiants locaux restent ceux de SQLite.

Les utilisateurs ayant `router.tickets.sync` conservent les observations de leurs tickets locaux, puis partagent les changements via l'outbox. Les observations de tickets présents seulement dans le catalogue cloud passent également par l'outbox, sans restaurer tout le parc. Un lecteur sans ce droit ne publie rien.

Une erreur cloud n'annule pas une lecture MikroTik réussie : le rapport indique que le partage ou la conservation est en attente. Quand aucune donnée n'est disponible pendant une erreur ou le chargement, les cartes principales affichent un tiret plutôt qu'un zéro confirmé.

## Mise à jour du backend

Le backend ajoute automatiquement `organization_tickets.printed_at_json` avec une valeur vide par défaut. Le champ optionnel `printed_at` transporte les dates connues des impressions, sans secrets. Les anciennes requêtes restent acceptées ; les dates déjà connues ne sont pas effacées par un poste qui n'a aucun historique d'impression local.

Déployer le backend corrigé avant de publier le desktop pour activer le partage des dates. Aucun déploiement n'est effectué par cette correction.

## Limites historiques

- La suppression manuelle et le nettoyage RouterOS confirmé sont inclus dans « Supprimés », une seule fois par ticket.
- `router_deleted_at` est la date de confirmation par TicketPro, pas nécessairement la seconde réelle du nettoyage.
- Les impressions anciennes sans date connue restent dans le total sans période. Leur date n'est jamais déduite de la création du lot.
- Les utilisateurs présents seulement dans RouterOS ne fournissent pas un historique commercial complet : le rapport les signale séparément, sans inventer de prix ou de dates de création.
- Si le scheduler supprime un utilisateur avant toute observation de son activation, ses derniers compteurs ne sont plus récupérables sur RouterOS. Cette correction ne prétend pas recréer des données perdues.

## Tests manuels

1. Générer un petit lot sur PC A, puis consulter le rapport sans ouvrir la page Tickets. Vérifier « Créés » et la transmission des observations avec un compte autorisé à synchroniser.
2. Imprimer le lot et synchroniser. Sur PC B, vérifier les impressions en sélectionnant le jour réel d'impression.
3. Consommer un ticket jusqu'à épuisement : les compteurs doivent progresser, le ticket rester épuisé après refresh, et la suppression ne doit être comptée qu'après suppression physique confirmée.
4. Laisser expirer la validité ; vérifier expiration et suppression après passage du scheduler. L'historique de création doit rester présent.
5. Couper le VPS : le rapport doit garder les dernières données, signaler le partage en attente et le reprendre après rétablissement.
6. Avec un invité lecteur, vérifier l'affichage et l'absence de publication. Changer de routeur et d'organisation : aucune réponse tardive ne doit remplacer les données de la nouvelle sélection.
