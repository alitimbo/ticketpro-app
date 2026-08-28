# Baseline laboratoire — 27 août 2026

## Référence du dépôt

- Branche : `main`
- Commit : `dc4f7a1 feat:v0.2.9`
- Version desktop : `0.2.9`
- État initial du worktree : propre
- Support RouterOS actuel du moteur voucher : RouterOS 7 ou supérieur

## Services observés sur le VPS

| Service | État observé |
| --- | --- |
| `ticketpro-license-api` | actif et sain |
| `ticketpro-wireguard-hub` | actif |
| `ticketpro-reverse-proxy` | actif et sain |
| `autoticket-web-1` | actif et sain, séparé de TicketPro |
| `autoticket-postgres-1` | actif et sain, séparé de TicketPro |

Cette séparation doit être conservée pendant tous les déploiements TicketPro.

## Résultats automatisés

| Contrôle | Résultat |
| --- | --- |
| Tests application | 86 fichiers, 327 tests réussis |
| Tests API, abonnement et hub VPN | 18 tests réussis |
| Vérification TypeScript | réussie |
| `cargo check` | réussi |
| Tests Rust/Tauri | 12 tests réussis |
| Composants WireGuard x86_64 | vérifiés |
| Build frontend | réussi avec avertissement de chunk supérieur à 500 kB |

Le warning Vite sur le chunk principal n'est pas bloquant pour le laboratoire. Il devient une optimisation P2, après les corrections fonctionnelles P0/P1.

## Sauvegarde de départ

- Archive VPS chiffrée : `backups/lab-sprint-0/ticketpro-vps-20260826T231652Z.tar.gz.enc`
- Checksum SHA-256 : `84b956e733eb5d0fc44e1b54675c9d00a6c734a11ead6a421776dd36f788a228`
- Vérification locale : conforme
- Test de lecture non destructif sur le VPS : déchiffrement et tous les checksums conformes
- Contenu : SQLite SaaS, état WireGuard, variables VPS, manifeste de mise à jour et releases

Le fichier reste volontairement ignoré par Git. La phrase secrète de sauvegarde n'est ni copiée dans ce dépôt ni inscrite dans cette documentation.

## Risque de reprise restant

La sauvegarde automatique quotidienne fonctionne, mais `BACKUP_REMOTE` n'est pas configuré. La copie locale de laboratoire réduit le risque immédiat ; un stockage hors site durable reste nécessaire avant toute bêta publique.

## État du poste de laboratoire

- `TicketProVpnService` : démarré automatiquement.
- Tunnel et route IPv4 TicketPro : absents au premier contrôle, application non connectée.
- MikroTik Hyper-V `192.168.88.1:8728` : joignable après démarrage, 0 % de perte sur quatre pings et API TCP ouverte.
- Interface locale utilisée : `vEthernet (TicketPro-LAN)`, adresse `192.168.88.254/24`.
- `api.ticketpro-ne.com` et `vpn.ticketpro-ne.com` : résolus vers `31.207.34.201`.

Les inventaires RouterOS doivent être capturés lorsque la VM et le tunnel du compte pilote sont démarrés.

## Matrice de validation

| ID | Scénario | Couverture actuelle | Validation attendue |
| --- | --- | --- | --- |
| T01 | Réinstaller deux fois les ressources d'un routeur | partielle automatisée | aucun doublon sur routeur réel |
| T02 | Révoquer et renouveler une clé WireGuard | automatisée côté hub | ancienne clé réellement inutilisable |
| T03 | Isoler deux organisations | automatisée côté hub | test réseau réel dans les deux sens |
| T04 | Voucher 1 h, valide 3 h | logique unitaire présente | coupure à 1 h, suppression à 3 h |
| T05 | Voucher 24 h calendaire | logique unitaire partielle | expiration après première activation |
| T06 | Voucher `server=all` | automatisée côté adaptateur | connexion sur les serveurs compatibles |
| T07 | Voucher sur serveur précis | automatisée côté adaptateur | refus sur un autre serveur |
| T08 | Application Windows fermée | moteur RouterOS présent | limites toujours appliquées |
| T09 | Perte Internet du routeur | à construire | reprise unique via outbox |
| T10 | Redémarrage routeur | à exécuter | tunnel et scheduler sans doublon |
| T11 | Horloge incorrecte | garde NTP présente | aucune suppression prématurée |
| T12 | Ticket expiré retiré de RouterOS | logique présente | historique et derniers compteurs conservés |
| T13 | Ticket supprimé manuellement | garde de non-recréation présente | état de divergence explicite |
| T14 | Abonnement expiré | automatisée côté SaaS | aucune suppression RouterOS |
| T15 | Lot de 1 000 tickets | non couvert | interface réactive, reprise partielle |
| T16 | MAC-cookie et reconnexion | automatisée partiellement | reconnexion puis nettoyage final |
| T17 | Réinitialisation de MAC | service présent | action auditée et limitée au ticket |
| T18 | Réponse RouterOS invalide | gestion d'erreur présente | aucune suppression large |

## Critères de sortie du Sprint 0

- [x] Référence Git et version consignées.
- [x] Tests application, API, VPN et compilation validés.
- [x] Sauvegarde VPS chiffrée copiée hors du VPS et vérifiée.
- [x] Commande reproductible `npm run lab:baseline` ajoutée.
- [x] Inventaire daté de TicketPro Lab récupéré.
- [ ] Inventaire daté du routeur pilote Nova récupéré.
- [x] Test non destructif de déchiffrement et d'intégrité de la sauvegarde.
- [ ] Test complet de restauration dans un environnement isolé.

Le Sprint 1 ne modifie pas les routeurs avant la fermeture des inventaires pilotes. Le test complet de restauration reste obligatoire avant la bêta fermée.

## Inventaire TicketPro Lab

Inventaire capturé le 27 août 2026 après redémarrage de la VM.

| Domaine | État observé |
| --- | --- |
| Routeur | `ticketpro-lab`, CHR x86_64 Hyper-V |
| RouterOS | `7.21.5 long-term` |
| Horloge | UTC, NTP synchronisé sur `time.google.com`, décalage 1,612 ms |
| WireGuard | interface active, adresse `10.250.0.2/32`, endpoint officiel TicketPro |
| Routage | route active `10.250.0.0/16` via `ticketpro-vpn` |
| Hotspot | `ticketpro-hotspot`, profil `ticketpro-hotspot-profile`, DNS `ticketpro.lab.net` |
| Vouchers | 55 utilisateurs Hotspot, aucune session ni cookie actif pendant l'inventaire |
| Moteur local | script et scheduler TicketPro v4 présents, scheduler actif toutes les minutes |
| Anti-partage | règle IPv4 TTL active, aucune règle IPv6 TicketPro |
| Bypass | poste d'administration `192.168.88.254` bypassé |

### Écarts enregistrés

1. `ftp`, `ssh`, `telnet` et `www` sont actifs sans restriction `address` et aucune règle générale de fermeture n'a été observée dans l'inventaire TicketPro. Ils doivent être désactivés ou filtrés pendant le Sprint 2.
2. `api` et `winbox` autorisent tout `192.168.88.0/24`. Ce réseau contient aussi les clients Hotspot ; l'accès de gestion doit être séparé ou filtré plus précisément.
3. `api-ssl` est activé sans certificat. Il doit être configuré correctement ou désactivé.
4. Le bloc `TICKETPRO-LIFECYCLE` a été injecté dans le profil utilisateur `default`. Le futur manifeste devra distinguer les profils TicketPro des profils système ou externes.
5. `http-pap` est encore actif sur le profil Hotspot sans HTTPS captif. Il sera retiré après validation de la compatibilité `http-chap` et des parcours de vouchers.
6. La règle TTL est active sur le routeur pilote. Sa présence est conservée pour les tests, mais son activation doit rester volontaire et auditable dans le produit.
