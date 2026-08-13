import { ArrowLeft, Building2, ChevronDown, LoaderCircle, LogOut, PanelLeftClose, PanelLeftOpen, Router } from "lucide-react";
import { useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { getRouterNavigation, globalNavigation } from "../navigation/routes";
import { Button, SidebarItem, StatusDot } from "../../shared/ui";
import ticketProLogo from "../../../src-tauri/icons/icon.png";
import { AppUpdateNotice } from "./AppUpdateNotice";
import { WireGuardRecoveryBootstrap } from "./WireGuardRecoveryBootstrap";
import {
  disconnectEmbeddedVpn,
  EmbeddedVpnProvisioningService,
  getVpnProviderStatus,
  waitForEmbeddedVpnProvisioning
} from "../../services/vpn";

type DesktopLayoutProps = {
  scope: "global" | "router";
};

export function DesktopLayout({ scope }: DesktopLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false);
  const [organizationSwitchFeedback, setOrganizationSwitchFeedback] = useState<string | null>(null);
  const navigate = useNavigate();
  const { routerId = "" } = useParams();
  const { accountSession, logoutAccount, saasAccount, session, switchOrganization } = useAuth();
  const isRouterScope = scope === "router";
  const navigation = (isRouterScope ? getRouterNavigation(routerId, session?.internal_profile_role) : globalNavigation).filter(
    (item) => session && (item.permissions.length === 0 || item.permissions.some((permission) => session.permissions.includes(permission)))
  );

  const handleAccountLogout = () => {
    logoutAccount();
    navigate("/acces", { replace: true });
  };

  const canSelectRouter = Boolean(session?.permissions.includes("global.routers.select"));

  const handleOrganizationChange = async (membershipId: string) => {
    if (membershipId === saasAccount?.user.membership_id || isSwitchingOrganization) return;
    setIsSwitchingOrganization(true);
    setOrganizationSwitchFeedback("Préparation du changement d'organisation…");
    try {
      await waitForEmbeddedVpnProvisioning();
      const result = await switchOrganization(membershipId);
      if (!result.ok) {
        setOrganizationSwitchFeedback(result.message ?? "Changement d'organisation impossible.");
        return;
      }

      try {
        const currentVpn = await getVpnProviderStatus();
        if (currentVpn.provider === "EMBEDDED") {
          await disconnectEmbeddedVpn();
        }
        setOrganizationSwitchFeedback("Organisation sélectionnée. Mise à jour de la connexion sécurisée…");
        const vpn = await new EmbeddedVpnProvisioningService().ensureConnected();
        setOrganizationSwitchFeedback(
          vpn.state === "CONNECTED"
            ? "Organisation active et connexion sécurisée mise à jour."
            : vpn.state === "SKIPPED"
              ? "Organisation active. La connexion sécurisée sera vérifiée au prochain lancement."
              : "Organisation active. La connexion sécurisée termine sa mise à jour."
        );
      } catch (error) {
        const detail = error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "erreur VPN inconnue";
        setOrganizationSwitchFeedback(`Organisation active, mais la connexion sécurisée n'a pas été mise à jour : ${detail}`);
      }
      navigate("/", { replace: true });
    } finally {
      setIsSwitchingOrganization(false);
    }
  };

  return (
    <div className={sidebarCollapsed ? "app-shell app-shell--sidebar-collapsed" : "app-shell"}>
      <WireGuardRecoveryBootstrap />
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="sidebar__brand">
          <img className="sidebar__mark" src={ticketProLogo} alt="" aria-hidden="true" />
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
          {saasAccount && saasAccount.organizations.length > 1 ? (
            <label className="organization-switcher">
              <span className="organization-switcher__label">
                <Building2 aria-hidden="true" />
                Organisation active
              </span>
              <span className={`organization-switcher__control${isSwitchingOrganization ? " organization-switcher__control--loading" : ""}`}>
                <select
                  aria-label="Changer d'organisation"
                  disabled={isSwitchingOrganization}
                  onChange={(event) => void handleOrganizationChange(event.target.value)}
                  value={saasAccount.user.membership_id}
                >
                  {saasAccount.organizations.map((organization) => (
                    <option key={organization.membership_id} value={organization.membership_id}>
                      {organization.organization_name}
                    </option>
                  ))}
                </select>
                {isSwitchingOrganization ? <LoaderCircle aria-hidden="true" className="organization-switcher__loader" /> : <ChevronDown aria-hidden="true" />}
              </span>
              <span className="organization-switcher__status" aria-live="polite">
                {organizationSwitchFeedback ?? (isSwitchingOrganization ? "Changement en cours…" : "Changer d'organisation")}
              </span>
            </label>
          ) : null}
          <Button icon={LogOut} onClick={handleAccountLogout} variant="ghost">
            Changer d'utilisateur
          </Button>
        </div>
      </aside>

      <main className="content">
        <AppUpdateNotice
          canManageUpdates={Boolean(session?.permissions.includes("global.settings"))}
        />
        {isRouterScope && canSelectRouter ? (
          <Button icon={ArrowLeft} onClick={() => navigate("/routeurs")} variant="ghost">
            Changer de routeur
          </Button>
        ) : !isRouterScope && canSelectRouter ? (
          <Button icon={Router} onClick={() => navigate("/routeurs")} variant="ghost">
            Choisir un routeur
          </Button>
        ) : null}

        <Outlet />
      </main>
    </div>
  );
}
