import { AppRouter } from "./app/router/AppRouter";
import { AuthProvider } from "./app/auth/AuthProvider";

export function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
