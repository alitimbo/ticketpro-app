import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { requestSaasPasswordReset } from "../../services/saas";
import { Button, Card, StatusDot } from "../../shared/ui";

export function PasswordResetPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isSent, setIsSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const requestReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!email.includes("@")) {
      setError("Entrez une adresse email valide.");
      return;
    }

    setIsLoading(true);
    try {
      const result = await requestSaasPasswordReset(email.trim().toLowerCase());
      setMessage(result.message);
      setIsSent(true);
    } catch (requestError) {
      setError(errorMessage(requestError, "Impossible d'envoyer l'email de réinitialisation."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="password-reset-title">
        <Card>
          <div className="login-panel__header">
            <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
            <StatusDot label={isSent ? "Email envoyé" : "Compte principal"} status="active" />
            <h1 className="login-panel__title" id="password-reset-title">
              {isSent ? "Consultez votre boîte email" : "Mot de passe oublié"}
            </h1>
            <p className="login-panel__text">
              {isSent
                ? "Ouvrez le lien sécurisé reçu, choisissez votre nouveau mot de passe, puis revenez vous connecter."
                : "Indiquez l'adresse de votre compte. Le lien envoyé reste valable pendant 30 minutes."}
            </p>
          </div>

          {!isSent ? (
            <form onSubmit={requestReset}>
              <label className="form-field">
                Email du compte
                <input
                  autoComplete="email"
                  autoFocus
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  value={email}
                />
              </label>
              {error ? <p className="form-error">{error}</p> : null}
              <div className="confirm-dialog__actions">
                <Button icon={ArrowLeft} onClick={() => navigate("/login")} variant="ghost">
                  Retour à la connexion
                </Button>
                <Button disabled={isLoading} icon={Mail} type="submit" variant="primary">
                  {isLoading ? "Envoi..." : "Envoyer le lien"}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="auth-note">
                <CheckCircle2 aria-hidden="true" />
                <p>{message}</p>
              </div>
              <div className="confirm-dialog__actions">
                <Button
                  onClick={() => {
                    setIsSent(false);
                    setMessage(null);
                  }}
                  variant="ghost"
                >
                  Renvoyer le lien
                </Button>
                <Button onClick={() => navigate("/login")} variant="primary">
                  Revenir à la connexion
                </Button>
              </div>
            </>
          )}
        </Card>
      </section>
    </main>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
