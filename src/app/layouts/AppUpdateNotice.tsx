import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  appUpdatesAreSupported,
  checkForAppUpdate,
  type AppUpdate
} from "../../services/app";
import { Button } from "../../shared/ui";

type AppUpdateNoticeProps = {
  canManageUpdates: boolean;
};

export function AppUpdateNotice({ canManageUpdates }: AppUpdateNoticeProps) {
  const navigate = useNavigate();
  const [update, setUpdate] = useState<AppUpdate | null>(null);

  useEffect(() => {
    if (!appUpdatesAreSupported()) return;
    let mounted = true;
    void checkForAppUpdate()
      .then((availableUpdate) => {
        if (mounted) setUpdate(availableUpdate);
      })
      .catch(() => {
        // Le contrôle manuel dans Paramètres affichera une erreur exploitable.
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!update) return null;

  return (
    <div className="app-update-notice" role="status">
      <Download aria-hidden="true" />
      <div>
        <strong>TicketPro {update.version} est disponible</strong>
        <p>
          Une sauvegarde locale sera créée avant l'installation.
          {!canManageUpdates ? " Demandez à un administrateur de lancer la mise à jour." : ""}
        </p>
      </div>
      {canManageUpdates ? (
        <Button
          icon={Download}
          onClick={() => navigate("/parametres#mise-a-jour")}
          variant="primary"
        >
          Voir la mise à jour
        </Button>
      ) : null}
    </div>
  );
}
