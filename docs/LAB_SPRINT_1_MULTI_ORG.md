# Sprint 1 — VPN multi-organisation

## Objectif

Une installation Windows conserve une seule identité WireGuard et une seule adresse VPN lorsqu'un utilisateur appartient à plusieurs organisations. Les droits d'accès restent décidés par les appartenances et appliqués par le pare-feu du hub.

## Invariants retenus

- une installation = un `installation_id` = une paire de clés WireGuard = une adresse VPN ;
- le changement d'organisation ne crée ni nouvelle clé ni nouvelle adresse ;
- le poste route uniquement le supernet privé TicketPro `10.250.0.0/16` ;
- le poste ne reçoit jamais de route Internet `0.0.0.0/0` ;
- le pare-feu du hub autorise uniquement les couples appareil-routeur appartenant à la même organisation ;
- révoquer une appartenance retire uniquement les chemins de cette organisation ;
- une rotation ou une récupération de clé remplace l'ancienne clé dans toutes les organisations liées à l'identité physique.

## Corrections réalisées

1. L'API renvoie désormais une route cliente stable configurable par `VPN_CLIENT_ALLOWED_IPS`, avec `10.250.0.0/16` comme valeur sûre par défaut.
2. Les routes configurées sont validées au démarrage : uniquement des CIDR IPv4 privés, jamais un full tunnel.
3. Le hub supporte une opération interne `rotate_shared`, accessible uniquement avec son jeton maître.
4. La rotation partagée conserve la même adresse, les états actifs ou suspendus et l'historique des anciennes clés.
5. En cas d'échec pendant la mutation du hub, son état mémoire est restauré avant la reprise de la réconciliation.
6. La base SaaS met à jour transactionnellement toutes les représentations non révoquées de la même clé.
7. Un membre peut renouveler la clé de son propre poste sans recevoir le droit d'administrer les autres appareils.
8. La récupération d'une installation révoquée propage également la nouvelle clé aux autres appartenances encore autorisées.

## Couverture automatisée

- même installation enregistrée dans deux organisations ;
- même clé publique et même adresse VPN dans les deux organisations ;
- route cliente stable `10.250.0.0/16` dans les deux réponses ;
- retour dans la première organisation sans duplication ;
- rotation de clé puis réenregistrement dans la seconde organisation ;
- conservation d'un pair suspendu pendant la rotation ;
- refus d'une identité partagée portant deux adresses différentes ;
- révocation d'une organisation sans perte de l'autre ;
- isolation appareil-routeur entre organisations ;
- récupération d'une clé révoquée via la rotation partagée.

Résultat au 27 août 2026 : 20 tests API/hub réussis et vérification TypeScript réussie.

## Validation laboratoire restante

- déployer ensemble l'API et le hub modifiés sur le VPS ;
- ouvrir deux organisations depuis le même poste et vérifier que `TicketProTunnel` conserve l'adresse du poste et la route `/16` ;
- joindre le routeur TicketPro Lab puis Nova sans recréer le tunnel ;
- renouveler une clé de laboratoire et confirmer que les deux accès restent fonctionnels ;
- révoquer une seule appartenance et confirmer que son routeur devient inaccessible tandis que l'autre reste joignable ;
- capturer l'inventaire Nova avant tout durcissement RouterOS.

Le Sprint 1 n'est considéré terminé qu'après ces contrôles réseau réels.
