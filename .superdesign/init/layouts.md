# TicketPro shared layouts

## `src/App.tsx`

Root provider composition.

```tsx
import { AppRouter } from "./app/router/AppRouter";
import { AuthProvider } from "./app/auth/AuthProvider";
import { AppDatabaseProvider } from "./services/database";

export function App() {
  return (
    <AppDatabaseProvider>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </AppDatabaseProvider>
  );
}
```

## `src/app/layouts/DesktopLayout.tsx`

Persistent desktop shell: white sidebar, real TicketPro logo, global/router navigation, active organization, session status and main content.

```tsx
import { ArrowLeft, Building2, ChevronDown, LoaderCircle, LogOut, PanelLeftClose, PanelLeftOpen, Router } from "lucide-react";
import { useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { getRouterNavigation, globalNavigation } from "../navigation/routes";
import { Button, SidebarItem, StatusDot } from "../../shared/ui";
import ticketProLogo from "../../../src-tauri/icons/icon.png";
import { AppUpdateNotice } from "./AppUpdateNotice";
import { WireGuardRecoveryBootstrap } from "./WireGuardRecoveryBootstrap";

type DesktopLayoutProps = { scope: "global" | "router" };

export function DesktopLayout({ scope }: DesktopLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navigate = useNavigate();
  const { routerId = "" } = useParams();
  const { accountSession, saasAccount, session } = useAuth();
  const isRouterScope = scope === "router";
  const navigation = (isRouterScope ? getRouterNavigation(routerId, session?.internal_profile_role) : globalNavigation).filter(
    (item) => session && (item.permissions.length === 0 || item.permissions.some((permission) => session.permissions.includes(permission)))
  );

  return (
    <div className={sidebarCollapsed ? "app-shell app-shell--sidebar-collapsed" : "app-shell"}>
      <WireGuardRecoveryBootstrap />
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="sidebar__brand">
          <img className="sidebar__mark" src={ticketProLogo} alt="" aria-hidden="true" />
          <div className="sidebar__brand-copy">
            <p className="sidebar__title">TicketPro</p>
            <p className="sidebar__subtitle">{isRouterScope ? "Espace routeur" : "par Akicorp Solutions"}</p>
          </div>
          <button aria-label="Réduire la navigation" className="sidebar__toggle" onClick={() => setSidebarCollapsed((current) => !current)} type="button">
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
        </div>
        <nav className="sidebar__nav">
          {navigation.map((item) => <SidebarItem end={item.end} icon={item.icon} key={item.to} label={item.label} to={item.to} />)}
        </nav>
        <div className="sidebar__footer">
          <p className="sidebar__footer-label">{isRouterScope ? "Routeur sélectionné" : "Session"}</p>
          <p className="sidebar__footer-value">{isRouterScope ? routerId : session?.internal_profile_label}</p>
          <StatusDot label={session ? `Connecté : ${session.internal_profile_label}` : "Déconnecté"} status={session ? "active" : "offline"} />
          {accountSession ? <p className="sidebar__footer-label">{accountSession.companyLabel}</p> : null}
          {saasAccount && saasAccount.organizations.length > 1 ? (
            <label className="organization-switcher">
              <span className="organization-switcher__label"><Building2 aria-hidden="true" />Organisation active</span>
              <span className="organization-switcher__control"><select value={saasAccount.user.membership_id}>{saasAccount.organizations.map((organization) => <option key={organization.membership_id} value={organization.membership_id}>{organization.organization_name}</option>)}</select><ChevronDown aria-hidden="true" /></span>
            </label>
          ) : null}
          <Button icon={LogOut} variant="ghost">Changer d'utilisateur</Button>
        </div>
      </aside>
      <main className="content">
        <AppUpdateNotice canManageUpdates={Boolean(session?.permissions.includes("global.settings"))} />
        {isRouterScope ? <Button icon={ArrowLeft} onClick={() => navigate("/routeurs")} variant="ghost">Changer de routeur</Button> : <Button icon={Router} onClick={() => navigate("/routeurs")} variant="ghost">Choisir un routeur</Button>}
        <Outlet />
      </main>
    </div>
  );
}
```

The production source also handles async organization switching, VPN reprovisioning, feedback and logout loaders. Those behaviors do not alter the shell's visual structure.
