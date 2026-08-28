# Sprint 5 - charge et beta fermee

## Decision actuelle

**Statut : PRET POUR LES TESTS HYPER-V, NO-GO PUBLIC PROVISOIRE.**

Le socle local est valide, mais le critere officiel exige encore les essais Hyper-V puis les deux MikroTik pilotes. Aucun manifeste public ne doit etre publie avant la signature de cette matrice.

## Resultats automatises du 28/08/2026

Commande reproductible :

```powershell
npm run lab:sprint5
```

Le banc SQLite utilise toutes les migrations reelles TicketPro et ne contacte jamais RouterOS.

| Volume | Tickets | Snapshots | Doublons | Outbox apres reprise | Persistance | Outbox |
|---:|---:|---:|---:|---:|---:|---:|
| 1 000 | 1 000 | 1 000 | 0 | 1 000 | < 0,3 s | < 0,3 s |
| 5 000 | 5 000 | 5 000 | 0 | 5 000 | < 1,0 s | < 1,3 s |

Les temps sont des mesures de laboratoire, pas une promesse de temps de creation RouterOS. Les ecritures MikroTik restent volontairement limitees a trois commandes concurrentes.

Corrections integrees :

- persistance atomique des six snapshots commerciaux ;
- inscription de l'outbox par transactions de 500 operations ;
- reprise idempotente sans ligne dupliquee ;
- recherche RouterOS ciblee par nom au lieu d'une lecture complete pour chaque reprise ;
- preuve de propriete `batch=` dans chaque nouveau voucher ;
- refus d'adopter un code cree par un autre operateur ;
- moteur de cycle de vie RouterOS v6 preservant cette propriete ;
- audit npm : 0 vulnerabilite connue apres mises a jour compatibles.

## Etape A - preparer TicketPro Lab

1. Sauvegarder la VM Hyper-V et exporter le routeur avant la charge.
2. Demarrer uniquement TicketPro Lab. Nova reste hors du test initial.
3. Ouvrir TicketPro, actualiser le routeur et reparer sa configuration geree afin d'installer le moteur v6.
4. Verifier dans WinBox :

```routeros
/system script print detail where name="ticketpro-voucher-expiration-v1"
/system scheduler print detail where name="ticketpro-voucher-expiration-v1"
```

Le commentaire attendu est `TicketPro managed voucher lifecycle v6`, avec exactement un script et un scheduler actif.

## Etape B - palier 1 000 vouchers

La limite produit de 500 tickets par lot reste une protection volontaire. Ne pas l'augmenter.

1. Relever CPU, memoire libre, espace disque et nombre de vouchers avant le test.
2. Creer deux lots de 500 avec le prefixe `S5A` et le meme plan de laboratoire.
3. Attendre la fin de chaque lot et la file durable a zero.
4. Copier `docs/routeros-sprint5-load-verify.rsc` dans Files via WinBox, puis lancer :

```routeros
/import file-name=routeros-sprint5-load-verify.rsc verbose=yes
```

Conditions de passage :

- `sprint5-vouchers=1000` ;
- aucun `cleanup-error` ;
- aucun lot partiel non explique ;
- file durable revenue a zero ;
- interface utilisable et aucune fermeture de TicketPro ;
- pas de mot de passe, token ou cle privee dans les logs.

## Etape C - palier 5 000 vouchers

Ajouter huit lots de 500 avec le meme prefixe pour atteindre 5 000 au total. Refaire l'inventaire apres les lots 4, 7 et 10.

Arreter immediatement la montee si l'un de ces seuils est atteint :

- memoire libre inferieure a 20 % ;
- espace disque libre inferieur a 15 % ;
- CPU superieur a 90 % pendant plus de cinq minutes ;
- trois erreurs RouterOS consecutives ;
- scheduler en retard, desactive ou duplique ;
- TicketPro cree un doublon, perd un snapshot ou presente un ticket echoue comme synchronise.

## Etape D - plusieurs operateurs

Utiliser deux installations Windows distinctes membres de la meme organisation.

1. Operateur A cree 500 vouchers avec le prefixe `S5A`.
2. Operateur B cree simultanement 500 vouchers avec le prefixe `S5B`.
3. Le proprietaire actualise Tickets, Fichiers, Rapports et Logs.
4. Verifier que les 1 000 vouchers sont visibles avec leur auteur et leur lot.
5. Rejouer Actualiser/Reparer : aucun voucher ne doit etre recree.

Une collision de code doit produire `ROUTER_VOUCHER_OWNERSHIP_CONFLICT`, jamais rattacher le voucher au mauvais lot.

La recette complète PC partagé / PC personnel / accès local et distant est définie dans
`docs/FIRST_CLIENT_NETWORK_REVIEW.md`.

## Etape E - reprise apres incident

Executer avec un lot de 500 dedie a chaque scenario :

- fermer TicketPro pendant la creation, redemarrer et vider l'outbox ;
- redemarrer RouterOS pendant la creation, attendre le retour WireGuard puis reprendre ;
- couper Internet Windows, retablir le reseau et verifier qu'aucune identite VPN ne change ;
- redemarrer Windows et verifier le meme `installationId`, la meme IP VPN et le service en cours ;
- apres sauvegarde VPS verifiee, redemarrer le controleur puis le VPS et controler la reconciliation ;
- revoquer un appareil : lui seul perd l'acces ;
- expirer puis reactiver un abonnement : appareils conserves, acces coupe puis restaure sans nouvelle cle.

## Etape F - mise a jour et rollback Windows

Les installateurs 0.2.7, 0.2.8 et 0.2.9 restent disponibles dans le dossier NSIS local pour le laboratoire.

1. Sauvegarder la base SQLite et relever `installationId`, IP VPN et version du service.
2. Installer la version laboratoire par-dessus 0.2.9 sans desinstaller l'identite.
3. Verifier service, tunnel, handshake et acces routeur.
4. Simuler le rollback avec l'installateur 0.2.9 uniquement sur la VM de test.
5. Verifier que la cle, l'IP, les routeurs et l'historique ne sont pas dupliques.
6. Restaurer le snapshot si une ancienne version ne sait pas relire la base migree.

Ne jamais publier un ancien manifeste comme rollback global. Le rollback est d'abord une operation controlee sur la VM.

## Matrice GO/NO-GO

| P0 | Automatique | Hyper-V | Pilote 1 | Pilote 2 |
|---|---|---|---|---|
| 1 000 puis 5 000 sans doublon/perte | OK | A faire | A faire | A faire |
| Deux operateurs simultanes | OK logique | A faire | A faire | A faire |
| Reprise PC/routeur/VPS | Tests partiels OK | A faire | A faire | A faire |
| Revocation et abonnement | Tests API/VPN | A faire | A faire | A faire |
| Secrets et permissions | npm OK, tests OK | A verifier | A verifier | A verifier |
| Update et rollback Windows | Preflight existant | A faire | N/A | N/A |
| Cycle voucher v6 | Tests OK | A faire | A faire | A faire |

Le GO beta fermee exige toutes les colonnes P0 vertes. Le GO public est une decision ulterieure.

## Nettoyage du jeu de charge

Seulement apres export et validation du rapport, supprimer les comptes de test par leur prefixe dedie :

```routeros
/ip hotspot user remove [find where name~"^S5"]
```

Cette commande ne doit jamais etre utilisee avec un prefixe commercial. L'historique TicketPro reste archive localement.
