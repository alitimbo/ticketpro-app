# TicketPro 0.3.0

Date de préparation : 28 août 2026

## Notes publiques

Cette version prépare TicketPro pour son pilote de production avec une gestion
RouterOS, VPN et multi-organisation plus fiable.

- synchronisation en direct des plans, vouchers, clients connectés, rapports et
  états RouterOS ;
- cycle de vie des vouchers renforcé : durée consommée distincte de la validité,
  coupure et nettoyage contrôlés, puis suppression seulement à l'expiration ;
- diagnostic de synchronisation et réparation explicite des ressources gérées
  sans doublons ;
- compte RouterOS dédié à permissions limitées et restriction des services
  d'administration aux réseaux LAN et VPN autorisés ;
- connexion distante multi-organisation fiabilisée pour les propriétaires et
  collaborateurs invités ;
- identité VPN stable par installation, révocation indépendante et meilleure
  gestion des postes partagés ou personnels ;
- création de vouchers avec aperçu obligatoire, préférences par WiFi Zone,
  devise persistante et PDF A4 à 40 tickets ;
- observabilité, file durable, loaders et messages d'erreur renforcés ;
- tests de charge validés jusqu'à 5 000 vouchers sans doublon.

## Texte court pour le manifeste Updater

Synchronisation RouterOS renforcée, cycle des vouchers sécurisé, connexion VPN
multi-organisation fiabilisée et diagnostic de production amélioré.

## Validation avant publication stable

- installer la version candidate sur le poste laboratoire ;
- confirmer le cycle RouterOS v6 avec exactement un script et un scheduler ;
- tester un routeur local et un routeur distant ;
- créer un petit lot de vouchers, vérifier le PDF puis la synchronisation ;
- vérifier le changement d'organisation et un compte collaborateur invité ;
- publier le manifeste stable seulement après ces contrôles.
