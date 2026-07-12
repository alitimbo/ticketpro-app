import { Navigate, Outlet, useParams } from "react-router-dom";
import type { Permission } from "../../domain/auth";
import { getDefaultPathForRole } from "../../services/auth";
import { useAuth } from "./AuthProvider";

type ProtectedRouteProps = {
  permissions?: Permission[];
};

export function ProtectedRoute({ permissions = [] }: ProtectedRouteProps) {
  const { routerId } = useParams();
  const { session, userCanAny } = useAuth();

  if (!session) {
    return <Navigate replace to="/login" />;
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
