## Cadre de travail

  - main reste toujours installable et stable.
  - Chaque sprint travaille sur une branche dédiée.
  - Toute migration VPS/SQLite commence par une sauvegarde vérifiée.
  - Aucun build « officiel » tant que le sprint n’a pas ses tests validés sur VM et routeur réel.
  - On gèle les nouvelles fonctionnalités pendant les sprints P0 : fiabilité avant design.

  ## Sprint 0 — Baseline laboratoire

  Objectif : savoir précisément d’où l’on part et pouvoir revenir en arrière.

  Livrables :

  - Inventaire des objets TicketPro sur les routeurs pilotes.
  - Sauvegarde VPS, bases SQLite, configuration WireGuard et exports RouterOS.
  - Matrice de tests RouterOS 7.
  - Jeu de données de test : plusieurs organisations, opérateurs, plans, vouchers.
  - Procédure de rollback documentée.

  Sortie : on peut casser un test et restaurer complètement l’environnement.

  ## Sprint 1 — VPN multi-organisation

  Objectif : un même PC invité dans plusieurs organisations doit accéder à tous ses routeurs autorisés sans recréer ou
  changer de tunnel.

  À faire :

  - Un appareil global par installation Windows.
  - Une seule paire WireGuard et une IP VPN par PC.
  - Accès accordé par organisation et par routeur.
  - Aucune consommation abusive de limite d’appareils pour un simple invité.
  - Pare-feu hub : appareil → routeur autorisé uniquement.
  - Tests révocation, changement d’organisation, PC admin + PC opérateur.

  Sortie : Ali peut gérer Belem et Akicorp depuis le même PC, sans coupure VPN ni conflit.

  ## Sprint 2 — Manifeste RouterOS et sécurité

  Objectif : TicketPro ne crée jamais de doublon et ne touche jamais aux objets externes.

  À faire :

  - Manifeste des ressources gérées par routeur.
  - Marqueurs TicketPro stricts et versionnés sur scripts, scheduler, règles, bypass et VPN.
  - Upsert/diff au lieu de add aveugle.
  - Compte RouterOS TicketPro dédié, restrictions API/VPN et permissions minimales.
  - Sauvegarde avant chaque modification structurante.

  Sortie : réenregistrer ou réparer un routeur produit exactement le même état, sans doublon.

  ## Sprint 3 — Vouchers inviolables

  Objectif : aucun ticket consommé ne peut redevenir utilisable.

  À faire :

  - Machine à états officielle : Disponible → Actif → Épuisé/Expiré → Supprimé RouterOS → Archivé.
  - limit-uptime et quota appliqués nativement par RouterOS.
  - À quota atteint : coupure réelle, ticket désactivé, cookies/sessions nettoyés, jamais recréé.
  - À fin de validité : suppression physique RouterOS seulement après nettoyage confirmé.
  - Nettoyage limité aux objets TicketPro appartenant au ticket.
  - Tests 1 h / valide 3 h, quota data, redémarrage routeur, coupure Internet.

  Sortie : aucun accès gratuit ni réinitialisation de compteur possible.

  ## Sprint 4 — Synchronisation et observabilité

  Objectif : les données restent cohérentes malgré les coupures.

  À faire :

  - Outbox SQLite durable pour créations, synchronisations et erreurs.
  - Idempotency key par lot et par ticket.
  - Reprise d’un lot partiellement créé sans doublons.
  - Réconciliation explicite : importer, ignorer, signaler ou réparer — jamais recréer silencieusement un ticket utilisé.
  - Rapport avec fraîcheur des données, dernière synchronisation et erreurs lisibles.
  À faire :

  - Tests 1 000, puis 5 000 tickets.
  - Tests de plusieurs opérateurs simultanés.
  - Tests de révocation appareil, expiration abonnement et restauration PC perdu.
  - Revue des logs : aucun mot de passe, token ou clé WireGuard.
  - Audit des rôles équipe.
  - Mise à jour et rollback du service VPN Windows.
  - Checklist de go/no-go pour bêta fermée.

  Sortie : seulement après réussite, nous ouvrons une bêta limitée à quelques WiFi Zones choisies.

  L’ordre est volontaire : Sprint 1 et Sprint 3 sont les plus critiques pour notre promesse — accès distant multi-

• Oui, le plan me convient. Il est cohérent avec notre phase laboratoire et traite les risques dans le bon ordre.

  2. Sécuriser et rendre idempotente la configuration RouterOS.
  3. Verrouiller définitivement le cycle de vie des vouchers.
  4. Fiabiliser la synchronisation et la reprise après incident.
  5. Tester la charge et la sécurité avant une bêta fermée.