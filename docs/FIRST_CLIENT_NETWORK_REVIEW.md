# Revue réseau du premier client

## Décision d'architecture

TicketPro prend en charge deux usages complémentaires.

### PC partagé dans la WiFi Zone

- Une installation Windows correspond à une seule identité WireGuard, une seule clé privée locale et une seule adresse VPN.
- Le propriétaire, l'Admin et les employés utilisent leurs identifiants TicketPro personnels, l'un après l'autre.
- L'utilisateur doit toujours cliquer sur **Changer d'utilisateur** à la fin de son service.
- TicketPro attend désormais la déconnexion VPN et la révocation de la session SaaS avant d'autoriser la connexion suivante.
- La clé privée, l'`installationId` et l'adresse VPN ne sont pas recréés lors d'un changement d'utilisateur.
- Les permissions applicatives et l'accès aux routeurs correspondent au dernier utilisateur authentifié.
- Un opérateur ne peut pas modifier les scripts, WireGuard, l'anti-partage ou les paramètres RouterOS réservés à l'Admin.

Une seule session TicketPro peut être active à la fois sur ce PC. Plusieurs sessions Windows utilisant TicketPro simultanément sur la même machine ne font pas partie du pilote : elles pourraient commander le même tunnel natif. Pour travailler simultanément, chaque employé doit utiliser son propre PC.

### PC personnel d'un employé

- L'employé reçoit une invitation nominative et ne partage jamais le mot de passe du propriétaire.
- Son installation possède son propre `installationId`, sa propre paire de clés et sa propre IP VPN.
- Son rôle et sa liste de routeurs sont définis dans **Équipe et accès**.
- Sa révocation coupe uniquement ses appareils et conserve le PC partagé/Admin.
- Un appareil collaborateur n'utilise pas le quota de postes du propriétaire dans le modèle actuel.

## Sélection locale et distante

Chaque routeur conserve les deux chemins lorsqu'ils existent :

1. adresse locale RouterOS ;
2. adresse WireGuard TicketPro.

TicketPro essaie le chemin préféré puis bascule vers l'autre chemin si le premier échoue. Pour le PC de la boutique, le mode local peut être préféré afin de rester administrable sans Internet. Sur un PC extérieur, l'échec local entraîne le repli automatique vers WireGuard.

Les services RouterOS doivent rester limités à :

```text
LAN de gestion du routeur
10.250.0.0/16
```

FTP, Telnet et WebFig HTTP non utilisés restent désactivés. Le compte `ticketpro-api` reste le compte d'automatisation ; le compte Admin MikroTik de secours n'est pas supprimé.

## Recette du premier client

### A. Sauvegardes

- Export RouterOS et sauvegarde binaire avant intervention.
- Copie de la base TicketPro et relevé de l'`installationId` du PC partagé.
- Vérification de la sauvegarde VPS avant toute modification du hub.

### B. PC partagé sur site

1. Le propriétaire se connecte et vérifie le routeur en mode local.
2. Noter l'`installationId`, l'IP VPN et la version du service.
3. Cliquer sur **Changer d'utilisateur** et attendre la fin du loader.
4. Un opérateur invité se connecte sur le même PC.
5. Vérifier que l'identité et l'IP VPN restent identiques.
6. Vérifier que l'opérateur peut créer des tickets, mais pas modifier les paramètres réseau.
7. Revenir au propriétaire et vérifier que les droits Admin sont restaurés sans nouvelle clé.

### C. PC personnel d'un employé

1. Installer TicketPro sur un second PC Windows.
2. Accepter l'invitation avec un compte personnel.
3. Vérifier que la clé publique, l'`installationId` et l'IP VPN diffèrent du PC partagé.
4. Tester uniquement les routeurs accordés à cet employé.
5. Vérifier qu'un routeur d'une autre organisation reste inaccessible.

### D. Gestion réseau

Tester depuis le PC Admin puis contrôler RouterOS :

- lecture en direct des clients connectés ;
- déconnexion d'un client ;
- ajout et suppression d'un bypass IP Binding ;
- blocage puis déblocage d'une IP/MAC de test ;
- actualisation des plans et profils Hotspot ;
- réparation idempotente du moteur de vouchers v6 ;
- lecture des rapports, fichiers et logs par le propriétaire après une action opérateur.

Chaque action doit afficher succès, échec, élément déjà présent, élément introuvable ou routeur inaccessible. Une action ne doit jamais être déclarée réussie avant confirmation RouterOS.

### E. Révocation

1. Révoquer le PC personnel de l'employé.
2. Vérifier qu'il perd l'accès distant.
3. Vérifier que le PC partagé reste connecté.
4. Réactiver l'employé si nécessaire et confirmer qu'aucune nouvelle clé du PC partagé n'est créée.

### F. Reprise

- Redémarrage TicketPro ;
- redémarrage Windows ;
- changement Wi-Fi/Ethernet ;
- coupure puis retour Internet ;
- redémarrage RouterOS ;
- reprise de la file durable ;
- aucune duplication de device, clé, IP, routeur, lot ou voucher.

## GO / NO-GO pilote

Le premier client peut démarrer uniquement si :

- les tests Hyper-V 1 000 puis 5 000 vouchers sont verts ;
- le moteur RouterOS v6 est présent une seule fois ;
- le PC partagé change d'utilisateur sans changer d'identité VPN ;
- le PC personnel possède une identité indépendante ;
- la révocation du PC personnel ne coupe pas le PC partagé ;
- l'accès local et l'accès VPN sont tous deux confirmés ;
- l'isolation entre organisations est confirmée ;
- aucun secret n'apparaît dans les logs ou diagnostics ;
- sauvegarde et procédure de retour arrière sont disponibles.

Tout échec P0 maintient le statut **NO-GO public**.
