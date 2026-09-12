import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  appUpdatesAreSupported,
  checkForAppUpdate,
  describeAppUpdateError,
  installAvailableAppUpdate,
  type AppUpdate,
  type AppUpdateDownloadProgress
} from "../../services/app";
import { useAppDatabase } from "../../services/database";
import { AppSplashScreen } from "./AppSplashScreen";

type SplashPhase = "visible" | "exiting" | "hidden";

const minimumSplashDurationMs = 600;
const splashExitDurationMs = 220;
const startupUpdateCheckBudgetMs = 1_500;

export function AppBootstrap({ children }: { children: ReactNode }) {
  const { isMainAuthenticated, isSubscriptionChecked } = useAuth();
  const { initializationError, isInitialized } = useAppDatabase();
  const startedAt = useRef(Date.now());
  const [phase, setPhase] = useState<SplashPhase>("visible");
  const [startupUpdateChecked, setStartupUpdateChecked] = useState(!appUpdatesAreSupported());
  const [requiredUpdate, setRequiredUpdate] = useState<AppUpdate | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const isReady = isAppBootstrapReady({
    isInitialized,
    isMainAuthenticated,
    isSubscriptionChecked
  });

  useEffect(() => {
    if (!isInitialized || !appUpdatesAreSupported()) return undefined;
    let mounted = true;
    let startupGateOpen = true;
    const budgetTimer = window.setTimeout(() => {
      startupGateOpen = false;
      if (mounted) setStartupUpdateChecked(true);
    }, startupUpdateCheckBudgetMs);

    void checkForAppUpdate()
      .then((update) => {
        if (mounted && shouldBlockStartupForUpdate(update, startupGateOpen)) setRequiredUpdate(update);
      })
      .catch(() => {
        // Un poste hors ligne reste utilisable. Le prochain démarrage réessaiera.
      })
      .finally(() => {
        if (mounted) setStartupUpdateChecked(true);
      });

    return () => {
      mounted = false;
      window.clearTimeout(budgetTimer);
    };
  }, [isInitialized]);

  useEffect(() => {
    if (!isReady || !startupUpdateChecked || initializationError || requiredUpdate) return undefined;

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
  }, [initializationError, isReady, requiredUpdate, startupUpdateChecked]);

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

  const installRequiredUpdate = async () => {
    setIsInstallingUpdate(true);
    setUpdateProgress({ downloadedBytes: 0, percent: 0, totalBytes: null });
    setUpdateError(null);
    try {
      await installAvailableAppUpdate(setUpdateProgress);
    } catch (error) {
      setUpdateError(describeAppUpdateError(error));
      setIsInstallingUpdate(false);
    }
  };

  if (isReady && requiredUpdate) {
    const progressLabel = updateProgress?.percent === null
      ? "Téléchargement sécurisé en cours…"
      : updateProgress
        ? `Téléchargement sécurisé : ${updateProgress.percent} %.`
        : "Une sauvegarde locale sera créée avant l'installation.";
    return (
      <AppSplashScreen
        action={{
          disabled: isInstallingUpdate,
          label: isInstallingUpdate ? progressLabel : `Mettre à jour vers ${requiredUpdate.version}`,
          onClick: () => void installRequiredUpdate()
        }}
        detail={updateError ?? "Cette version est requise pour continuer à utiliser TicketPro. Vos données locales seront sauvegardées avant l'installation."}
        message={isInstallingUpdate ? "Installation de la mise à jour…" : `Mise à jour TicketPro ${requiredUpdate.version} requise`}
        status={updateError ? "error" : "update"}
      />
    );
  }

  return (
    <>
      {isReady && startupUpdateChecked ? children : null}
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

export function shouldBlockStartupForUpdate(
  update: AppUpdate | null,
  startupGateOpen: boolean
): boolean {
  return startupGateOpen && update?.enforcement === "required";
}
