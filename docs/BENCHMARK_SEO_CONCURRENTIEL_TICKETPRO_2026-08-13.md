# Benchmark produit, concurrentiel et SEO international — TicketPro

Date du relevé : 13 août 2026  
Marché d’origine : Niger  
Marché prioritaire d’expansion : Afrique francophone et francophonie internationale  
Marché mondial à long terme : opérateurs MikroTik multilingues  
Site officiel : https://www.ticketpro-ne.com  
Produit audité : TicketPro Desktop 0.2.7

## 1. Résumé exécutif

TicketPro n’est pas seulement un générateur de vouchers. C’est un logiciel Windows de gestion opérationnelle de WiFi Zones MikroTik qui réunit : routeurs, Hotspots, plans, vouchers, utilisateurs connectés, rapports, impressions, équipes, abonnements et accès distant sécurisé.

Le positionnement recommandé en français est :

> Le logiciel Windows professionnel pour gérer des WiFi Zones MikroTik, créer et suivre les tickets WiFi, travailler en équipe et piloter les routeurs à distance sans exposer leurs ports ni installer WireGuard séparément.

La stratégie ne doit pas enfermer TicketPro dans le Niger. Le Niger reste le marché d’origine, la preuve de proximité et le premier avantage de paiement local. La marque doit cependant parler dès maintenant à toute la francophonie avec un contenu principal générique, puis proposer des variantes locales pour les prix, moyens de paiement, témoignages, obligations et coordonnées.

À long terme, le positionnement mondial recommandé est :

> TicketPro WiFi is a Windows operations platform for MikroTik hotspots: manage routers, vouchers, connected users, teams and secure remote access from one application.

Le qualificatif **TicketPro WiFi** ou **TicketPro MikroTik** doit être utilisé systématiquement dans les titres, descriptions, profils sociaux et contenus internationaux. Le nom « TicketPro » seul est déjà fortement associé dans plusieurs pays à des plateformes de billetterie événementielle. Ce qualificatif réduit la confusion sémantique et améliore la pertinence SEO, sans imposer immédiatement un changement de nom du produit.

Le principal avantage concurrentiel de TicketPro est la combinaison suivante :

- application Windows installable avec base locale ;
- gestion MikroTik locale et distante dans la même interface ;
- tunnel WireGuard intégré et invisible pour l’utilisateur final ;
- plusieurs routeurs, organisations, utilisateurs et postes ;
- permissions par rôle et par routeur ;
- synchronisation réelle avec RouterOS ;
- cycle de vie des vouchers distinguant durée d’utilisation et durée de validité ;
- PDF A4 de 40 tickets, aperçu obligatoire et formats thermiques ;
- restauration des routeurs et de leur configuration métier après perte ou changement de PC ;
- paiement d’abonnement adapté au Niger via Nita, Amanata et Mobile Money.

La priorité absolue n’est cependant pas éditoriale : le domaine officiel est actuellement mal servi. La page d’accueil répond en HTTP 200 depuis LWS, mais les routes internes, le sitemap et les fichiers SEO renvoient des erreurs ou un contenu différent de l’application Astro déployée sur Vercel. Tant que ce point n’est pas réparé, l’essentiel du travail SEO restera bloqué.

## 2. Périmètre et méthode

Ce document combine quatre sources :

1. le code et les tests de TicketPro Desktop 0.2.7 ;
2. le code source de la landing Astro située dans `C:\ticketpro-landing` ;
3. un contrôle HTTP du domaine officiel et du déploiement Vercel ;
4. un relevé public des concurrents et des résultats de recherche visibles au 13 août 2026.

Les prix et fonctions des concurrents peuvent évoluer. Les chiffres ci-dessous sont des instantanés, pas une promesse durable. Les volumes de recherche ne sont pas inventés : ils devront être complétés dans Google Keyword Planner, Google Search Console, Semrush, Ahrefs, Ubersuggest ou un outil équivalent.

## 3. Fiche produit à transmettre à un outil SEO

```yaml
brand: TicketPro
official_domain: https://www.ticketpro-ne.com
product_type: Logiciel SaaS desktop Windows de gestion de Hotspots MikroTik
current_version: 0.2.7
primary_language: français
market_origin:
  - Niger
priority_expansion_markets:
  - Afrique francophone
  - France
  - Belgique francophone
  - Suisse romande
  - Québec et Canada francophone
long_term_markets:
  - Afrique anglophone
  - marchés lusophones
  - marchés hispanophones
  - exploitants MikroTik internationaux
platform:
  - Windows 10/11 x64
router_ecosystem:
  - MikroTik RouterOS
core_audiences:
  - propriétaires de WiFi Zones
  - opérateurs Wi-Fi
  - techniciens MikroTik
  - cybercafés
  - hôtels et restaurants
  - écoles et universités
  - entreprises multi-sites
  - intégrateurs réseau
business_model:
  - abonnement mensuel ou annuel
  - capacité selon le nombre de routeurs
  - limite de postes selon l'offre
  - offre Entreprise sur devis
primary_conversion:
  - télécharger le setup Windows
secondary_conversions:
  - consulter les tarifs
  - contacter le support ou les ventes
  - créer un compte dans l'application
payment_methods:
  - Nita
  - Amanata
  - Mobile Money via iPay
future_payment_methods:
  - cartes bancaires via Stripe, sous réserve d'éligibilité de l'entité marchande
future_languages:
  - anglais
  - portugais
  - espagnol
main_competitors:
  - TikFlow
  - MikroTicket
  - Mikhmon
  - MKController
  - WIFIZONE MANAGER / MikManager
  - Mikrogestion
  - Mana Zone
  - Ticket WiFi Zone
  - Powerlynx
  - HotspotSystem
  - Antamedia HotSpot
  - IronWiFi
main_differentiators:
  - application Windows locale avec synchronisation cloud
  - WireGuard embarqué sans installation manuelle du client WireGuard
  - gestion locale et distante dans la même application
  - équipes, invitations et accès limités par routeur
  - gestion multi-organisation
  - récupération de l'état métier après perte ou changement de PC
  - cycle de vie précis des vouchers
  - impressions A4 40 tickets et thermique 58/80 mm
  - paiement local adapté au Niger
claims_to_avoid:
  - compatibilité garantie avec tous les modèles et toutes les versions RouterOS
  - blocage absolu de tout partage de connexion
  - sécurité inviolable
  - paiement automatique des tickets par le client final
  - portail captif personnalisable si la fonction n'est pas encore livrée
```

## 4. Inventaire des fonctionnalités réelles de TicketPro

### 4.1 Comptes, SaaS et abonnements

- inscription simple, connexion et persistance de session ;
- réinitialisation de mot de passe par email ;
- essai gratuit et conversion vers un abonnement payant ;
- période de grâce après expiration pour les abonnements payés ;
- relances automatiques par email ;
- plans mensuels, annuels et sur devis ;
- capacité par nombre de routeurs et nombre de postes ;
- paiement iPay avec Nita, Amanata et Mobile Money ;
- historique des paiements et factures ;
- mise à jour automatique et installateur Windows signé par l’Updater Tauri.

### 4.2 Organisations, équipes et droits

- plusieurs organisations accessibles avec le même compte ;
- invitation par email ;
- rôles administrateur, opérateur, agent et lecture seule selon la politique active ;
- accès à tous les routeurs ou à une sélection précise ;
- séparation entre propriétaire d’abonnement et membre invité ;
- connexion simultanée depuis plusieurs PC, dans la limite de l’offre ;
- révocation d’un appareil sans révoquer les autres membres.

### 4.3 Routeurs MikroTik

- ajout, modification, suppression et test de connexion ;
- accès local ou distant ;
- détection de l’identité et des informations RouterOS ;
- gestion du DNS du Hotspot ;
- supervision de l’état réel du routeur ;
- synchronisation et récupération des plans, réglages et métadonnées ;
- sauvegarde locale et état de récupération côté VPS ;
- prise en charge de plusieurs routeurs et plusieurs WiFi Zones.

### 4.4 Connexion distante sécurisée

- architecture WireGuard en hub sur le VPS ;
- service Windows `TicketProVpnService` installé avec TicketPro ;
- aucune installation séparée de l’application WireGuard pour le client ;
- clé privée conservée sur le PC et protégée localement ;
- une identité et une IP VPN par installation ;
- états de connexion, réparation, révocation et renouvellement ;
- prise en charge multi-organisation et routage vers plusieurs sous-réseaux TicketPro ;
- réconciliation automatique entre la base et le hub VPN ;
- isolation des organisations au niveau du hub et du pare-feu.

### 4.5 Plans et profils Hotspot

- lecture des profils réellement présents dans RouterOS ;
- création, modification, synchronisation et suppression ;
- durée de session, durée de validité, débit, quota et nombre d’appareils ;
- association du prix TicketPro au profil ;
- contrôle préalable de l’existence du serveur Hotspot et du profil.

### 4.6 Vouchers et impressions

- génération individuelle ou par lot ;
- choix du routeur, du serveur Hotspot, de l’option `All` et du profil ;
- identifiant seul ou identifiant et mot de passe distinct ;
- aperçu obligatoire avant création réelle ;
- préférences d’affichage mémorisées par routeur ;
- titre WiFi, entreprise ou texte personnalisé ;
- prix, devise, durée, validité, DNS, note, contact et mention TicketPro ;
- QR code facultatif et désactivé par défaut ;
- PDF A4 de 40 tickets, soit 5 colonnes par 8 lignes ;
- formats thermiques 58 mm et 80 mm avec aperçu ;
- fichiers archivés et réimprimables ;
- nommage reconnaissable des PDF avec routeur, plan et prix.

### 4.7 Cycle de vie et synchronisation des tickets

- états Nouveau, Actif, En cours, Épuisé, Expiré, Désactivé, Supprimé et Archivé ;
- distinction entre temps d’utilisation cumulé et fenêtre de validité ;
- coupure et désactivation lorsque le temps ou le quota est consommé ;
- suppression physique du compte RouterOS uniquement à l’expiration de la validité ;
- nettoyage des sessions actives, cookies, MAC-cookies, IP bindings associés et connexions réseau ;
- conservation de l’historique local après suppression sur MikroTik ;
- état d’erreur de synchronisation si RouterOS ne confirme pas l’action ;
- interdiction de recréer silencieusement un utilisateur épuisé en remettant son compteur à zéro.

### 4.8 Exploitation en direct

- accueil routeur alimenté par RouterOS ;
- clients connectés en direct avec durée et consommation ;
- déconnexion, blocage et déblocage ;
- rapports de ventes, tickets, profils et utilisation ;
- état réseau et métriques du routeur ;
- logs filtrables avec politique de conservation ;
- actualisation périodique sans remplacer les données valides par un faux zéro lors d’une erreur temporaire.

### 4.9 Contrôle d’accès réseau

- IP Binding MikroTik ;
- ajout et retrait d’équipements en bypass ;
- prise en charge de plusieurs antennes ou équipements en bridge transparent ;
- liaison du voucher à un appareil lorsque cette politique est activée ;
- protections IPv4/IPv6 contre certains scénarios de partage de connexion ;
- synchronisation entre réglage local, VPS et RouterOS.

## 5. Positionnement recommandé

### Promesse principale

> Gérez vos Hotspots MikroTik, vos tickets WiFi et vos équipes depuis Windows, sur place ou à distance.

### Proposition de valeur complète

> TicketPro centralise les routeurs MikroTik, les profils Hotspot, les vouchers, les impressions, les clients connectés, les ventes et les rapports. Son service de connexion sécurisée intégré permet d’administrer les routeurs distants sans installer WireGuard séparément et sans exposer directement les ports RouterOS sur Internet.

### Preuves à afficher

- « 40 tickets par page A4 » ;
- « accès local et distant dans la même application » ;
- « connexion sécurisée intégrée à l’installation Windows » ;
- « durée d’utilisation et validité gérées séparément » ;
- « équipes avec accès limité aux routeurs autorisés » ;
- « plans et utilisateurs relus directement depuis RouterOS » ;
- « récupération de la configuration après perte ou changement de PC » ;
- « paiements Nita, Amanata et Mobile Money ».

### Catégorie SEO à revendiquer

La catégorie centrale doit rester **logiciel de gestion Hotspot MikroTik**. Les expressions « logiciel WiFi Zone », « gestion de tickets WiFi », « vouchers MikroTik » et « accès distant MikroTik » doivent former les sous-catégories.

## 6. Benchmark concurrentiel

### 6.1 Concurrents directs

| Concurrent | Positionnement public | Forces visibles | Faiblesses ou angle d’attaque pour TicketPro |
|---|---|---|---|
| TikFlow | Application Android, Linux et Windows pour Hotspots MikroTik | Prix très agressif, multi-plateforme, WireGuard, PDF A3/A4, sous-comptes | TicketPro doit démontrer davantage sa sécurité Windows intégrée, la récupération, le multi-organisation, le cycle de vie et le support local |
| MikroTicket | Vente de WiFi par vouchers sur mobile et PC | Forte présence sur les stores, impression thermique, QR, notifications, rôles, accès distant, éditeur de portail | TicketPro peut se différencier par le contrôle local Windows, l’identité de poste, la restauration, l’isolation des organisations et le marché nigérien |
| Mikhmon | Outil web gratuit et open source sans RADIUS | Gratuit, connu, léger, multi-routeurs, vouchers, rapports, modèles personnalisés | Installation et maintenance plus techniques, architecture plus ancienne, pas de SaaS intégré ni de VPN Windows invisible |
| MKController | Contrôle cloud MikroTik et monétisation WiFi | NATCloud, sauvegardes, monitoring, portail captif cloud, paiement par carte, flotte importante | Prix en USD, approche cloud internationale ; TicketPro peut gagner sur FCFA, paiements nigériens, desktop local et accompagnement régional |
| WIFIZONE MANAGER / MikManager | Gestion RADIUS mobile, tickets ou numéro WhatsApp | Paiement à l’usage, Mobile Money, RADIUS, revendeurs, applications mobiles, portail captif | TicketPro offre une maîtrise locale et un parcours Windows ; il lui manque encore la vente automatique au client final et le portail personnalisable |
| Mikrogestion | SaaS francophone de gestion de WiFi Zones MikroTik | Tickets, multi-routeurs, analytique, revenus et historique en temps réel | Positionnement public proche mais générique ; TicketPro doit publier ses preuves techniques et ses fonctions réellement distinctives |
| Powerlynx | Plateforme cloud mondiale de gestion et monétisation de Hotspots | Multi-constructeurs, RADIUS, nombreux paiements internationaux, portail personnalisable, marketing, SMS, marque blanche et déploiements à grande échelle | Concurrent mondial beaucoup plus large ; TicketPro peut gagner chez les petites et moyennes flottes MikroTik qui préfèrent Windows, les données locales et un prix par routeur |
| HotspotSystem | Plateforme internationale de portail captif, vouchers et paiement | Offre gratuite, paiement à l’usage, vouchers, SMS, Stripe et marque blanche | Plus orienté portail captif générique ; TicketPro reste plus proche de l’administration opérationnelle RouterOS et de l’usage desktop |
| Antamedia HotSpot | Logiciel Windows historique de gestion Hotspot | Licence perpétuelle, plans Internet, comptes, impression, hôtels et exploitation locale | Concurrent naturel sur Windows ; TicketPro doit insister sur le SaaS, les mises à jour, le VPN intégré, les organisations et la synchronisation cloud |
| IronWiFi | Cloud RADIUS et portail captif pour entreprises | Compatibilité multi-constructeurs, sécurité et conformité entreprise, authentification et marketing | Segment entreprise plus large et plus cher ; TicketPro reste spécialisé MikroTik et exploitation de WiFi Zones commerciales |

### 6.2 Concurrents adjacents

| Concurrent | Menace principale | Lecture stratégique |
|---|---|---|
| Mana Zone | Vente automatisée de tickets et paiement Mobile Money | Concurrent sur la monétisation automatique, moins directement sur l’administration Windows complète |
| Ticket WiFi Zone | Kits, installation, vente automatique et VPN séparé | Capte les débutants qui veulent une solution matérielle clé en main ; opportunité pour TicketPro de proposer partenaires/installateurs |
| MikroTik User Manager | RADIUS natif RouterOS | Puissant et officiel, mais plus technique et moins adapté à une exploitation commerciale simple |
| RADIUSdesk | Open source, RADIUS, vouchers et FUP | Très complet pour intégrateurs, mais plus complexe à installer et maintenir qu’une application métier Windows |
| WifiZone Pro, MiabeWifi, Mikrozone et autres nouveaux entrants | Concurrence francophone en croissance rapide | Nécessite une veille mensuelle sur prix, paiement, VPN, mobile, portail captif et automatisation |
| Splynx et plateformes de billing ISP | Facturation opérateur, RADIUS et processus ISP complets | Ciblent les WISP/FAI plus structurés ; TicketPro doit éviter de promettre un ERP ou un billing ISP complet tant que ces modules n’existent pas |
| Purple, Cloud4Wi, Spotipo et solutions Guest WiFi | Portails captifs, données visiteurs et marketing | Concurrents sur l’hôtellerie et les lieux publics, mais moins directement sur la gestion métier de vouchers MikroTik depuis Windows |

### 6.3 Matrice fonctionnelle synthétique

Légende : ✅ annoncé ou vérifié ; ◐ partiel, option séparée ou non documenté avec précision ; ❌ absent publiquement ; ? information non trouvée.

| Fonction | TicketPro | TikFlow | MikroTicket | Mikhmon | MKController | WIFIZONE | Mikrogestion |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gestion multi-routeurs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Application Windows | ✅ | ✅ | ✅ | ◐ web local | ◐ agent/web | ❌ mobile/web | ❌ web |
| Android ou iOS | ❌ | ✅ | ✅ | ◐ navigateur | ✅/◐ | ✅ | ◐ navigateur |
| Vouchers par lot | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PDF A4 | ✅ 40/page | ✅ A3/A4 | ✅ A4/A3 | ✅ | ✅ | ◐ | ◐ |
| Impression thermique | ✅ 58/80, validation matérielle à poursuivre | ? | ✅ | ✅ | ? | ? | ? |
| Suivi en temps réel | ✅ | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ |
| Accès distant | ✅ | ✅ | ✅ | ◐ à configurer | ✅ NATCloud | ✅ VPN/WireGuard | ✅ |
| VPN intégré sans client séparé | ✅ | ? | ? | ❌ | ◐ | ◐ | ? |
| Données locales sur le PC | ✅ | ? | ? | ✅ serveur local | ❌ cloud | ❌ cloud | ❌ cloud |
| Récupération après perte de PC | ✅ état métier/VPS | ? | ? | ❌ manuelle | ✅ sauvegardes | ? | ? |
| Équipes et permissions | ✅ | ✅ sous-comptes | ✅ | ◐ | ✅/◐ | ✅ revendeurs | ? |
| Multi-organisation et invitations | ✅ | ? | ? | ❌ | ◐ | ◐ | ? |
| Paiements locaux Niger | ✅ abonnement | ❌ | ? | ❌ | ❌ carte | ◐ Mobile Money | ? |
| Paiement du ticket sur portail captif | ❌ | ❌ | ? | ❌ | ✅ carte | ✅ | ? |
| Éditeur de portail captif | ❌ actuellement | ? | ✅ | ✅ modèles | ✅ | ✅ | ? |
| Cycle durée + validité distinct | ✅ | ? | ✅ annoncé | scripts communautaires | ✅ annoncé | ✅ annoncé | ✅/◐ |
| IP Binding, bypass et anti-partage | ✅ | ? | ? | ◐ RouterOS manuel | ? | ? | ? |

### 6.4 Benchmark tarifaire public

| Solution | Modèle public observé | Lecture |
|---|---|---|
| TicketPro | STARTER 5 000 FCFA/mois pour 1 routeur et 2 postes ; GROWTH 10 000 pour 5 routeurs ; PRO 20 000 pour 20 ; ULTRA 50 000 pour 150 sur le rendu public observé | Prix supérieur aux entrants low-cost ; doit être justifié par la sécurité intégrée, la robustesse, le support et la profondeur métier |
| TikFlow | Gratuit, puis environ 1 000 FCFA/mois pour 1 routeur, 3 000 pour 5, 8 000 pour 20 | Menace tarifaire directe très forte |
| MKController | Basic à partir de 3 USD/appareil/mois ; Advanced avec vouchers à partir de 15 USD/appareil/mois | TicketPro devient compétitif face à l’offre hotspot Advanced, surtout en FCFA |
| WIFIZONE / MikManager | 2 FCFA par jour de validité vendu ; modules premium à partir de 1 000 FCFA/mois | Modèle à l’usage séduisant pour petites zones et activités irrégulières |
| Mikhmon | Gratuit et open source | Le SEO TicketPro doit vendre le gain de temps, la sécurité, la maintenance et le support, pas seulement la génération de tickets |
| MikroTicket | Prix public complet non confirmé dans les sources consultées | Ne pas inventer de comparaison tarifaire |
| Mikrogestion | Abonnements annoncés, prix non clairement exposés dans les pages consultées | Opportunité pour TicketPro d’être plus transparent |

Conclusion tarifaire : une landing générique fait paraître TicketPro cher. Une landing riche en preuves rend le prix défendable. Il faut comparer le coût à des déplacements évités, à la réduction des tickets réutilisés, au contrôle des vendeurs et au temps économisé sur plusieurs sites.

## 7. Analyse SWOT

### Forces

- produit nettement plus profond que le contenu actuel de la landing ;
- accès distant sécurisé véritablement intégré au setup Windows ;
- fonctionnement local et distant ;
- modèle multi-routeurs, multi-postes et multi-organisation ;
- cycle de vie des vouchers conçu autour de RouterOS réel ;
- impressions professionnelles et préférences par WiFi Zone ;
- paiements et prix adaptés au Niger ;
- domaine officiel et infrastructure VPS maîtrisée ;
- tests automatisés importants dans le projet.

### Faiblesses

- site officiel techniquement cassé au-delà de la page d’accueil ;
- fonctionnalités publiques trop génériques par rapport au produit ;
- aucune preuve sociale forte : cas client, témoignage vérifiable, chiffres réels ou vidéo ;
- application Windows uniquement ;
- pas encore de paiement autonome du voucher sur le portail captif ;
- pas encore d’éditeur public de portail captif ;
- incohérence éditoriale sur les « postes illimités » alors que plusieurs offres ont une limite ;
- seulement deux guides SEO ;
- support officiel peu visible sur la landing ;
- absence de page de compatibilité RouterOS et de notes de version publiques.

### Opportunités

- résultats francophones encore fragmentés et souvent peu qualitatifs ;
- forte demande autour de « WiFi Zone », « MikroTik », « tickets WiFi », « Mikhmon » et « accès distant » ;
- création de contenus très précis sur les problèmes de validité et d’expiration ;
- recherche locale Niger, Niamey, FCFA, Nita et Amanata ;
- partenariats avec techniciens, vendeurs de routeurs, installateurs Starlink et intégrateurs ;
- pages comparatives honnêtes contre Mikhmon, MikroTicket et solutions cloud ;
- démonstrations vidéo sur Hyper-V puis sur routeur réel ;
- publication d’un centre d’aide qui peut devenir une référence RouterOS en français.

### Menaces

- concurrents gratuits ou beaucoup moins chers ;
- concurrents disponibles sur Android et iOS ;
- nouveaux SaaS francophones très rapides à copier les fonctions visibles ;
- bugs RouterOS pouvant affecter la confiance commerciale ;
- dépendance à Windows et à MikroTik ;
- confusion possible entre durée d’utilisation, validité et expiration ;
- promesses SEO excessives sur l’anti-partage ou la compatibilité matérielle.

## 8. Audit SEO actuel de la landing

### 8.1 Éléments déjà bien construits dans Astro

- titres et descriptions uniques sur les pages principales ;
- balises canonical ;
- Open Graph et Twitter Cards ;
- schémas `Organization`, `WebSite`, `SoftwareApplication` et `FAQPage` sur l’accueil ;
- sitemap programmatique ;
- robots.txt programmatique avec exclusion de `/admin` ;
- pages séparées pour fonctionnalités, tarifs, téléchargement, sécurité, support, FAQ et guides ;
- fil d’Ariane visible ;
- structure sémantique globalement claire ;
- CTA instrumentés avec des attributs analytiques ;
- tarifs récupérés depuis l’API pour éviter les prix obsolètes.

### 8.2 Problèmes P0 constatés sur le domaine officiel

Contrôle effectué le 13 août 2026 :

- `https://ticketpro-ne.com/` retourne 200 depuis l’infrastructure LWS ;
- `https://www.ticketpro-ne.com/` retourne également 200 avec le même contenu ;
- aucun des deux hôtes ne redirige vers l’autre ;
- `https://www.ticketpro-ne.com/fonctionnalites` retourne 404 ;
- la variante avec slash retourne également 404 ;
- `/tarifs`, `/telecharger`, `/faq`, `/securite`, `/support`, `/guides` et les pages légales retournent 404 ;
- `/sitemap.xml` retourne une page HTML 404 ;
- le `robots.txt` public est un fichier générique LWS et ne référence pas le sitemap TicketPro ;
- le DNS public observé pointe l’apex vers `83.229.19.76` et `www` est un CNAME vers l’apex ;
- le déploiement `ticketpro-landing.vercel.app` retourne bien 200 pour les pages internes, le sitemap et le robots.txt ;
- une recherche `site:ticketpro-ne.com` n’a retourné aucun résultat dans le relevé Firecrawl.

Impact : Google ne peut pas explorer correctement le site, les liens internes de l’accueil mènent à des 404 et la duplication apex/www dilue les signaux.

Correction recommandée :

1. rattacher correctement `ticketpro-ne.com` et `www.ticketpro-ne.com` au projet Vercel ;
2. choisir `https://www.ticketpro-ne.com` comme hôte canonique ;
3. rediriger l’apex vers `www` en 301 ou 308 ;
4. vérifier toutes les routes avec un crawl HTTP ;
5. vérifier que `/robots.txt` et `/sitemap.xml` proviennent bien d’Astro ;
6. ajouter le domaine à Google Search Console et Bing Webmaster Tools ;
7. soumettre `/sitemap.xml` après correction ;
8. conserver les anciens domaines avec des redirections 301 vers les nouvelles pages équivalentes pendant plusieurs mois.

### 8.3 Problèmes éditoriaux

- La landing dit encore à plusieurs endroits « postes Windows illimités », alors que STARTER, GROWTH, PRO et ULTRA ont des limites publiques. Seule l’offre Entreprise est illimitée dans le relevé actuel.
- La page Fonctionnalités résume le produit en quatre cartes très générales et omet la majorité des fonctions différenciantes.
- La page Sécurité reste vague et ne dit pas clairement que le client WireGuard séparé n’est pas nécessaire.
- La page Support indique que les coordonnées ne sont pas publiées, ce qui réduit la confiance. Publier au minimum un email officiel sur le domaine, les horaires et le canal WhatsApp/support si l’équipe souhaite les assumer publiquement.
- Les deux guides ne suffisent pas pour construire une autorité thématique.
- Les guides utilisent `og:type=article`, mais ne possèdent pas encore un schéma `Article` complet avec auteur, date de publication, date de modification et image.
- Les tarifs sont rendus côté client. Google peut exécuter JavaScript, mais une version SSR ou un instantané HTML indexable serait plus robuste.
- Les avantages techniques ne sont pas soutenus par des captures réelles, vidéos, schémas, données de test ou études de cas.

### 8.4 Améliorations techniques P1/P2

- ajouter `lastmod` au sitemap ;
- ajouter un schéma `BreadcrumbList` sur les pages internes ;
- enrichir `SoftwareApplication` avec `softwareVersion`, `downloadUrl`, `featureList` et `offers` sans inventer de note client ;
- enrichir `Organization` avec `legalName`, `contactPoint`, zone desservie et liens sociaux officiels ;
- ajouter un schéma `Article` aux guides ;
- publier une page `/compatibilite-mikrotik-routeros` ;
- publier une page `/notes-de-version` ou `/changelog` ;
- ajouter une date de mise à jour visible sur les guides ;
- optimiser les images réelles en WebP/AVIF avec largeur, hauteur et texte alternatif descriptif ;
- mesurer les Core Web Vitals après correction DNS ;
- tester les erreurs 404, les redirections et les liens à chaque déploiement ;
- créer une vraie page de contact plutôt que masquer entièrement le canal d’assistance ;
- garder les pages d’administration, d’invitation et de réinitialisation en `noindex`.

## 9. Analyse des mots-clés

### 9.1 Cluster principal — intention commerciale forte

| Mot-clé cible | Intention | Page recommandée |
|---|---|---|
| logiciel gestion hotspot MikroTik | Acheter/comparer | Accueil |
| logiciel WiFi Zone | Acheter/comparer | Accueil ou `/solutions/wifi-zone` |
| logiciel tickets WiFi MikroTik | Acheter/comparer | `/fonctionnalites/generation-tickets-wifi` |
| application gestion MikroTik Windows | Télécharger | `/telecharger` |
| générateur voucher MikroTik | Essayer un outil | `/fonctionnalites/generation-tickets-wifi` |
| gestion multi routeurs MikroTik | Comparer | `/fonctionnalites/gestion-multi-routeurs` |
| accès distant MikroTik sécurisé | Résoudre/acheter | `/fonctionnalites/acces-distant-mikrotik` |
| logiciel hotspot WiFi Niger | Local commercial | Accueil ou `/niger` si contenu réellement distinct |
| application WiFi Zone Niger | Local commercial | Accueil |
| logiciel MikroTik Afrique | Commercial régional | Page marché Afrique francophone |

### 9.2 Cluster vouchers et impression

- créer tickets WiFi MikroTik ;
- générer vouchers MikroTik en lot ;
- imprimer tickets WiFi A4 ;
- 40 tickets WiFi par page A4 ;
- impression ticket WiFi thermique 58 mm ;
- impression voucher MikroTik 80 mm ;
- ticket WiFi avec QR code ;
- ticket WiFi login mot de passe ;
- personnaliser ticket WiFi ;
- suivre ticket WiFi utilisé ou expiré.

### 9.3 Cluster durée, validité et sécurité commerciale

- différence durée et validité voucher MikroTik ;
- ticket MikroTik expire après première connexion ;
- supprimer automatiquement utilisateur Hotspot expiré ;
- empêcher réutilisation ticket WiFi consommé ;
- limit uptime MikroTik voucher ;
- session timeout MikroTik Hotspot ;
- MAC cookie MikroTik Hotspot ;
- déconnecter utilisateur Hotspot MikroTik ;
- archiver tickets WiFi expirés.

Ce cluster est particulièrement stratégique : il répond à une douleur métier forte et permet à TicketPro de démontrer son expertise plutôt que de seulement annoncer une liste de fonctions.

### 9.4 Cluster accès distant et WireGuard

- accéder à MikroTik à distance ;
- gérer MikroTik derrière CGNAT ;
- accès Winbox à distance sans IP publique ;
- VPN WireGuard MikroTik ;
- connexion sécurisée MikroTik Windows ;
- administrer plusieurs MikroTik à distance ;
- accéder routeur MikroTik depuis une autre ville ;
- MikroTik WireGuard Niger ;
- logiciel accès distant RouterOS.

### 9.5 Cluster exploitation et équipe

- suivre clients connectés MikroTik en temps réel ;
- rapport vente tickets WiFi ;
- gestion vendeurs WiFi Zone ;
- équipe gestion hotspot MikroTik ;
- permissions utilisateur MikroTik ;
- gérer plusieurs WiFi Zones ;
- tableau de bord Hotspot MikroTik ;
- historique tickets WiFi ;
- sauvegarde configuration WiFi Zone.

### 9.6 Cluster cas d’usage

- logiciel WiFi Zone cybercafé ;
- gestion WiFi hôtel MikroTik ;
- tickets WiFi école ou université ;
- vendre connexion WiFi avec MikroTik ;
- gérer WiFi restaurant ;
- hotspot MikroTik Starlink ;
- logiciel opérateur WiFi Afrique ;
- gestion réseau WiFi multi-sites.

### 9.7 Requêtes comparatives

- alternative à Mikhmon ;
- TicketPro vs Mikhmon ;
- alternative à MikroTicket ;
- TicketPro vs MikroTicket ;
- meilleur logiciel Hotspot MikroTik ;
- Mikhmon Windows alternative ;
- logiciel voucher MikroTik avec accès distant ;
- logiciel WiFi Zone avec rapports de vente.

Les pages comparatives doivent rester factuelles, datées, sourcées et respectueuses des marques. Ajouter une mention précisant que TicketPro n’est ni affilié ni approuvé par MikroTik, Mikhmon ou les autres concurrents cités.

### 9.8 Mots-clés à ne pas cibler avec une promesse trompeuse

- « paiement automatique ticket WiFi » tant que le client final ne peut pas acheter directement sur le portail ;
- « application Android TicketPro » tant qu’elle n’existe pas ;
- « portail captif personnalisable » tant que l’éditeur n’est pas livré ;
- « compatible tous routeurs MikroTik » ;
- « bloque totalement le partage de connexion » ;
- « VPN gratuit » ;
- « logiciel gratuit ».

## 10. Architecture éditoriale recommandée

### Niveau 1 — pages de conversion

- `/` — logiciel de gestion Hotspot MikroTik ;
- `/fonctionnalites` — vue complète avec liens vers les fonctions détaillées ;
- `/tarifs` — offres, limites, économies annuelles et FAQ tarifaire ;
- `/telecharger` — version, compatibilité, taille, SHA-256, notes de version et installation ;
- `/securite` — WireGuard intégré, isolation, clés, accès RouterOS et bonnes pratiques ;
- `/support` — contact officiel, horaires et parcours de diagnostic.

### Niveau 2 — pages fonctionnalités

- `/fonctionnalites/generation-tickets-wifi` ;
- `/fonctionnalites/impression-vouchers-mikrotik` ;
- `/fonctionnalites/clients-connectes-temps-reel` ;
- `/fonctionnalites/rapports-ventes-wifi` ;
- `/fonctionnalites/acces-distant-mikrotik` ;
- `/fonctionnalites/gestion-multi-routeurs` ;
- `/fonctionnalites/equipe-permissions` ;
- `/fonctionnalites/sauvegarde-restauration-routeurs` ;
- `/fonctionnalites/ip-binding-bypass`.

### Niveau 3 — solutions par métier

- `/solutions/wifi-zone` ;
- `/solutions/cybercafe` ;
- `/solutions/hotel-restaurant` ;
- `/solutions/ecole-universite` ;
- `/solutions/technicien-mikrotik` ;
- `/solutions/entreprise-multi-sites`.

### Niveau 4 — guides et comparatifs

- `/guides/duree-utilisation-validite-ticket-mikrotik` ;
- `/guides/creer-vouchers-mikrotik` ;
- `/guides/imprimer-40-tickets-wifi-a4` ;
- `/guides/acces-mikrotik-distance-sans-ip-publique` ;
- `/guides/configurer-mac-cookie-hotspot-mikrotik` ;
- `/guides/supprimer-ticket-expire-mikrotik` ;
- `/guides/gerer-plusieurs-wifi-zones` ;
- `/comparatifs/ticketpro-vs-mikhmon` ;
- `/comparatifs/alternative-mikroticket` ;
- `/comparatifs/logiciels-hotspot-mikrotik`.

## 11. Recommandations de contenu pour l’accueil

### Title recommandé

`TicketPro — Logiciel de gestion Hotspot MikroTik et tickets WiFi`

### Meta description recommandée

`Gérez vos routeurs MikroTik, vouchers, clients et ventes depuis Windows. Accès distant sécurisé, équipes, rapports et impression de tickets WiFi.`

### H1 recommandé

`Gérez vos Hotspots MikroTik, vos tickets WiFi et vos routeurs à distance.`

### Sous-titre recommandé

`TicketPro est l’application Windows conçue pour les WiFi Zones : créez et imprimez vos vouchers, suivez les clients en direct, travaillez en équipe et administrez vos MikroTik sur place ou à distance.`

### Sections recommandées sur l’accueil

1. promesse et capture réelle du dashboard ;
2. preuves chiffrées du produit : 40 tickets A4, plusieurs routeurs, postes selon offre ;
3. génération et cycle de vie des vouchers ;
4. connexion distante intégrée sans client WireGuard séparé ;
5. supervision en direct et rapports ;
6. équipe, rôles et organisations ;
7. fonctionnement en trois étapes ;
8. tarifs dynamiques ;
9. cas client pilote réel ;
10. FAQ technique et commerciale ;
11. CTA téléchargement Windows.

## 12. Calendrier éditorial prioritaire sur 12 semaines

### Semaines 1 à 2 — remise en état et conversion

- corriger DNS, routes, sitemap et robots ;
- corriger les mentions « postes illimités » ;
- enrichir Accueil, Fonctionnalités, Sécurité et Téléchargement ;
- connecter Google Search Console, Bing Webmaster Tools et les conversions ;
- publier une page Compatibilité et une page Notes de version.

### Semaines 3 à 6 — autorité sur les vouchers

- durée d’utilisation vs validité ;
- générer des vouchers MikroTik ;
- imprimer 40 tickets sur A4 ;
- MAC-cookie et reconnexion automatique ;
- supprimer proprement un voucher expiré ;
- suivre les utilisateurs connectés en temps réel.

### Semaines 7 à 9 — autorité sur l’accès distant

- gérer un MikroTik à distance sans IP publique ;
- WireGuard pour MikroTik expliqué simplement ;
- administrer plusieurs routeurs depuis Windows ;
- sécurité RouterOS API, Winbox et ports exposés ;
- gérer plusieurs organisations et techniciens.

### Semaines 10 à 12 — pages commerciales et comparatives

- TicketPro vs Mikhmon ;
- alternative à MikroTicket ;
- logiciels de gestion Hotspot MikroTik comparés ;
- solution WiFi Zone pour cybercafé ;
- solution WiFi pour hôtel et restaurant ;
- étude de cas d’un pilote TicketPro avec chiffres autorisés.

Rythme conseillé ensuite : deux contenus utiles par mois, une note de version à chaque mise à jour et un cas client par trimestre.

## 13. Stratégie de liens et d’autorité

### Liens internes

- chaque guide doit pointer vers une fonction et un CTA de téléchargement ;
- chaque page fonction doit pointer vers un guide pratique ;
- les pages métiers doivent pointer vers tarifs, sécurité et témoignages ;
- la page Tarifs doit expliquer les limites de routeurs et de postes ;
- la page Téléchargement doit pointer vers compatibilité, sécurité et notes de version.

### Backlinks prioritaires

- annuaires et communautés MikroTik francophones ;
- revendeurs et installateurs MikroTik au Niger et en Afrique de l’Ouest ;
- intégrateurs Starlink et WiFi Zone ;
- blogs de cybersécurité et réseaux locaux ;
- tutoriels YouTube avec lien vers le guide correspondant ;
- associations, hôtels, écoles ou cybercafés clients avec accord ;
- profils de l’entreprise et des fondateurs sur des réseaux professionnels.

Éviter l’achat massif de liens, les annuaires sans rapport et les textes d’ancrage artificiellement répétés.

## 14. Mesure SEO et commerciale

### Indicateurs SEO

- pages valides indexées ;
- impressions et clics par cluster ;
- positions moyennes sur les requêtes commerciales ;
- nombre de requêtes non-marque ;
- backlinks référents pertinents ;
- Core Web Vitals ;
- erreurs 404 et redirections ;
- pages découvertes mais non indexées.

### Indicateurs de conversion

- clics vers `/telecharger` ;
- téléchargements réels du setup ;
- clics sur tarifs ;
- passage site → création de compte dans l’application ;
- essai → abonnement payé ;
- coût d’acquisition par canal ;
- taux de renouvellement ;
- demandes de support avant achat ;
- conversion par page et par mot-clé.

### Événements recommandés

- `view_pricing` ;
- `download_intent` ;
- `download_click` ;
- `support_click` ;
- `comparison_cta_click` ;
- `guide_to_download_click` ;
- `pricing_period_change` ;
- `plan_card_click`.

## 15. Priorités d’exécution

| Priorité | Action | Impact | Effort estimatif |
|---|---|---:|---:|
| P0 | Corriger le DNS et servir tout le projet Astro depuis Vercel | Critique | Faible à moyen |
| P0 | Restaurer pages internes, sitemap et robots officiels | Critique | Faible |
| P0 | Rediriger apex vers `www` | Très fort | Faible |
| P0 | Vérifier toutes les URLs avec un crawl et supprimer les 404 internes | Très fort | Faible |
| P1 | Réécrire l’accueil autour des vraies fonctions différenciantes | Très fort | Moyen |
| P1 | Corriger la contradiction sur les limites de postes | Très fort | Faible |
| P1 | Enrichir Fonctionnalités, Sécurité et Téléchargement | Fort | Moyen |
| P1 | Publier Compatibilité, Changelog et contact officiel | Fort | Moyen |
| P1 | Configurer Search Console, sitemap et conversions | Fort | Faible |
| P2 | Créer les pages vouchers, accès distant et multi-routeurs | Fort | Moyen |
| P2 | Publier des captures réelles, vidéos et preuves terrain | Fort | Moyen |
| P2 | Publier les comparatifs Mikhmon, MikroTicket et logiciels Hotspot | Fort | Moyen |
| P3 | Développer les pages métiers et locales | Moyen | Moyen |
| P3 | Mettre en place une veille concurrentielle mensuelle | Moyen | Faible |

## 16. Sources concurrentielles principales

- TicketPro officiel : https://www.ticketpro-ne.com/
- Déploiement TicketPro Vercel contrôlé : https://ticketpro-landing.vercel.app/
- TikFlow : https://tikflowapp.com/
- MikroTicket : https://www.mikroticket.com/
- MikroTicket Google Play : https://play.google.com/store/apps/details?id=com.mikroisp.apps.android.mikrotik.hotspot.voucher.ticket.mikroticket
- Mikhmon V3 : https://github.com/laksa19/mikhmonv3
- MKController tarifs : https://mkcontroller.com/mkcontroller_en_tabela/
- MKController vouchers : https://mkcontroller.com/hotspot-vouchers/
- WIFIZONE MANAGER : https://wifizone.pro/
- Mikrogestion : https://www.mikrogestion.com/
- Mana Zone : https://www.mana-zone.app/
- Ticket WiFi Zone : https://ticketwifizone.com/
- RADIUSdesk : https://www.radiusdesk.com/wiki24/radius/features
- Powerlynx : https://powerlynx.app/features/
- HotspotSystem : https://usa.hotspotsystem.com/pricing
- IronWiFi : https://www.ironwifi.com/captive-portal
- Antamedia HotSpot : https://www.antamedia.com/hotspot/
- Documentation officielle MikroTik Hotspot : https://help.mikrotik.com/docs/spaces/ROS/pages/56459266/HotSpot%2B-%2BCaptive%2Bportal
- Documentation officielle MikroTik User Manager : https://help.mikrotik.com/docs/spaces/ROS/pages/2555940/User%2BManager
- Google Search Central, sites multilingues : https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites
- Google Search Central, `hreflang` : https://developers.google.com/search/docs/specialty/international/localized-versions
- Stripe, disponibilité mondiale : https://stripe.com/global
- Stripe, devises prises en charge : https://docs.stripe.com/currencies
- Stripe, prix localisés : https://docs.stripe.com/payments/currencies/localize-prices

## 17. Prompt prêt à transmettre à un outil SEO

```text
Analyse le benchmark TicketPro ci-joint comme un consultant SEO SaaS B2B spécialisé dans les logiciels réseau, les Hotspots MikroTik et l’expansion internationale.

Objectif principal : augmenter les téléchargements qualifiés de l’application Windows TicketPro depuis https://www.ticketpro-ne.com.

Produit : logiciel de gestion de Hotspots MikroTik, WiFi Zones, vouchers, clients connectés, rapports, équipes et accès distant sécurisé intégré.

Marchés prioritaires : Niger, Afrique francophone, France, Belgique, Suisse romande, Québec et francophonie internationale. Préparer ensuite l’expansion en anglais, portugais et espagnol.

Je veux :
1. une recherche de mots-clés avec volumes, difficulté et intention au Niger, en Côte d’Ivoire, au Burkina Faso, au Mali, au Sénégal, au Bénin, au Togo, en Guinée, au Cameroun, en RDC, en France, en Belgique, en Suisse et au Canada francophone ;
2. une analyse SERP des dix premiers résultats pour chaque cluster principal ;
3. une comparaison détaillée avec TikFlow, MikroTicket, Mikhmon, MKController, WIFIZONE MANAGER, Mikrogestion, Powerlynx, HotspotSystem, Antamedia et IronWiFi ;
4. les content gaps de TicketPro ;
5. une architecture SEO avec une URL principale par intention ;
6. les titles, H1, metas et briefs de contenu des vingt premières pages ;
7. un plan de liens internes ;
8. un plan de backlinks réaliste pour l’Afrique francophone et la francophonie internationale ;
9. un calendrier éditorial de six mois ;
10. des KPI et objectifs à 30, 90 et 180 jours.

Contraintes :
- ne jamais inventer une fonctionnalité ;
- distinguer paiement de l’abonnement TicketPro et paiement d’un voucher par le client final ;
- ne pas promettre une compatibilité universelle MikroTik ;
- ne pas affirmer un blocage absolu du partage de connexion ;
- respecter les marques concurrentes ;
- ne pas créer plusieurs pages qui ciblent exactement la même intention ;
- privilégier les requêtes commerciales et les problèmes opérationnels concrets.
- distinguer les fonctionnalités actuelles des éléments de roadmap comme Stripe, les langues supplémentaires et le paiement des vouchers sur le portail captif.
```

## 18. Positionnement mondial recommandé

### 18.1 Une marque née au Niger, mais pas limitée au Niger

La bonne narration internationale n’est pas de masquer l’origine de TicketPro. Elle consiste à la transformer en preuve : une solution née sur le terrain, pensée pour les contraintes réelles des opérateurs MikroTik, capable de fonctionner avec des réseaux locaux, des connexions instables, des paiements régionaux et des équipes distribuées.

Le message mondial doit toutefois rester centré sur le problème universel :

> Manage MikroTik hotspots, vouchers, customers and remote access from one secure Windows application.

L’ordre des arguments doit changer selon le marché :

| Marché | Premier argument | Arguments secondaires |
|---|---|---|
| Niger | Gestion complète en FCFA et paiement local | Support de proximité, accès distant, tickets et rapports |
| Afrique francophone | Gestion professionnelle des WiFi Zones MikroTik | Multi-sites, équipes, accès distant et exploitation même avec une connectivité irrégulière |
| France, Belgique, Suisse, Canada | Administration MikroTik spécialisée et sécurisée | Windows, conformité, équipes, historique, support et transparence |
| Afrique anglophone | MikroTik hotspot operations and voucher monetization | Multi-site, remote access, teams, local payment roadmap |
| Marché mondial | MikroTik-first Windows operations platform | Embedded secure access, local data, cloud recovery and multi-organization workflows |

### 18.2 Nom de marque et risque de confusion

Une recherche internationale montre plusieurs plateformes de billetterie événementielle déjà nommées TicketPro ou Ticketpro, notamment sur les domaines `.io`, `.com.mx`, `.co.za` et au Canada. Cela crée quatre risques :

- confusion dans Google entre tickets d’événements et vouchers WiFi ;
- concurrence très forte sur le mot-clé de marque seul ;
- difficulté à acquérir certains domaines et profils sociaux ;
- risque juridique à évaluer avant un déploiement mondial important.

Mesures recommandées :

1. utiliser publiquement **TicketPro WiFi** comme nom SEO et descriptif ;
2. utiliser **TicketPro MikroTik Hotspot Manager** dans les stores, pages de téléchargement et communiqués ;
3. faire réaliser une recherche de disponibilité de marque dans les classes logicielles et télécommunications visées ;
4. vérifier la disponibilité d’un domaine international non ambigu avant toute migration, sans abandonner le domaine actuel tant qu’une décision juridique et SEO n’est pas prise ;
5. réserver les principaux profils sociaux cohérents avec `TicketPro WiFi`.

Cette recommandation ne constitue pas un avis juridique ni une affirmation qu’une marque particulière est disponible.

## 19. Stratégie géographique par vagues

### Vague 1 — Niger

- français ;
- prix en FCFA ;
- Nita, Amanata et Mobile Money via iPay ;
- support et témoignages locaux ;
- mots-clés Niger, Niamey, WiFi Zone, MikroTik et FCFA.

### Vague 2 — Afrique francophone

Pays à étudier en priorité : Mali, Burkina Faso, Côte d’Ivoire, Sénégal, Bénin, Togo, Guinée, Cameroun, RDC, Congo, Gabon, Tchad et Mauritanie.

La priorité réelle de chaque pays doit être décidée avec quatre données : volume de recherche, parc MikroTik, accessibilité des paiements et capacité de support. Il ne faut pas créer vingt pages pays presque identiques. Une page locale n’est justifiée que si elle contient des prix, paiements, partenaires, témoignages ou informations réellement propres au pays.

### Vague 3 — Francophonie internationale

- France ;
- Belgique francophone ;
- Suisse romande ;
- Luxembourg ;
- Québec et Canada francophone ;
- territoires et marchés francophones secondaires selon demande réelle.

Le contenu devra employer un vocabulaire plus universel : Hotspot, portail captif, vouchers ou codes d’accès, administration RouterOS, sites, établissements et techniciens. Le terme « WiFi Zone » reste utile en Afrique mais ne doit pas être l’unique catégorie utilisée en Europe et au Canada.

### Vague 4 — Multilingue mondial

Ordre recommandé après validation du marché francophone :

1. anglais pour Afrique anglophone et marché international ;
2. portugais pour Angola, Mozambique, Cap-Vert, Guinée-Bissau, Brésil et Portugal selon demande ;
3. espagnol pour Amérique latine et Espagne ;
4. autres langues uniquement après preuve de demande et capacité de support.

## 20. Architecture SEO internationale

### 20.1 Architecture recommandée

Le domaine actuel est un `.com`, donc techniquement utilisable à l’international malgré le suffixe `-ne` dans le nom. La structure suivante est recommandée :

```text
https://www.ticketpro-ne.com/          français international par défaut
https://www.ticketpro-ne.com/fr-ne/    variante Niger réellement localisée
https://www.ticketpro-ne.com/en/       anglais
https://www.ticketpro-ne.com/pt/       portugais
https://www.ticketpro-ne.com/es/       espagnol
```

La racine française doit devenir générique et ne plus avoir « au Niger » dans son title principal. La variante `/fr-ne/` peut conserver les éléments Niger, FCFA et iPay.

Ne pas créer immédiatement `/fr-fr/`, `/fr-be/`, `/fr-ch/` et `/fr-ca/` avec une simple copie. Ces variantes deviennent pertinentes seulement lorsque les offres, devises, taxes, moyens de paiement, preuves ou textes diffèrent réellement.

### 20.2 Règles techniques

- une URL distincte par langue ;
- une seule langue visible par page ;
- balises `hreflang` réciproques entre chaque variante ;
- `fr` pour le français générique, `fr-NE` pour le Niger, puis `en`, `pt` et `es` ;
- une URL `x-default` pour la version ou le sélecteur par défaut ;
- canonical auto-référent sur chaque vraie traduction ;
- sélecteur de langue avec liens HTML explorables ;
- aucune redirection SEO forcée selon l’adresse IP ou la langue du navigateur ;
- possibilité de suggérer la langue ou le pays, mais laisser l’utilisateur choisir ;
- sitemap incluant les variantes ou annotations `hreflang` dans le HTML ;
- traduction des titles, metas, navigation, contenus, données structurées et textes alternatifs ;
- devises et langues séparées : un francophone peut vouloir payer en EUR, CAD, CHF ou XOF.

Google recommande des URLs différentes pour chaque langue et déconseille de dépendre uniquement de cookies, d’`Accept-Language` ou de redirections géographiques pour exposer les variantes aux moteurs.

## 21. Prix, devises et paiements internationaux

### 21.1 Principe fonctionnel

La source de vérité doit rester le catalogue TicketPro côté backend. Un plan commercial doit pouvoir posséder plusieurs prix sans dupliquer sa capacité fonctionnelle :

```text
offer: PRO
router_limit: 20
device_limit: 10

prices:
  - region: NE
    currency: XOF
    provider: IPAY
    monthly_amount: ...

  - region: GLOBAL
    currency: EUR
    provider: STRIPE
    monthly_amount: ...

  - region: CA
    currency: CAD
    provider: STRIPE
    monthly_amount: ...
```

Le prix, la devise, le fournisseur, la périodicité, les taxes et les identifiants externes Stripe doivent être configurés côté serveur. L’application ne doit jamais calculer elle-même un prix d’abonnement à partir d’un taux de change non contrôlé.

### 21.2 Rôle d’iPay et de Stripe

- iPay reste le canal prioritaire pour les paiements nigériens ;
- Stripe devient le canal carte et paiements internationaux là où le compte marchand et les méthodes sont éligibles ;
- le backend choisit le fournisseur selon le pays de facturation, la devise et la configuration du plan ;
- l’utilisateur doit voir clairement le montant final, la devise et la périodicité avant paiement ;
- la validation de l’abonnement doit rester déclenchée exclusivement par un webhook serveur vérifié et idempotent ;
- une commande Stripe ne doit jamais être considérée comme payée sur la seule redirection du navigateur.

### 21.3 Point de vigilance sur l’éligibilité Stripe

Au 13 août 2026, la page officielle de disponibilité mondiale de Stripe ne liste pas le Niger parmi les pays où une entreprise locale peut directement ouvrir un compte Stripe standard. Stripe indique qu’une entreprise située dans une région prise en charge peut vendre à des clients partout dans le monde. Avant de développer l’intégration de production, TicketPro doit donc confirmer l’entité légale qui sera titulaire du compte, sa banque, son pays d’établissement et les conditions contractuelles applicables.

Il ne faut ni déclarer une fausse implantation ni utiliser une structure étrangère sans validation juridique, fiscale et bancaire.

### 21.4 Devises recommandées

- XOF pour Niger et UEMOA lorsque le fournisseur l’accepte ;
- EUR pour zone euro ;
- CAD pour Canada ;
- CHF pour Suisse ;
- USD comme devise internationale de secours ;
- GBP uniquement si le Royaume-Uni devient un marché actif.

Stripe annonce la prise en charge de plus de 135 devises de présentation et propose des mécanismes de prix localisés. Deux stratégies sont possibles :

1. **price books manuels** : prix psychologiques et marges contrôlées par marché ;
2. **Adaptive Pricing** : conversion automatique proposée par Stripe dans les pays pris en charge.

Pour TicketPro, les price books manuels sont préférables au lancement international. Adaptive Pricing peut ensuite être testé sur les marchés secondaires, car les conversions et frais peuvent modifier le prix vu par le client.

### 21.5 Fiscalité et conformité

Avant de vendre largement en Europe, au Canada ou ailleurs, préparer :

- pays et adresse de facturation ;
- factures avec devise et taxes ;
- traitement B2B/B2C ;
- numéros fiscaux lorsque nécessaires ;
- règles de TVA, GST ou taxes sur les services numériques ;
- politique de remboursement et résiliation ;
- conditions d’abonnement et renouvellement ;
- confidentialité, cookies, sous-traitants et transferts de données ;
- consentement marketing séparé de l’usage du service.

Stripe Tax peut aider au calcul, mais ne remplace ni les inscriptions fiscales nécessaires ni un avis professionnel adapté à l’entité TicketPro.

## 22. Benchmark mondial complémentaire

| Solution mondiale | Modèle | Avantage majeur | Réponse stratégique TicketPro |
|---|---|---|---|
| Powerlynx | Cloud RADIUS, monétisation et paiement multi-pays | Paiements internationaux, multi-constructeurs, marketing, marque blanche et grande échelle | Ne pas l’affronter immédiatement sur tout le Guest WiFi ; dominer d’abord le workflow Windows MikroTik pour petites et moyennes flottes |
| HotspotSystem | Portail captif cloud, vouchers, SMS et paiements | Entrée gratuite et vaste couverture internationale | Mettre en avant la profondeur RouterOS, le suivi local et le VPN Windows intégré |
| Antamedia | Logiciel Windows Hotspot historique | Licence locale et maturité Windows | Mettre en avant SaaS moderne, mises à jour, équipes, multi-organisation et récupération cloud |
| MKController | Gestion cloud MikroTik et NATCloud | Administration de flotte, sauvegardes, accès distant et vouchers | TicketPro doit publier ses preuves de fiabilité, automatiser les sauvegardes et garder un tarif accessible en FCFA |
| IronWiFi | Cloud RADIUS et portail captif entreprise | Sécurité, conformité et compatibilité multi-constructeurs | Cibler MikroTik et l’exploitation commerciale plutôt que le Guest WiFi marketing généraliste |
| Purple / Cloud4Wi | Guest WiFi entreprise et marketing | Analytique visiteurs, CRM et campagnes | Segment différent ; ne devient prioritaire que si TicketPro développe le portail captif et le marketing |
| Splynx | Billing ISP/WISP complet | Facturation opérateur, CRM et réseau | Éviter le message « billing ISP complet » ; rester centré sur Hotspot MikroTik jusqu’à livraison de modules équivalents |

À l’échelle mondiale, le concurrent le plus dangereux n’est pas nécessairement celui qui reproduit chaque écran. C’est celui qui simplifie le mieux l’un de ces résultats : vendre le WiFi, connecter un routeur sans intervention, administrer une flotte ou encaisser dans la devise du client.

## 23. Mots-clés internationaux à préparer

### Français international

- logiciel de gestion Hotspot MikroTik ;
- gestion portail captif MikroTik ;
- logiciel vouchers WiFi ;
- administration RouterOS à distance ;
- logiciel WiFi payant pour hôtel ;
- gestion WiFi invités entreprise ;
- solution MikroTik multi-sites ;
- vendre accès Internet par voucher ;
- logiciel de supervision MikroTik Windows.

### Anglais

- MikroTik hotspot management software ;
- MikroTik voucher generator for Windows ;
- WiFi hotspot billing software ;
- manage MikroTik routers remotely ;
- MikroTik remote access without public IP ;
- MikroTik voucher printing software ;
- multi-site MikroTik management ;
- WiFi zone management software ;
- hotspot user management and reports ;
- MikroTik hotspot software for hotels.

### Portugais

- software de gestão hotspot MikroTik ;
- gerador de vouchers MikroTik ;
- gestão de zona WiFi ;
- acesso remoto MikroTik ;
- vender internet por vouchers.

### Espagnol

- software de gestión hotspot MikroTik ;
- generador de vouchers MikroTik ;
- administrar MikroTik remotamente ;
- software para vender WiFi ;
- gestión de usuarios hotspot MikroTik.

Ces traductions sont des graines de recherche, pas une validation de volume. Les mots-clés finaux doivent être vérifiés dans chaque pays et reformulés par un locuteur maîtrisant le vocabulaire réseau local.

## 24. Feuille de route internationale

### Phase A — fondation immédiatement

- corriger le domaine officiel et l’indexabilité ;
- rendre l’accueil français générique ;
- créer la variante Niger ;
- utiliser « TicketPro WiFi » dans les métadonnées internationales ;
- rendre le catalogue backend compatible avec plusieurs devises et fournisseurs ;
- conserver iPay comme fournisseur opérationnel actuel ;
- préparer les champs langue, pays, devise et fuseau horaire dans le compte.

### Phase B — francophonie africaine

- valider trois à cinq pays selon demande réelle ;
- créer des contenus et partenaires locaux ;
- intégrer les paiements réellement disponibles par pays ;
- publier des études de cas africaines ;
- organiser un support tenant compte des fuseaux et canaux locaux.

### Phase C — Stripe et francophonie internationale

- confirmer l’éligibilité juridique et bancaire du compte Stripe ;
- intégrer Stripe Checkout ou Billing côté backend ;
- construire les price books EUR, CAD, CHF et USD ;
- sécuriser webhooks, idempotence, remboursements et litiges ;
- traiter TVA et facturation ;
- localiser les pages pour France, Belgique, Suisse et Canada seulement lorsque l’offre est exploitable dans ces pays.

### Phase D — anglais

- traduire le site, l’application, les emails, l’installateur et la documentation ;
- ne pas limiter la traduction à la landing ;
- ouvrir un support anglais ;
- publier des contenus anglais originaux ;
- cibler d’abord les marchés MikroTik où le paiement et le support sont réellement possibles.

### Phase E — portugais et espagnol

- lancer une langue à la fois ;
- vérifier la demande avec Search Console, campagnes tests, partenaires et inscriptions ;
- traduire les flux de paiement, erreurs RouterOS, emails et documents légaux ;
- ajouter les moyens de paiement régionaux lorsque le volume le justifie.

## 25. Conclusion

TicketPro possède une base produit capable de soutenir un positionnement premium régional puis international. Son problème SEO actuel n’est pas un manque de fonctionnalités, mais un écart très important entre la profondeur réelle du logiciel et ce que la landing démontre publiquement.

L’ordre correct est : réparer le domaine et l’indexabilité, rendre la marque compréhensible mondialement avec « TicketPro WiFi », aligner le discours sur le produit et les limites réelles, publier les pages de fonctionnalités à forte intention, puis construire l’autorité avec des guides techniques et des preuves terrain. L’expansion se fera ensuite par marché et par langue, avec des prix, paiements, obligations et supports réellement adaptés plutôt qu’une simple traduction automatique.
