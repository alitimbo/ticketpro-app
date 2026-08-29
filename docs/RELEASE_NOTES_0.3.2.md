# TicketPro 0.3.2

Date de préparation : 29 août 2026

## Notes publiques

Cette mise à jour fiabilise l'ajout et la modification des routeurs MikroTik.

- le formulaire d'ajout ou de modification reste ouvert pendant les
  rafraîchissements automatiques de l'état des routeurs ;
- TicketPro contrôle désormais RouterOS Device Mode avant de configurer le
  moteur d'expiration des vouchers ;
- lorsqu'un routeur interdit Scheduler ou Hotspot, TicketPro affiche la
  procédure de validation physique à suivre dans WinBox ;
- un routeur signalé `flagged` par RouterOS est identifié séparément afin
  d'éviter un provisionnement risqué ;
- aucune modification DNS, NTP ou script n'est engagée lorsque Device Mode
  bloque l'automatisation ;
- une nouvelle tentative après validation physique reprend sans créer de
  script ou de Scheduler en double.

## Texte court pour le manifeste Updater

Ajout de routeur fiabilisé : formulaire stable, contrôle RouterOS Device Mode
avant provisionnement et reprise sans doublon après validation physique.
