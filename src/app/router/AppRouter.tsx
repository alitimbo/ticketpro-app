import { useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { DesktopLayout } from "../layouts/DesktopLayout";
import { getFirstLaunchRequired } from "../../services/auth";
import { FirstLaunchPage } from "../../pages/auth/FirstLaunchPage";
import { SuperAdminPage } from "../../pages/dev/SuperAdminPage";
import { LoginPage } from "../../pages/auth/LoginPage";
import { AccountPage } from "../../pages/global/AccountPage";
import { GlobalHomePage } from "../../pages/global/GlobalHomePage";
import { GlobalSettingsPage } from "../../pages/global/GlobalSettingsPage";
import { InvoicesPage } from "../../pages/global/InvoicesPage";
import { RoutersPage } from "../../pages/global/RoutersPage";
import { VpnPage } from "../../pages/global/VpnPage";
import { SubscriptionPage } from "../../pages/global/SubscriptionPage";
import { ConnectedClientsPage } from "../../pages/router/ConnectedClientsPage";
import { FilesPage } from "../../pages/router/FilesPage";
import { LogsPage } from "../../pages/router/LogsPage";
import { MonitoringPage } from "../../pages/router/MonitoringPage";
import { PlansPage } from "../../pages/router/PlansPage";
import { ReportPage } from "../../pages/router/ReportPage";
import { RouterHomePage } from "../../pages/router/RouterHomePage";
import { RouterSettingsPage } from "../../pages/router/RouterSettingsPage";
import { TicketGenerationPage } from "../../pages/router/TicketGenerationPage";
import { TicketsPage } from "../../pages/router/TicketsPage";
import { ResellerDashboardPage } from "../../pages/reseller/ResellerDashboardPage";
import { appModeStorageKey } from "../../services/reseller";

export function AppRouter() {
  const [firstLaunchRequired, setFirstLaunchRequired] = useState(() => getFirstLaunchRequired());
  const [resellerMode, setResellerMode] = useState(() => localStorage.getItem(appModeStorageKey) === "reseller");

  if (resellerMode) {
    return (
      <HashRouter>
        <Routes>
          <Route
            path="/revendeur"
            element={<ResellerDashboardPage onExit={() => setResellerMode(false)} />}
          />
          <Route path="*" element={<Navigate to="/revendeur" replace />} />
        </Routes>
      </HashRouter>
    );
  }

  if (firstLaunchRequired) {
    return (
      <HashRouter>
        <Routes>
          <Route
            path="/premier-lancement"
            element={(
              <FirstLaunchPage
                onComplete={() => setFirstLaunchRequired(false)}
                onResellerAccess={() => setResellerMode(true)}
              />
            )}
          />
          <Route path="*" element={<Navigate to="/premier-lancement" replace />} />
        </Routes>
      </HashRouter>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/dev-super-admin" element={<SuperAdminPage />} />
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute permissions={["global.home"]} />}>
          <Route element={<DesktopLayout scope="global" />}>
            <Route index element={<GlobalHomePage />} />
            <Route path="mon-compte" element={<AccountPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute permissions={["global.routers.select"]} />}>
          <Route element={<DesktopLayout scope="global" />}>
            <Route path="routeurs" element={<RoutersPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute permissions={["global.subscription"]} />}>
          <Route element={<DesktopLayout scope="global" />}>
            <Route path="abonnement" element={<SubscriptionPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute permissions={["global.invoices"]} />}>
          <Route element={<DesktopLayout scope="global" />}>
            <Route path="factures" element={<InvoicesPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute permissions={["global.vpn"]} />}>
          <Route element={<DesktopLayout scope="global" />}>
            <Route path="vpn" element={<VpnPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute permissions={["global.settings"]} />}>
          <Route element={<DesktopLayout scope="global" />}>
            <Route path="parametres" element={<GlobalSettingsPage />} />
          </Route>
        </Route>

        <Route path="routeurs/:routerId" element={<DesktopLayout scope="router" />}>
          <Route element={<ProtectedRoute permissions={["router.home"]} />}>
            <Route index element={<Navigate to="maison" replace />} />
            <Route path="maison" element={<RouterHomePage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.plans.read"]} />}>
            <Route path="plans" element={<PlansPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.tickets.read", "router.tickets.own"]} />}>
            <Route path="tickets" element={<TicketsPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.tickets.generate"]} />}>
            <Route path="tickets/generation" element={<TicketGenerationPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.files.read", "router.files.own"]} />}>
            <Route path="fichiers" element={<FilesPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.report.read", "router.report.own"]} />}>
            <Route path="rapport" element={<ReportPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.clients.read"]} />}>
            <Route path="clients-connectes" element={<ConnectedClientsPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.network.read"]} />}>
            <Route path="monitoring" element={<MonitoringPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.logs.read"]} />}>
            <Route path="logs" element={<LogsPage />} />
          </Route>
          <Route element={<ProtectedRoute permissions={["router.settings"]} />}>
            <Route path="parametres" element={<RouterSettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
