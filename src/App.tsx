import { AppRouter } from "./app/router/AppRouter";
import { AuthProvider } from "./app/auth/AuthProvider";
import { AppDatabaseProvider } from "./services/database";
import { AppBootstrap } from "./app/layouts/AppBootstrap";

export function App() {
  return (
    <AppDatabaseProvider>
      <AuthProvider>
        <AppBootstrap>
          <AppRouter />
        </AppBootstrap>
      </AuthProvider>
    </AppDatabaseProvider>
  );
}
