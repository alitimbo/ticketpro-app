# Portée de la remise en état RouterOS

Cette branche corrige le chemin de production suivant :

- connexion TCP RouterOS depuis Tauri ;
- distinction des attributs et query words de l'API RouterOS ;
- diagnostics d'authentification, de permissions et de réseau ;
- interdiction d'enregistrer un routeur non testé ;
- correspondance entre les identifiants SQLite et les profils MikroTik ;
- application de `limit-uptime` et `limit-bytes-total` aux vouchers ;
- basculement automatique entre endpoint LAN et endpoint WireGuard ;
- stockage du contrôle RouterOS dans WireGuard sur le port 8728 sans TLS additionnel ;
- validation d'une commande RouterOS distante avant activation du pair VPN ;
- protection DPAPI des nouveaux secrets sur Windows ;
- suppression des résultats fictifs de découverte réseau.

Les validations sur matériel réel restent obligatoires avant fusion.
