import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LogIn } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/auth/AuthProvider";
import { getDefaultPathForRole } from "../../services/auth";
import { Badge, Button, Card, PasswordField, StatusDot } from "../../shared/ui";
import { isProductionRuntime } from "../../config/runtime";

export function LoginPage() {
  const navigate = useNavigate();
  const {
    isAuthenticated,
    isMainAuthenticated,
    loginAccount,
    saasAccount,
    session,
    switchOrganization
  } = useAuth();
  const [email, setEmail] = useState(isProductionRuntime ? "" : "doumacorporation@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    if (isAuthenticated && session) {
      navigate(getDefaultPathForRole(session.internal_profile_role), { replace: true });
    }
  }, [isAuthenticated, navigate, session]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const result = await loginAccount(email, password);
      if (!result.ok) {
        setError(result.message ?? "Connexion impossible.");
        setPassword("");
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isMainAuthenticated && saasAccount?.requires_organization_selection) {
    return (
      <main className="login-page">
        <section className="profile-choice-panel" aria-labelledby="organization-choice-title">
          <Card>
            <div className="login-panel__header">
              <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
              <StatusDot label="Compte multi-organisation" status="active" />
              <h1 className="login-panel__title" id="organization-choice-title">
                Choisissez votre organisation
              </h1>
              <p className="login-panel__text">
                Votre rôle et vos routeurs autorisés peuvent être différents dans chaque organisation.
              </p>
            </div>
            <div className="profile-choice-grid">
              {saasAccount.organizations.map((organization) => (
                <button
                  className="profile-choice-card"
                  disabled={isSwitching}
                  key={organization.membership_id}
                  onClick={() => {
                    setIsSwitching(true);
                    setError(null);
                    void switchOrganization(organization.membership_id).then((result) => {
                      if (!result.ok) setError(result.message ?? "Sélection impossible.");
                      setIsSwitching(false);
                    });
                  }}
                  type="button"
                >
                  <span className="profile-choice-card__content">
                    <span className="profile-choice-card__topline">
                      <strong>{organization.organization_name}</strong>
                      <Badge status="active">
                        {organization.authority_role === "owner" ? "Propriétaire" : organization.app_role}
                      </Badge>
                    </span>
                    <span className="profile-choice-card__hint">Ouvrir cette organisation</span>
                  </span>
                </button>
              ))}
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </Card>
        </section>
      </main>
    );
  }

  if (isMainAuthenticated) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <Card>
            <div className="login-panel__header">
              <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
              <StatusDot label="Session sécurisée" status="active" />
              <h1 className="login-panel__title">Ouverture de votre espace…</h1>
              <p className="login-panel__text">
                Vos permissions et vos routeurs autorisés sont en cours de chargement.
              </p>
            </div>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <Card>
          <div className="login-panel__header">
            <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
            <StatusDot label="Connexion sécurisée" status="active" />
            <h1 className="login-panel__title">Connectez-vous à TicketPro</h1>
            <p className="login-panel__text">
              Propriétaire, administrateur ou employé : utilisez vos identifiants personnels.
            </p>
          </div>

          <label className="form-field">
            Email
            <input
              autoComplete="email"
              autoFocus
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </label>

          <PasswordField
            label="Mot de passe"
            name="password"
            onChange={setPassword}
            value={password}
          />

          {error ? <p className="form-error">{error}</p> : null}

          {!isProductionRuntime ? (
            <div className="auth-note">
              <Badge status="active">Développement</Badge>
              <p>Compte de test : doumacorporation@gmail.com. Les secrets ne sont jamais affichés.</p>
            </div>
          ) : null}

          <div className="confirm-dialog__actions">
            <Button onClick={() => navigate("/inscription")} type="button" variant="ghost">
              Créer un compte
            </Button>
            <Button onClick={() => navigate("/mot-de-passe-oublie")} type="button" variant="ghost">
              Mot de passe oublié
            </Button>
            <Button disabled={isLoading} icon={LogIn} size="large" type="submit" variant="primary">
              {isLoading ? "Connexion…" : "Se connecter"}
            </Button>
          </div>
        </Card>
      </form>
    </main>
  );
}
