import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useParams } from "react-router-dom";
import type { Permission } from "../../domain/auth";
import { getDefaultPathForRole } from "../../services/auth";
import { RouterRepository, useAppDatabase } from "../../services/database";
import { canAccessRouterInOrganization } from "../../services/access/routerOrganizationScope";
import { useAuth } from "./AuthProvider";

type ProtectedRouteProps = {
  permissions?: Permission[];
  requireSubscription?: boolean;
};

export function ProtectedRoute({ permissions = [], requireSubscription = true }: ProtectedRouteProps) {
  const { routerId } = useParams();
  const { database, isInitialized } = useAppDatabase();
  const {
    accountSession,
    isSubscriptionActive,
    isSubscriptionChecked,
    refreshSaasAccount,
    saasAccount,
    subscriptionCheckFailure,
    session,
    userCanAny
  } = useAuth();
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const selectedRouterIds = useMemo(
    () => saasAccount?.user.router_access.router_ids ?? [],
    [saasAccount]
  );
  const requiresRouterScopeLookup = Boolean(routerId && saasAccount?.organization.id);
  const routerAccessKey = requiresRouterScopeLookup
    ? `${accountSession?.accountId ?? session?.account_id ?? ""}:${saasAccount?.organization.id ?? ""}:${routerId}:${saasAccount?.user.router_access.mode ?? ""}:${selectedRouterIds.join(",")}`
    : "direct";
  const [resolvedRouterAccess, setResolvedRouterAccess] = useState<{
    allowed: boolean;
    key: string;
  }>({ allowed: false, key: "" });

  useEffect(() => {
    if (!requiresRouterScopeLookup || !routerId) {
      setResolvedRouterAccess({ allowed: true, key: routerAccessKey });
      return;
    }
    const accountId = accountSession?.accountId ?? session?.account_id;
    if (!isInitialized || !accountId) return;
    let mounted = true;
    void routerRepository.findById(routerId).then((router) => {
      if (!mounted) return;
      setResolvedRouterAccess({
        allowed: canAccessRouterInOrganization({
          accountId,
          accessMode: saasAccount?.user.router_access.mode ?? "selected",
          organizationId: saasAccount?.organization.id ?? "",
          router,
          selectedRouterIds
        }),
        key: routerAccessKey
      });
    }).catch(() => {
      if (mounted) setResolvedRouterAccess({ allowed: false, key: routerAccessKey });
    });
    return () => {
      mounted = false;
    };
  }, [
    accountSession?.accountId,
    isInitialized,
    requiresRouterScopeLookup,
    routerAccessKey,
    routerId,
    routerRepository,
    saasAccount?.organization.id,
    saasAccount?.user.router_access.mode,
    selectedRouterIds,
    session?.account_id
  ]);

  if (!session) {
    return <Navigate replace to={accountSession ? "/login" : "/acces"} />;
  }

  if (requireSubscription && !isSubscriptionChecked) {
    return <main className="login-page"><p>Vérification de votre abonnement…</p></main>;
  }

  if (requireSubscription && !isSubscriptionActive && subscriptionCheckFailure === "unreachable") {
    // Unknown is not expired: say so and retry instead of showing the
    // subscription page as if the subscription had ended.
    return (
      <main className="login-page">
        <div className="notice notice--warning" role="status">
          <p>
            Le serveur TicketPro est injoignable : votre abonnement ne peut pas être vérifié pour le moment.
            Il n'est pas expiré. Nouvelle tentative automatique…
          </p>
          <button className="button" onClick={() => void refreshSaasAccount()} type="button">
            Réessayer maintenant
          </button>
        </div>
      </main>
    );
  }

  if (requireSubscription && !isSubscriptionActive) {
    return <Navigate replace to="/abonnement" />;
  }

  if (requiresRouterScopeLookup && resolvedRouterAccess.key !== routerAccessKey) {
    return <main className="login-page"><p>Vérification de l'accès au routeur…</p></main>;
  }

  if (requiresRouterScopeLookup && !resolvedRouterAccess.allowed) {
    return <Navigate replace to="/routeurs" />;
  }

  if (!userCanAny(permissions)) {
    const fallbackPath =
      routerId && session.permissions.includes("router.home")
        ? `/routeurs/${routerId}/maison`
        : getDefaultPathForRole(session.internal_profile_role);

    return <Navigate replace to={fallbackPath} />;
  }

  return <Outlet />;
}
