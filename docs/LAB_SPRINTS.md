# Programme laboratoire TicketPro

## Règles de fonctionnement

- `main` doit rester installable et réversible.
- Chaque sprint possède une branche, une sauvegarde de départ et des critères de sortie.
- Une migration locale ou VPS doit être idempotente et accompagnée d'un rollback.
- Les tests automatisés précèdent toujours les tests Hyper-V puis les tests sur MikroTik réel.
- Aucun build n'est déclaré public avant la validation du Sprint 5.
- Une donnée ancienne doit être présentée comme telle ; elle ne doit jamais être affichée comme « live ».

## Sprint 0 — Baseline et reprise

Objectif : figer un point de référence reproductible avant les changements d'architecture.

Livrables :

- état Git, versions et composants déployés ;
- sauvegarde chiffrée VPS copiée hors du serveur avec checksum ;
- commande unique `npm run lab:baseline` ;
- inventaire RouterOS en lecture seule ;
- matrice de tests automatisés et manuels ;
- procédure de rollback connue.

Critère de sortie : tous les contrôles automatisés passent et les deux routeurs pilotes ont un inventaire daté.

## Sprint 1 — VPN multi-organisation

Objectif : une installation Windows conserve une identité VPN stable et accède à tous les routeurs autorisés par ses appartenances.

Livrables :

- identité globale de l'installation, indépendante de l'organisation active ;
- autorisations appareil-vers-routeur dérivées des appartenances ;
- aucune nouvelle clé lors d'un changement d'organisation ;
- révocation d'une appartenance sans couper les autres ;
- réconciliation du hub et tests d'isolation inter-organisations.

Critère de sortie : un même PC gère au moins deux organisations et deux sous-réseaux sans recréer son pair ni perdre son tunnel.

## Sprint 2 — Manifeste RouterOS et sécurité

Objectif : connaître et réconcilier uniquement les ressources appartenant à TicketPro.

Livrables :

- manifeste versionné par routeur ;
- identifiants et commentaires TicketPro stables ;
- opérations `ensure_present`, `ensure_updated` et `ensure_absent` ;
- suppression des doublons détenus par TicketPro ;
- compte RouterOS dédié et matrice de permissions minimales ;
- restriction des services d'administration au LAN autorisé et au VPN.

Critère de sortie : deux installations successives produisent exactement le même état RouterOS.

## Sprint 3 — Cycle de vie des vouchers

Objectif : rendre impossible la réutilisation d'un ticket épuisé ou expiré.

Livrables :

- états explicites et transitions auditées ;
- séparation temps consommé, validité calendaire et suppression physique ;
- nettoyage limité aux sessions, cookies et bindings détenus par le voucher ;
- interdiction de recréer automatiquement un ticket déjà activé ;
- conservation du dernier snapshot avant suppression RouterOS.

Critère de sortie : le scénario 1 h d'utilisation / 3 h de validité coupe à 1 h, interdit toute reconnexion et supprime à 3 h sans perdre l'historique.

## Sprint 4 — Synchronisation et observabilité

Objectif : reprendre correctement les opérations après une coupure ou un redémarrage.

Livrables :

- outbox SQLite durable ;
- clés d'idempotence par lot, ticket et commande ;
- reprise d'un lot partiel ;
- réconciliation explicitant les conflits ;
- fraîcheur des données, corrélation et diagnostics ;
- alertes sur dérive d'horloge, doublons, erreurs RouterOS et échecs VPN.

Critère de sortie : les tests d'injection réseau ne perdent et ne dupliquent aucune opération.

## Sprint 5 — Charge et bêta fermée

Objectif : décider objectivement si TicketPro peut entrer en bêta contrôlée.

Livrables :

- tests de 1 000 puis 5 000 vouchers ;
- concurrence de plusieurs opérateurs ;
- restauration PC/VPS/routeur ;
- revue de sécurité des secrets et permissions ;
- mise à jour et rollback Windows ;
- rapport de go/no-go.

Critère de sortie : tous les scénarios P0 sont validés sur Hyper-V et sur les deux MikroTik pilotes.

## Versions de laboratoire

Les versions `0.3.x-lab` sont réservées aux tests internes. La numérotation publique ne reprend qu'après le go/no-go du Sprint 5.
