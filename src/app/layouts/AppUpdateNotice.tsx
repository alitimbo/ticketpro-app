import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  appUpdatesAreSupported,
  checkForAppUpdate,
  describeAppUpdateError,
  installAvailableAppUpdate,
  type AppUpdate,
  type AppUpdateDownloadProgress
} from "../../services/app";
import { Button } from "../../shared/ui";

const refreshIntervalMs = 15 * 60_000;

export function AppUpdateNotice() {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<AppUpdateDownloadProgress | null>(null);

  useEffect(() => {
    if (!appUpdatesAreSupported()) return undefined;
    let mounted = true;
    const refresh = (force = false) => void checkForAppUpdate(force)
      .then((availableUpdate) => {
        if (mounted) setUpdate(availableUpdate);
      })
      .catch(() => {
        // Une indisponibilité réseau ne doit pas polluer l'écran de travail.
      });
    refresh();
    const intervalId = window.setInterval(() => refresh(true), refreshIntervalMs);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const install = async () => {
    setIsInstalling(true);
    setError(null);
    setProgress({ downloadedBytes: 0, percent: 0, totalBytes: null });
    try {
      await installAvailableAppUpdate(setProgress);
    } catch (installError) {
      setError(describeAppUpdateError(installError));
      setIsInstalling(false);
    }
  };

  if (!update) return null;

  return (
    <div className="app-update-notice">
      <Download aria-hidden="true" />
      <div>
        <strong>TicketPro {update.version} est disponible</strong>
        <p aria-live="polite" role="status">
          {update.enforcement === "required"
            ? "Cette mise à jour sera requise au prochain démarrage."
            : "Une sauvegarde locale sera créée avant l'installation."}
          {error ? ` ${error}` : ""}
        </p>
      </div>
      <Button
        disabled={isInstalling}
        icon={isInstalling ? LoaderCircle : Download}
        onClick={() => void install()}
        variant="primary"
      >
        {isInstalling
          ? progress?.percent === null ? "Téléchargement…" : `${progress?.percent ?? 0} %`
          : "Sauvegarder et mettre à jour"}
      </Button>
    </div>
  );
}
