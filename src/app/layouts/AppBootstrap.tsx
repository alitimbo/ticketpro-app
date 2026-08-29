import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAppDatabase } from "../../services/database";
import { AppSplashScreen } from "./AppSplashScreen";

type SplashPhase = "visible" | "exiting" | "hidden";

const minimumSplashDurationMs = 600;
const splashExitDurationMs = 220;

export function AppBootstrap({ children }: { children: ReactNode }) {
  const { isMainAuthenticated, isSubscriptionChecked } = useAuth();
  const { initializationError, isInitialized } = useAppDatabase();
  const startedAt = useRef(Date.now());
  const [phase, setPhase] = useState<SplashPhase>("visible");
  const isReady = isAppBootstrapReady({
    isInitialized,
    isMainAuthenticated,
    isSubscriptionChecked
  });

  useEffect(() => {
    if (!isReady || initializationError) return undefined;

    let hideTimer: number | undefined;
    const elapsed = Date.now() - startedAt.current;
    const exitTimer = window.setTimeout(() => {
      setPhase("exiting");
      hideTimer = window.setTimeout(() => setPhase("hidden"), splashExitDurationMs);
    }, Math.max(0, minimumSplashDurationMs - elapsed));

    return () => {
      window.clearTimeout(exitTimer);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [initializationError, isReady]);

  const message = useMemo(() => {
    if (!isInitialized) return "Préparation de vos données locales…";
    if (isMainAuthenticated && !isSubscriptionChecked) return "Restauration de votre espace sécurisé…";
    return "Préparation de votre espace sécurisé…";
  }, [isInitialized, isMainAuthenticated, isSubscriptionChecked]);

  if (initializationError) {
    return (
      <AppSplashScreen
        detail="Redémarrez TicketPro. Si le problème persiste, contactez votre administrateur."
        message="Les données locales n'ont pas pu être initialisées."
        status="error"
      />
    );
  }

  return (
    <>
      {isReady ? children : null}
      {phase !== "hidden" ? (
        <AppSplashScreen isExiting={phase === "exiting"} message={message} />
      ) : null}
    </>
  );
}

export function isAppBootstrapReady(input: {
  isInitialized: boolean;
  isMainAuthenticated: boolean;
  isSubscriptionChecked: boolean;
}): boolean {
  return input.isInitialized && (!input.isMainAuthenticated || input.isSubscriptionChecked);
}
