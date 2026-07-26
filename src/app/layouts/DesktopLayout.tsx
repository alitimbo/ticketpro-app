import { ArrowLeft, LogOut, PanelLeftClose, PanelLeftOpen, Router, UserRound } from "lucide-react";
import { useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { getRouterNavigation, globalNavigation } from "../navigation/routes";
import { Button, SidebarItem, StatusDot } from "../../shared/ui";

type DesktopLayoutProps = {
  scope: "global" | "router";
};

export function DesktopLayout({ scope }: DesktopLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navigate = useNavigate();
  const { routerId = "routeur-demo" } = useParams();
  const { accountSession, logoutAccount, logoutProfile, session } = useAuth();
  const isRouterScope = scope === "router";
  const navigation = (isRouterScope ? getRouterNavigation(routerId, session?.internal_profile_role) : globalNavigation).filter(
    (item) => session && (item.permissions.length === 0 || item.permissions.some((permission) => session.permissions.includes(permission)))
  );

  const handleProfileLogout = () => {
    logoutProfile();
    navigate("/login", { replace: true });
  };

  const handleAccountLogout = () => {
    logoutAccount();
    navigate("/login", { replace: true });
  };

  const canSelectRouter = Boolean(session?.permissions.includes("global.routers.select"));

  return (
    <div className={sidebarCollapsed ? "app-shell app-shell--sidebar-collapsed" : "app-shell"}>
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="sidebar__brand">
          <div className="sidebar__mark">GH</div>
          <div className="sidebar__brand-copy">
            <p className="sidebar__title">TicketPro</p>
            <p className="sidebar__subtitle">
              {isRouterScope ? "Espace routeur" : "par Akicorp Solutions"}
            </p>
          </div>
          <button
            aria-label={sidebarCollapsed ? "Déployer la navigation" : "Réduire la navigation"}
            className="sidebar__toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            title={sidebarCollapsed ? "Déployer la navigation" : "Réduire la navigation"}
            type="button"
          >
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </button>
        </div>

        <nav className="sidebar__nav">
          {navigation.map((item) => (
            <SidebarItem
              end={item.end}
              icon={item.icon}
              key={item.to}
              label={item.label}
              to={item.to}
            />
          ))}
        </nav>

        <div className="sidebar__footer">
          <p className="sidebar__footer-label">
            {isRouterScope ? "Routeur sélectionné" : "Session"}
          </p>
          <p className="sidebar__footer-value">{isRouterScope ? routerId : session?.internal_profile_label}</p>
          <StatusDot
            label={session ? `Connecté : ${session.internal_profile_label}` : "Déconnecté"}
            status={session ? "active" : "offline"}
          />
          {accountSession ? <p className="sidebar__footer-label">{accountSession.companyLabel}</p> : null}
          <Button icon={UserRound} onClick={handleProfileLogout} variant="ghost">
            Quitter le profil
          </Button>
          <Button icon={LogOut} onClick={handleAccountLogout} variant="ghost">
            Déconnexion complète
          </Button>
        </div>
      </aside>

      <main className="content">
        {isRouterScope && canSelectRouter ? (
          <Button icon={ArrowLeft} onClick={() => navigate("/routeurs")} variant="ghost">
            Changer de routeur
          </Button>
        ) : !isRouterScope && canSelectRouter ? (
          <Button icon={Router} onClick={() => navigate("/routeurs/routeur-demo/maison")} variant="ghost">
            Ouvrir le routeur démo
          </Button>
        ) : null}

        <Outlet />
      </main>
    </div>
  );
}
