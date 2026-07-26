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
