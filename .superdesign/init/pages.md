# TicketPro page dependency trees

## Startup / application root (target for splash)

Entry: `src/main.tsx`

- `src/main.tsx`
  - `src/App.tsx`
    - `src/services/database/AppDatabaseProvider.tsx`
    - `src/app/auth/AuthProvider.tsx`
    - `src/app/router/AppRouter.tsx`
      - `src/app/layouts/DesktopLayout.tsx`
      - `src/app/auth/ProtectedRoute.tsx`
      - all page entries listed in `routes.md`
  - `src/styles.css`
  - `src-tauri/icons/icon.png` (official transparent TicketPro logo)

## Login

Entry: `src/pages/auth/LoginPage.tsx`

- `LoginPage.tsx`
  - `src/app/auth/AuthProvider.tsx`
  - `src/services/auth/index.ts`
  - `src/shared/ui/Badge.tsx`
  - `src/shared/ui/Button.tsx`
  - `src/shared/ui/Card.tsx`
  - `src/shared/ui/PasswordField.tsx`
  - `src/shared/ui/StatusDot.tsx`
  - `src/styles.css`

## Global home

Entry: `src/pages/global/GlobalHomePage.tsx`

- `GlobalHomePage.tsx`
  - `src/app/auth/AuthProvider.tsx`
  - `src/services/database/*`
  - `src/shared/ui/*`
  - `src/pages/global/SecureConnectionPanel.tsx`
  - `src/styles.css`

## Routers

Entry: `src/pages/global/RoutersPage.tsx`

- `RoutersPage.tsx`
  - `src/app/auth/AuthProvider.tsx`
  - `src/pages/global/routerPageModel.ts`
  - `src/pages/global/subscriptionPageModel.ts`
  - `src/services/database/*`
  - `src/services/router/*`
  - `src/shared/ui/*`
  - `src/styles.css`

## Router home

Entry: `src/pages/router/RouterHomePage.tsx`

- `RouterHomePage.tsx`
  - `src/pages/router/routerHomeModel.ts`
  - `src/services/router/*`
  - `src/services/sync/*`
  - `src/shared/ui/*`
  - `src/styles.css`

## Ticket generation

Entry: `src/pages/router/TicketGenerationPage.tsx`

- `TicketGenerationPage.tsx`
  - `src/pages/router/ticketGenerationModel.ts`
  - `src/pages/router/TicketDisplaySettingsForm.tsx`
  - `src/services/router/*`
  - `src/services/tickets/*`
  - `src/services/pdf/*`
  - `src/shared/ui/*`
  - `src/styles.css`

## Plans, tickets, connected clients and monitoring

Each page uses its adjacent `*PageModel.ts`, router/database services, shared UI primitives and `src/styles.css`. The startup splash does not depend on these route-specific pages.
