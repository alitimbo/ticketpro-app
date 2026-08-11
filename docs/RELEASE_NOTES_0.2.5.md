# TicketPro 0.2.5

Date de préparation : 11 août 2026

## Notes publiques

Cette version renforce la gestion quotidienne des WiFi Zones MikroTik, la
connexion sécurisée et le travail en équipe.

- connexion VPN multi-appareils plus fiable pour les administrateurs et les
  opérateurs invités ;
- restauration sécurisée des routeurs et de leur configuration après une
  réinstallation ou une perte des données locales ;
- synchronisation renforcée des plans, vouchers, états et paramètres avec
  RouterOS ;
- suppression effective des vouchers expirés sur le MikroTik tout en
  conservant leur historique dans TicketPro ;
- écrans routeurs, plans, tickets, clients, fichiers, logs et paramètres plus
  fluides, avec des états de chargement et des retours d'action plus clairs ;
- génération A4 optimisée à 40 tickets par feuille, en grille 5 × 8 ;
- amélioration des tickets thermiques 58 mm et 80 mm ;
- accès direct depuis le bandeau de mise à jour vers la section d'installation
  correspondante ;
- améliorations générales de stabilité, de sécurité et d'isolation entre les
  organisations.

## Texte court pour le manifeste Updater

Connexion sécurisée et restauration multi-appareils renforcées, synchronisation
MikroTik fiabilisée, gestion des vouchers améliorée et impression A4 optimisée à
40 tickets par feuille.

## Validation avant publication

- exécuter `npm.cmd run release:build:windows` avec la clé privée Updater et son
  mot de passe chargés dans le terminal courant ;
- installer la version sur un Windows de qualification ;
- vérifier la connexion, le paiement, un routeur local et distant, la création
  d'un plan, la génération de tickets et le PDF A4 ;
- tester la mise à jour depuis TicketPro 0.2.4 ;
- publier uniquement après validation du redémarrage et de la restauration de
  la sauvegarde locale.
