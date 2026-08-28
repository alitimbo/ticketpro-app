# Sprint 2 — Manifeste RouterOS et propriété TicketPro

## Objectif

TicketPro ne doit réconcilier que les objets qu'il possède ou les extensions
qu'il a explicitement ajoutées à un objet partagé. Un objet externe ne doit
jamais être supprimé ou réécrit par simple découverte.

## Livré dans la première étape

- migration locale `028_router_managed_resource_manifest.sql` ;
- manifeste sans secret, versionné par routeur et révisé à chaque observation ;
- états `present`, `missing`, `drift` et `duplicate` ;
- propriété `ticketpro`, `shared` ou `external` ;
- lecture RouterOS sans clé privée, mot de passe ni configuration WireGuard complète ;
- détection des dérives des scripts, schedulers, profils Hotspot, DNS, NTP,
  règles firewall, IP bindings, tunnel WireGuard, compte de gestion et services ;
- capture du manifeste après une réconciliation réussie du routeur ;
- conservation des profils non revendiqués ; aucun retrait implicite pendant une réparation ;
- conservation intégrale du script `on-login` externe ;
- déduplication des adresses, peers, routes et règles firewall appartenant au
  tunnel `ticketpro-vpn` ;
- adoption des anciens commentaires WireGuard TicketPro vers les identifiants stables v1.

## Matrice de propriété

| Ressource | Propriété | Politique |
| --- | --- | --- |
| Script et scheduler voucher | TicketPro | créer, mettre à jour, dédupliquer |
| Bloc marqué dans `on-login` | TicketPro dans un profil partagé | ajouter ou réparer uniquement sur un profil explicitement revendiqué ; ne jamais retirer ailleurs sans action dédiée |
| Profil utilisateur Hotspot | Partagé | jamais supprimer par le manifeste |
| Profil serveur Hotspot et DNS | Partagé | auditer ; modifier uniquement via l'action métier explicite |
| Règles `TicketPro anti-tethering:` | TicketPro | réconcilier et dédupliquer |
| Bindings `TicketPro infrastructure:` / `TicketPro blocked:` | TicketPro | réconcilier et dédupliquer |
| Interface `ticketpro-vpn` et ses objets marqués | TicketPro | créer, mettre à jour, dédupliquer |
| NTP RouterOS | Partagé | activer si nécessaire, ne jamais supprimer les serveurs externes |
| Services API/WinBox/SSH/etc. | Partagé | auditer avant durcissement |
| Profil `default` ou script installateur | Externe | ne jamais écraser ; retirer seulement un bloc TicketPro identifiable |

## Profils de vouchers revendiqués

Un profil est revendiqué uniquement s'il remplit au moins une condition :

1. il a été créé localement par un profil TicketPro identifié ;
2. un voucher portant le marqueur `TicketPro:v1;` l'utilise ;
3. l'utilisateur l'a sélectionné pour une nouvelle génération de vouchers.

La simple présence du profil dans RouterOS ne suffit plus. Ainsi, `default`
reste toujours externe : il est exclu du moteur TicketPro et ne peut plus être
sélectionné pour une génération commerciale. Un forfait dédié doit être créé.

## Sécurité des services RouterOS

Le manifeste attend à terme :

- un groupe `ticketpro-api` avec `api,policy,read,sensitive,test,write` ;
- un utilisateur dédié `ticketpro-api`, actif et rattaché à ce groupe ;
- API et WinBox actifs uniquement sur le LAN autorisé et `10.250.0.0/16` ;
- tout autre service désactivé ou limité aux mêmes réseaux.

L'application fournit désormais un workflow explicite en deux étapes :

1. créer ou mettre à jour le compte `ticketpro-api`, puis tester une vraie
   connexion API avec ce compte en local ou via le VPN ;
2. après une seconde confirmation, limiter les services au LAN du routeur et à
   `10.250.0.0/16`, puis retester le compte dédié avant de conserver ses
   identifiants localement.

Le compte `admin` existant n'est jamais supprimé ni désactivé. Une connexion
testée uniquement par adresse IP publique ne permet pas d'appliquer les
restrictions. FTP, Telnet, WebFig HTTP/HTTPS et API-SSL sans configuration sont
désactivés ; API, WinBox et SSH restent limités aux réseaux autorisés.

Ce workflow n'est jamais exécuté automatiquement lors de l'ajout, de la
modification ou de la réconciliation d'un routeur. Pour Nova, la politique reste
**auditée seulement** jusqu'à la réception de son inventaire et la confirmation
d'un accès de secours.

## Validation du compte dédié sur TicketPro Lab

Avant le test :

1. créer un checkpoint Hyper-V du CHR ;
2. conserver la fenêtre WinBox ouverte en local ;
3. vérifier que `192.168.88.0/24` et `10.250.0.0/16` sont bien les réseaux
   d'administration attendus ;
4. ouvrir `Routeur > Paramètres routeur > Sécurité de l'administration RouterOS`.

Dans TicketPro :

1. cliquer sur `Préparer le compte dédié` ;
2. attendre la confirmation `Compte vérifié` ;
3. vérifier qu'aucun service n'a encore été restreint ;
4. cliquer sur `Appliquer les restrictions`, lire l'avertissement et confirmer ;
5. attendre le message `Administration RouterOS sécurisée` ;
6. relancer le test de connexion réelle.

Dans WinBox, exécuter ensuite `routeros-sprint2-verify.rsc` et vérifier :

- un groupe `ticketpro-api` avec les politiques minimales attendues ;
- un utilisateur `ticketpro-api` actif dans ce groupe ;
- API et WinBox actifs sur `192.168.88.0/24,10.250.0.0/16` ;
- SSH actif mais limité aux mêmes réseaux ;
- FTP, Telnet, WebFig HTTP/HTTPS et API-SSL désactivés ;
- aucun doublon TicketPro.

Répéter les deux actions une seconde fois. L'état RouterOS et les comptages du
script de vérification doivent rester strictement identiques.

Si un contrôle échoue, ne pas tester Nova. Restaurer le checkpoint Hyper-V,
conserver les journaux TicketPro et la sortie complète du script de vérification.

## Validation automatisée

```powershell
npm.cmd run type-check
npx.cmd vitest run src/services/router/MikroTikRouterAdapter.test.ts `
  src/services/database/repositories/RouterManagedResourceManifestRepository.test.ts `
  src/services/recovery/RouterStateReconciliationService.test.ts `
  src/services/database/migrations.test.ts
```

## Validation Hyper-V

1. Sauvegarder/exporter le CHR.
2. Dans TicketPro, modifier puis enregistrer TicketPro Lab une première fois.
3. Exécuter `routeros-sprint2-verify.rsc` dans WinBox et conserver la sortie.
4. Modifier puis enregistrer le même routeur une deuxième fois, sans autre changement.
5. Réexécuter le script.
6. Vérifier : un script, un scheduler, une interface, un peer, une adresse et
   une seule route statique TicketPro ; la route connectée dynamique n'est pas
   un doublon ; le profil `default` ne contient aucun bloc lifecycle TicketPro ;
7. Confirmer que le script `on-login` externe éventuel est toujours présent.

## Condition avant durcissement

Ne pas utiliser l'action de restriction sur Nova tant que son inventaire n'a pas
été capturé et qu'un accès de secours n'a pas été confirmé. Le routeur TicketPro
Lab doit d'abord réussir deux passages idempotents complets.
