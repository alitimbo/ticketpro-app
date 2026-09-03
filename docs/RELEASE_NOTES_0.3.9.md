# TicketPro 0.3.9

## Suppression sécurisée des routeurs

- neutralisation et vérification des vouchers TicketPro sur RouterOS avant suppression ;
- suppression des sessions, cookies et autorisations réseau gérées par TicketPro ;
- conservation de la place d'abonnement tant que le nettoyage n'est pas confirmé ;
- révocation du pair WireGuard avant la libération définitive du quota ;
- archivage local et cloud des lots et tickets pour préserver l'audit ;
- reprise possible après une panne ou un routeur temporairement inaccessible ;
- blocage des nouvelles synchronisations de vouchers pendant le déclassement ;
- protection contre la réapparition d'un routeur supprimé depuis une ancienne base locale ;
- finalisation locale possible lorsqu'un routeur a déjà été retiré par le support.

## Compatibilité

Les utilisateurs Hotspot créés manuellement sur MikroTik ne sont pas supprimés. Les fichiers et
historiques TicketPro restent disponibles pour l'audit.
