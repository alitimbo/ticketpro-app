# TicketPro

**TicketPro par Akicorp Solutions** est une application desktop Windows pour la gestion locale et distante de hotspots MikroTik.

- Version : `0.1.0`
- Package : `ticketpro`
- Identifiant Tauri : `solutions.akicorp.ticketpro`
- Éditeur : Akicorp Solutions
- Architecture : Tauri, React, TypeScript et SQLite

TicketPro fonctionne d'abord en local. Il ne comprend ni vente de tickets en ligne, ni Mobile Money, ni portail captif, ni éditeur HTML/CSS MikroTik.

## Installation

Prérequis de développement :

- Node.js et npm
- Rust stable avec Cargo
- cible Rust `x86_64-pc-windows-msvc`
- outils de compilation Microsoft C++ pour Windows

Installation des dépendances JavaScript :

```powershell
npm.cmd install
```

L'installateur Windows généré s'appelle :

```text
TicketPro-Setup-0.1.0-x64.exe
```

## Développement

Interface React seule :

```powershell
npm.cmd run dev
```

Application desktop Tauri :

```powershell
npm.cmd run tauri:dev
```

## Vérifications

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run type-check
cargo test --manifest-path src-tauri/Cargo.toml
npm.cmd run build
```

## Build Windows x64

Le build Windows cible exclusivement l'architecture x64 et génère un installateur NSIS :

```powershell
npm.cmd run tauri:build:windows
```

Le résultat est placé dans :

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/TicketPro-Setup-0.1.0-x64.exe
```

L'exécutable applicatif est `TicketPro.exe`. L'installateur est publié sous le nom Akicorp Solutions.

## Données existantes

Le fichier SQLite conserve volontairement son nom historique `hotspot-manager.sqlite`. Le renommer n'apporterait aucun bénéfice et risquerait de rendre une base existante inaccessible.

Au premier démarrage avec l'identifiant `solutions.akicorp.ticketpro`, TicketPro recherche l'ancien dossier Tauri `com.local.hotspotmanager` et copie, sans écrasement :

- la base SQLite et ses fichiers WAL/SHM ;
- le profil WebView local contenant les sessions et préférences locales.

Les données de l'ancienne installation restent également présentes dans leur dossier d'origine.

## Chemins locaux

Les nouveaux chemins proposés par défaut sont :

```text
C:\TicketPro\pdf
C:\TicketPro\exports
C:\TicketPro\backups
```

Les chemins déjà enregistrés dans les paramètres ne sont pas remplacés. Les PDF de tickets, rapports, exports et sauvegardes existants restent donc accessibles à leur emplacement actuel. Les logs applicatifs sont conservés dans SQLite.

## Authentification

TicketPro utilise deux niveaux distincts :

1. le compte principal de l'entreprise ;
2. le profil interne Admin, Opérateur, Agent ou Invité.

Le premier lancement, la connexion au compte principal, le choix du profil, les permissions et la persistance des sessions sont couverts par les tests automatisés.

## Base locale

Les migrations SQLite versionnées sont dans `src-tauri/migrations/`. La table `schema_migrations` empêche leur réexécution. Les tables, services, commandes RouterOS et modèles métier conservent leurs noms afin de préserver la compatibilité.

Toutes les actions routeur passent par `src/services/router/RouterService.ts` puis par un `RouterAdapter`. Aucun secret ne doit être écrit en clair dans la base ou les logs.

## Icône provisoire

Aucun nouvel emblème n'est créé par ce renommage. La configuration d'icône provisoire existante est conservée jusqu'à la fourniture des fichiers officiels TicketPro.
