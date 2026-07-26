# Inventaire des sources de données

Ce fichier décrit l’écart entre les sources actuellement utilisées et les sources attendues après raccordement à SQLite et aux routeurs réels.

## Écrans globaux

| Écran | Source actuelle | Problème | Cible | Phase |
| --- | --- | --- | --- | --- |
| Maison globale | statistiques et activités codées dans le composant | aucune donnée réelle | agrégats SQLite + derniers logs | 1, 8 |
| Mon compte | compte local + routeurs demo | compteur routeurs fictif | compte et routeurs SQLite | 1, 2, 9 |
| Routeurs | `demoRouters`, état React, fake pour test | création/modification non persistées | `RouterRepository` + `RouterService` réel | 1, 3 |
| Abonnement | modèles + `localStorage` | source séparée de SQLite | repositories abonnements/factures | 1, 9 |
| Factures | `localStorage`, export PDF local | pas de facturation persistante centrale | SQLite + fichier PDF réel | 1, 6, 9 |
| Paramètres | `localStorage` | portée et sauvegarde non centralisées | paramètres SQLite, secrets Tauri | 1, 2, 9 |

## Écrans routeur

| Écran | Source actuelle | Problème | Cible | Phase |
| --- | --- | --- | --- | --- |
| Maison routeur | fake RouterOS + tickets demo | dashboard non représentatif | snapshots et lecture routeur | 3, 5, 7 |
| Plans | `FakeRouterAdapter` | plans non persistés localement | plans SQLite + MikroTik | 1, 4 |
| Génération | fake RouterOS + repository mémoire | lots/tickets perdus au redémarrage | transaction SQLite + création RouterOS | 1, 5 |
| Tickets | tickets demo + état React | cycle de vie non persistant | `TicketRepository` + sync | 1, 5 |
| Fichiers | fichiers demo | chemins et actions simulés | `GeneratedFileRepository` + Tauri FS | 6 |
| Rapport | tickets demo | chiffres non issus de la base | requêtes SQLite et exports réels | 8 |
| Clients connectés | fake RouterOS | données non réelles | MikroTik + cache SQLite | 3, 7 |
| Monitoring | fake RouterOS + séries artificielles | mesures simulées | RouterOS + snapshots | 3, 7 |
| Logs | logs demo + état React | audit perdu au redémarrage | `app_logs` SQLite | 1, 8 |
| Paramètres routeur | `localStorage` + fake test | configuration déconnectée du routeur | routeur SQLite + secret protégé | 2, 3 |

## Règle de transition

Un écran ne sera déclaré raccordé que lorsque :

- son chargement initial vient de la source cible ;
- sa création/modification/suppression utilise le service persistant ;
- son état survit à un redémarrage ;
- les erreurs réseau et de base sont visibles ;
- ses tests ne dépendent pas d’un tableau global mutable ;
- les fixtures restent limitées aux tests ou au mode démonstration explicite.
