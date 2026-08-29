# TicketPro 0.3.1

Date de préparation : 29 août 2026

## Notes publiques

Cette mise à jour améliore le démarrage de TicketPro et corrige le calcul de la
limite de routeurs pour les abonnements et les organisations.

- ajout d'un écran de démarrage TicketPro pendant l'initialisation réelle de la
  base locale et de la session ;
- affichage d'une erreur récupérable si l'initialisation ne peut pas aboutir ;
- priorité donnée au quota d'abonnement reçu en direct du SaaS ;
- actualisation du quota lors de la connexion, du rafraîchissement du compte et
  du changement d'organisation ;
- correction du faux message « limite de routeurs atteinte » lorsque le forfait
  autorise davantage de routeurs que l'ancien cache local.

## Texte court pour le manifeste Updater

Nouveau démarrage TicketPro et correction du quota de routeurs selon
l'abonnement actif de chaque organisation.
