import { Navigate, Outlet, useParams } from "react-router-dom";
import type { Permission } from "../../domain/auth";
import { getDefaultPathForRole } from "../../services/auth";
import { useAuth } from "./AuthProvider";

type ProtectedRouteProps = {
  permissions?: Permission[];
  requireSubscription?: boolean;
};

export function ProtectedRoute({ permissions = [], requireSubscription = true }: ProtectedRouteProps) {
  const { routerId } = useParams();
  const {
    accountSession,
    isSubscriptionActive,
    isSubscriptionChecked,
    saasAccount,
    session,
    userCanAny
  } = useAuth();

  if (!session) {
    return <Navigate replace to={accountSession ? "/login" : "/acces"} />;
  }

  if (requireSubscription && !isSubscriptionChecked) {
    return <main className="login-page"><p>Vérification de votre abonnement…</p></main>;
  }

  if (requireSubscription && !isSubscriptionActive) {
    return <Navigate replace to="/abonnement" />;
  }

  if (
    routerId
    && saasAccount?.user.router_access.mode === "selected"
    && !saasAccount.user.router_access.router_ids.includes(routerId)
  ) {
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
