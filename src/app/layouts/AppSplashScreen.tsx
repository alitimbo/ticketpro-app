import ticketProLogo from "../../../src-tauri/icons/icon.png";

type AppSplashScreenProps = {
  action?: {
    disabled?: boolean;
    label: string;
    onClick: () => void;
  };
  detail?: string | null;
  isExiting?: boolean;
  message?: string;
  status?: "loading" | "error" | "update";
};

export function AppSplashScreen({
  action,
  detail = null,
  isExiting = false,
  message = "Préparation de votre espace sécurisé…",
  status = "loading"
}: AppSplashScreenProps) {
  const isError = status === "error";
  const isUpdate = status === "update";

  return (
    <div
      className={`app-splash${isExiting ? " app-splash--exiting" : ""}`}
      data-testid="app-splash"
    >
      <div className="app-splash__glow" aria-hidden="true" />
      <main
        aria-label={isUpdate ? "Mise à jour TicketPro requise" : "Démarrage de TicketPro"}
        className="app-splash__content"
      >
        <img className="app-splash__logo" src={ticketProLogo} alt="Logo TicketPro" />
        <h1 className="app-splash__title">TicketPro</h1>
        <p className="app-splash__signature">par Akicorp Solutions</p>
        <div
          aria-live={isError ? "assertive" : "polite"}
          className={`app-splash__status${isError ? " app-splash__status--error" : ""}`}
          role={isError ? "alert" : "status"}
        >
          <p>{message}</p>
          {!isError && !isUpdate ? (
            <span className="app-splash__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : null}
        </div>
        {detail ? <p className="app-splash__detail">{detail}</p> : null}
        {action ? (
          <button className="button button--primary" disabled={action.disabled} onClick={action.onClick} type="button">
            {action.label}
          </button>
        ) : isError ? (
          <button className="button button--primary" onClick={() => window.location.reload()} type="button">
            Réessayer
          </button>
        ) : null}
      </main>
    </div>
  );
}
