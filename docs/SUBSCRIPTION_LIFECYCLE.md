# Cycle de vie des abonnements SaaS TicketPro

## Essai gratuit

- Durée : 7 jours.
- Quota : celui du forfait d'essai, actuellement 1 routeur.
- Aucun délai de grâce après expiration.
- Relances de conversion envoyées au propriétaire de l'organisation :
  - 3 jours avant la fin ;
  - 1 jour avant la fin ;
  - 2 jours après la fin, uniquement si aucun abonnement payant n'a été acheté.
- Après expiration, la connexion et le paiement restent accessibles, mais les
  routeurs, le VPN et les services opérationnels sont suspendus.

## Abonnement payant

- Jusqu'à l'échéance : abonnement actif.
- Après l'échéance : délai de grâce automatique de 7 jours.
- Pendant la grâce :
  - tous les services restent actifs ;
  - l'application affiche la date de suspension définitive ;
  - un seul rappel est envoyé par période de 24 heures.
- À la fin du septième jour : les services sont suspendus et les relances
  automatiques s'arrêtent.
- La connexion et l'écran de renouvellement restent toujours accessibles.

## Sécurité et idempotence des emails

Chaque email est identifié par l'abonnement, le type d'événement et le
destinataire. Une contrainte unique en base empêche les doublons lors des
redémarrages du serveur. Une tentative interrompue avant confirmation est
libérée après une heure afin de pouvoir être retentée.

Le traitement démarre au lancement de l'API puis s'exécute toutes les six
heures. Il peut aussi être déclenché manuellement par un administrateur via :

```text
POST /v1/admin/subscription-notifications/run
```

Les emails sont envoyés uniquement aux propriétaires actifs de l'organisation
avec le SMTP configuré sur le VPS.
