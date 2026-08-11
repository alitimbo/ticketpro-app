import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useParams } from "react-router-dom";
import type { Permission } from "../../domain/auth";
import { getDefaultPathForRole } from "../../services/auth";
import { RouterRepository, useAppDatabase } from "../../services/database";
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
    saasAccount,
    session,
    userCanAny
  } = useAuth();
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const selectedRouterIds = useMemo(
    () => saasAccount?.user.router_access.router_ids ?? [],
    [saasAccount]
  );
  const requiresCloudIdentityLookup = Boolean(
    routerId
    && saasAccount?.user.router_access.mode === "selected"
    && !selectedRouterIds.includes(routerId)
  );
  const routerAccessKey = requiresCloudIdentityLookup
    ? `${accountSession?.accountId ?? session?.account_id ?? ""}:${routerId}:${selectedRouterIds.join(",")}`
    : "direct";
  const [resolvedRouterAccess, setResolvedRouterAccess] = useState<{
    allowed: boolean;
    key: string;
  }>({ allowed: false, key: "" });

  useEffect(() => {
    if (!requiresCloudIdentityLookup || !routerId) {
      setResolvedRouterAccess({ allowed: true, key: routerAccessKey });
      return;
    }
    const accountId = accountSession?.accountId ?? session?.account_id;
    if (!isInitialized || !accountId) return;
    let mounted = true;
    void routerRepository.findById(routerId).then((router) => {
      if (!mounted) return;
      setResolvedRouterAccess({
        allowed: Boolean(
          router
          && router.account_id === accountId
          && selectedRouterIds.includes(router.cloud_router_id ?? router.id)
        ),
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
    requiresCloudIdentityLookup,
    routerAccessKey,
    routerId,
    routerRepository,
    selectedRouterIds,
    session?.account_id
  ]);

  if (!session) {
    return <Navigate replace to={accountSession ? "/login" : "/acces"} />;
  }

  if (requireSubscription && !isSubscriptionChecked) {
    return <main className="login-page"><p>Vérification de votre abonnement…</p></main>;
  }

  if (requireSubscription && !isSubscriptionActive) {
    return <Navigate replace to="/abonnement" />;
  }

  if (requiresCloudIdentityLookup && resolvedRouterAccess.key !== routerAccessKey) {
    return <main className="login-page"><p>Vérification de l'accès au routeur…</p></main>;
  }

  if (requiresCloudIdentityLookup && !resolvedRouterAccess.allowed) {
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
