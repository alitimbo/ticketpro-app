# Extractable TicketPro components

## DesktopLayout
- Source: `src/app/layouts/DesktopLayout.tsx`
- Category: layout
- Description: Desktop shell with branded sidebar, navigation, organization selector and content outlet.
- Extractable props: `scope` (`global` or `router`), `sidebarCollapsed`, `organizationName`, `sessionLabel`.
- Hardcoded: official TicketPro logo position, TicketPro/Akicorp labels, Lucide icon family, CSS classes.

## SidebarItem
- Source: `src/shared/ui/SidebarItem.tsx`
- Category: layout
- Description: Icon and label navigation item with active state.
- Extractable props: `label`, `to`, `active`.
- Hardcoded: icon sizing and CSS classes.

## AsyncStateCard
- Source: `src/shared/ui/AsyncStateCard.tsx`
- Category: basic
- Description: Unified loading/error feedback card.
- Extractable props: `status`, `title`, `description`, `loadingTitle`, `loadingDescription`.
- Hardcoded: LoaderCircle/AlertTriangle icons and animation pattern.

## StatusDot
- Source: `src/shared/ui/StatusDot.tsx`
- Category: basic
- Description: Small semantic state indicator with pulse for live states.
- Extractable props: `label`, `status`.
- Hardcoded: CSS class naming.

## SplashScreen (new target)
- Proposed source: `src/app/layouts/AppSplashScreen.tsx`
- Category: layout
- Description: Full-window startup state with official logo, TicketPro name, Akicorp signature and accessible loading status.
- Extractable props: `message`, `isExiting`.
- Hardcoded: official logo, brand gradient, product identity.
