# Validation production RouterOS et WireGuard

Cette checklist doit être exécutée sur un MikroTik RouterOS 7 réel avant de fusionner la branche.

## Préparation du routeur

```routeros
/ip/service/print detail where name="api"
/ip/hotspot/print detail
/ip/hotspot/user/profile/print detail
```

Le PC TicketPro doit pouvoir joindre l'adresse LAN du routeur et le port TCP 8728.

## Connexion locale

1. Ajouter le routeur avec son IP LAN, le port 8728 et un compte RouterOS autorisé.
2. Exécuter **Tester la connexion**.
3. Vérifier la récupération du modèle, du numéro de série et de la version RouterOS.
4. Vérifier qu'un échec d'authentification, de permission ou de TCP affiche un diagnostic distinct.
5. Vérifier qu'un routeur non testé ne peut pas être enregistré.

## Plans et vouchers

1. Créer un plan de 10 minutes et 10 Mo.
2. Vérifier le profil dans `/ip/hotspot/user/profile/print detail`.
3. Générer un voucher.
4. Vérifier dans `/ip/hotspot/user/print detail` :
   - le nom du profil MikroTik ;
   - `limit-uptime=10m` ;
   - `limit-bytes-total=10485760`.
5. Connecter un téléphone avec le voucher.
6. Vérifier la session dans `/ip/hotspot/active/print detail` et dans TicketPro.
7. Déconnecter puis désactiver le voucher depuis TicketPro.

## WireGuard

1. Provisionner le pair routeur depuis le LAN.
2. Vérifier `/interface/wireguard/print detail` et `/interface/wireguard/peers/print detail`.
3. Vérifier que la règle `TicketPro WireGuard` précède la première règle `drop` de la chaîne `input`.
4. Vérifier que le pair n'est marqué actif dans TicketPro qu'après une commande RouterOS réussie sur son IP VPN, port 8728.
5. Depuis un autre accès Internet, activer un pair opérateur et ouvrir le routeur dans TicketPro.
6. Redémarrer le PC, le VPS et le MikroTik puis répéter le test distant.

### Réinstallation de TicketPro

La suppression de l'application ou de sa base locale ne doit pas imposer de
supprimer le tunnel sur le MikroTik. Après avoir reconnecté le même compte et
réenregistré le routeur par son adresse LAN :

1. ouvrir **VPN distant WireGuard** ;
2. sélectionner le routeur puis lancer son provisionnement ;
3. TicketPro détecte l'interface `ticketpro-vpn`, réutilise sa clé publique et
   récupère auprès du VPS l'adresse déjà attribuée ;
4. TicketPro reconstruit le pair et la connexion VPN dans la base locale sans
   remplacer la clé privée conservée par RouterOS.

Le message attendu contient `Tunnel VPN existant récupéré`. Si l'installation
se fait sur un autre PC, un nouveau pair opérateur est nécessaire : la clé
privée d'un poste opérateur n'est jamais stockée sur le VPS.

## Commandes de validation du code

```bash
npm test
npm run type-check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```
