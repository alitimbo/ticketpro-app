import ticketProLogo from "../../../src-tauri/icons/icon.png";

type AppSplashScreenProps = {
  detail?: string | null;
  isExiting?: boolean;
  message?: string;
  status?: "loading" | "error";
};

export function AppSplashScreen({
  detail = null,
  isExiting = false,
  message = "Préparation de votre espace sécurisé…",
  status = "loading"
}: AppSplashScreenProps) {
  const isError = status === "error";

  return (
    <div
      className={`app-splash${isExiting ? " app-splash--exiting" : ""}`}
      data-testid="app-splash"
    >
      <div className="app-splash__glow" aria-hidden="true" />
      <main
        aria-label="Démarrage de TicketPro"
        aria-live="polite"
        className="app-splash__content"
        role={isError ? "alert" : "status"}
      >
        <img className="app-splash__logo" src={ticketProLogo} alt="Logo TicketPro" />
        <h1 className="app-splash__title">TicketPro</h1>
        <p className="app-splash__signature">par Akicorp Solutions</p>
        <div className={`app-splash__status${isError ? " app-splash__status--error" : ""}`}>
          <p>{message}</p>
          {!isError ? (
            <span className="app-splash__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : null}
        </div>
        {detail ? <p className="app-splash__detail">{detail}</p> : null}
        {isError ? (
          <button className="button button--primary" onClick={() => window.location.reload()} type="button">
            Réessayer
          </button>
        ) : null}
      </main>
    </div>
  );
}
