# TicketPro routes

Router: React Router 7, configured in `src/app/router/AppRouter.tsx`, using `HashRouter` for Tauri desktop compatibility.

| Route | Component | Layout |
|---|---|---|
| `/premier-lancement` | `SaasFirstLaunchPage` | auth fullscreen |
| `/login` | `LoginPage` | auth fullscreen |
| `/inscription` | `SaasFirstLaunchPage` | auth fullscreen |
| `/mot-de-passe-oublie` | `PasswordResetPage` | auth fullscreen |
| `/` | `GlobalHomePage` | `DesktopLayout global` |
| `/mon-compte` | `AccountPage` | `DesktopLayout global` |
| `/routeurs` | `RoutersPage` | `DesktopLayout global` |
| `/equipe` | `TeamPage` | `DesktopLayout global` |
| `/vpn` | `VpnPage` | `DesktopLayout global` |
| `/abonnement` | `SubscriptionPage` | `DesktopLayout global` |
| `/factures` | `InvoicesPage` | `DesktopLayout global` |
| `/parametres` | `GlobalSettingsPage` | `DesktopLayout global` |
| `/routeurs/:routerId/maison` | `RouterHomePage` | `DesktopLayout router` |
| `/routeurs/:routerId/plans` | `PlansPage` | `DesktopLayout router` |
| `/routeurs/:routerId/tickets` | `TicketsPage` | `DesktopLayout router` |
| `/routeurs/:routerId/tickets/generation` | `TicketGenerationPage` | `DesktopLayout router` |
| `/routeurs/:routerId/fichiers` | `FilesPage` | `DesktopLayout router` |
| `/routeurs/:routerId/rapport` | `ReportPage` | `DesktopLayout router` |
| `/routeurs/:routerId/clients-connectes` | `ConnectedClientsPage` | `DesktopLayout router` |
| `/routeurs/:routerId/monitoring` | `MonitoringPage` | `DesktopLayout router` |
| `/routeurs/:routerId/logs` | `LogsPage` | `DesktopLayout router` |
| `/routeurs/:routerId/parametres` | `RouterSettingsPage` | `DesktopLayout router` |

The new startup splash is a pre-router application state. It belongs above `AppDatabaseProvider`/`AuthProvider` readiness and must not become a navigable route.
