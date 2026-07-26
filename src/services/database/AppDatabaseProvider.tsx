import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { isTauriRuntime } from "../../config/runtime";
import type { DatabaseClient } from "./DatabaseClient";
import { InMemoryDatabaseClient } from "./InMemoryDatabaseClient";
import { TauriSqliteDatabase } from "./TauriSqliteDatabase";

type AppDatabaseContextValue = {
  database: DatabaseClient;
  initializationError: string | null;
  isInitialized: boolean;
  isPersistent: boolean;
};

const AppDatabaseContext = createContext<AppDatabaseContextValue | null>(null);

export function AppDatabaseProvider({ children }: { children: ReactNode }) {
  const isPersistent = isTauriRuntime();
  const database = useMemo<DatabaseClient>(
    () => (isPersistent ? new TauriSqliteDatabase() : new InMemoryDatabaseClient()),
    [isPersistent]
  );
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    setIsInitialized(false);
    setInitializationError(null);

    void database
      .initialize()
      .then(async () => {
        const settingsRows = await database.query<{ key: string; value: string }>("SELECT * FROM app_settings");
        const storedSettings = settingsRows.find((row) => row.key === "app_settings")?.value;
        if (storedSettings && typeof localStorage !== "undefined") {
          localStorage.setItem("hotspot:app_settings", storedSettings);
        }
      })
      .then(() => {
        if (mounted) {
          setIsInitialized(true);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setInitializationError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      mounted = false;
    };
  }, [database]);

  const value = useMemo(
    () => ({ database, initializationError, isInitialized, isPersistent }),
    [database, initializationError, isInitialized, isPersistent]
  );

  return <AppDatabaseContext.Provider value={value}>{children}</AppDatabaseContext.Provider>;
}

export function useAppDatabase(): AppDatabaseContextValue {
  const context = useContext(AppDatabaseContext);

  if (!context) {
    throw new Error("useAppDatabase doit être utilisé dans AppDatabaseProvider.");
  }

  return context;
}
