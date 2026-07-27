import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, LogOut, ShieldCheck, Store, UserCheck, UserCog, UserRound } from "lucide-react";
import type { UserRole } from "../../domain/auth";
import { useAuth } from "../../app/auth/AuthProvider";
import { InternalProfileRepository, useAppDatabase } from "../../services/database";
import {
  getDefaultPathForRole,
  hasProfilePasswordConfigured,
  loadInternalProfiles,
  roleDescriptions,
  roleLabels,
  type InternalProfileConfig
} from "../../services/auth";
import { Badge, Button, Card, PasswordField, StatusDot } from "../../shared/ui";
import { isProductionRuntime } from "../../config/runtime";

type ProfileChoice = {
  icon: typeof UserCog;
  role: UserRole;
};

const profileIcons: ProfileChoice[] = [
  { icon: UserCog, role: "admin" },
  { icon: ShieldCheck, role: "operator" },
  { icon: UserCheck, role: "agent" },
  { icon: UserRound, role: "guest" }
];

export function LoginPage() {
  const navigate = useNavigate();
  const {
    accountSession,
    firstLaunchRequired,
    isAuthenticated,
    isMainAuthenticated,
    loginAccount,
    loginProfile,
    logoutAccount,
    session
  } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const [email, setEmail] = useState(isProductionRuntime ? "" : "doumacorporation@gmail.com");
  const [accountPassword, setAccountPassword] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileToUnlock, setProfileToUnlock] = useState<UserRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<InternalProfileConfig[]>(() => loadInternalProfiles());
  const [persistentPasswordRoles, setPersistentPasswordRoles] = useState<UserRole[]>([]);
  const internalProfileRepository = useMemo(() => new InternalProfileRepository(database), [database]);
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.role === profileToUnlock) ?? null,
    [profileToUnlock]
  );

  useEffect(() => {
    if (isAuthenticated && session) {
      navigate(getDefaultPathForRole(session.internal_profile_role), { replace: true });
    }
  }, [isAuthenticated, navigate, session]);

  const handleAccountSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const result = await loginAccount(email, accountPassword);

    if (!result.ok) {
      setError(result.message ?? "Connexion impossible.");
      setAccountPassword("");
      return;
    }

    setAccountPassword("");
  };

  const enterWithProfile = async (role: UserRole, password: string) => {
    const result = await loginProfile(role, password);

    if (!result.ok) {
      setError(result.message ?? "Connexion impossible.");
      setProfilePassword("");
      return;
    }

    setProfilePassword("");
    setProfileToUnlock(null);
    navigate(getDefaultPathForRole(role), { replace: true });
  };

  const handleProfileClick = (profile: InternalProfileConfig) => {
    setError(null);
    setProfilePassword("");

    if (!profile.isEnabled) {
      setError("Ce profil est désactivé.");
      return;
    }

    if (isPersistent ? persistentPasswordRoles.includes(profile.role) : hasProfilePasswordConfigured(profile.role, accountSession?.accountId)) {
      setProfileToUnlock(profile.role);
      return;
    }

    if (!firstLaunchRequired) {
      setError("Ce profil n'a pas encore de mot de passe. Demandez à l'Admin de le configurer.");
      return;
    }

    void enterWithProfile(profile.role, "");
  };

  const handleProfilePasswordSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!profileToUnlock) {
      return;
    }

    setError(null);
    void enterWithProfile(profileToUnlock, profilePassword);
  };

  const handleChangeAccount = () => {
    setEmail("");
    setAccountPassword("");
    setProfilePassword("");
    setProfileToUnlock(null);
    setError(null);
    logoutAccount();
  };

  useEffect(() => {
    if (isMainAuthenticated) {
      setProfiles(loadInternalProfiles(accountSession?.accountId));
    }
  }, [isMainAuthenticated]);

  useEffect(() => {
    if (!isPersistent || !isInitialized || !accountSession) {
      return;
    }

    void internalProfileRepository.listByAccount(accountSession.accountId).then((records) => {
      setPersistentPasswordRoles(records.filter((record) => Boolean(record.password_hash)).map((record) => record.role));
      setProfiles((current) =>
        current.map((profile) => {
          const record = records.find((item) => item.role === profile.role);
          return record
            ? { ...profile, displayName: record.display_name, id: record.id, isEnabled: record.is_enabled === 1 }
            : profile;
        })
      );
    });
  }, [accountSession, internalProfileRepository, isInitialized, isPersistent]);

  if (!isMainAuthenticated) {
    return (
      <main className="login-page">
        <form className="login-panel" onSubmit={handleAccountSubmit}>
          <Card>
            <div className="login-panel__header">
              <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
              <StatusDot label="Compte principal" status="active" />
              <h1 className="login-panel__title">Connexion au compte principal</h1>
              <p className="login-panel__text">
                Connectez d'abord le compte de l'entreprise, puis choisissez votre profil interne.
              </p>
            </div>

            <label className="form-field">
              Email
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </label>

            <PasswordField
              label="Mot de passe"
              name="password"
              onChange={setAccountPassword}
              value={accountPassword}
            />

            {error ? <p className="form-error">{error}</p> : null}

            {!isProductionRuntime ? (
              <div className="auth-note">
                <Badge status="active">Développement</Badge>
                <p>Compte de test : doumacorporation@gmail.com. Les secrets ne sont jamais affichés.</p>
              </div>
            ) : null}

            <div className="confirm-dialog__actions">
              <Button icon={Store} onClick={() => navigate("/connexion-revendeur")} type="button" variant="ghost">
                Espace distributeur
              </Button>
              <Button icon={LogIn} size="large" type="submit" variant="primary">
                Se connecter
              </Button>
            </div>
          </Card>
        </form>
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="profile-choice-panel" aria-labelledby="profile-choice-title">
        <Card>
          <div className="login-panel__header">
            <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
            <StatusDot label="Compte connecté" status="active" />
            <h1 className="login-panel__title" id="profile-choice-title">Choisissez votre profil</h1>
            <p className="login-panel__text">Compte connecté : {accountSession?.email}</p>
          </div>

          <div className="profile-choice-grid" aria-label="Profils internes">
            {profiles.map((profile) => {
              const Icon = profileIcons.find((item) => item.role === profile.role)?.icon ?? UserRound;
              const hasPassword = isPersistent
                ? persistentPasswordRoles.includes(profile.role)
                : hasProfilePasswordConfigured(profile.role, accountSession?.accountId);

              return (
                <button
                  className="profile-choice-card"
                  disabled={!profile.isEnabled}
                  key={profile.role}
                  onClick={() => handleProfileClick(profile)}
                  type="button"
                >
                  <span className="profile-choice-card__icon">
                      <Icon aria-hidden="true" />
                  </span>
                  <span className="profile-choice-card__content">
                    <span className="profile-choice-card__topline">
                      <strong>{profile.displayName || roleLabels[profile.role]}</strong>
                      <Badge status={profile.isEnabled ? "success" : "offline"}>
                        {profile.isEnabled ? "Activé" : "Désactivé"}
                      </Badge>
                    </span>
                    <span className="profile-choice-card__description">{roleDescriptions[profile.role]}</span>
                    <span className="profile-choice-card__hint">
                      {hasPassword ? "Mot de passe requis" : "Configuration requise"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {error ? <p className="form-error profile-choice-error">{error}</p> : null}

          <div className="profile-choice-actions">
            <Button icon={UserRound} onClick={handleChangeAccount} type="button" variant="ghost">
              Changer de compte principal
            </Button>
            <Button icon={LogOut} onClick={logoutAccount} type="button" variant="ghost">
              Déconnexion complète
            </Button>
          </div>
        </Card>
      </section>

      {selectedProfile ? (
        <div className="dialog-backdrop" role="presentation">
          <form
            aria-modal="true"
            className="confirm-dialog profile-password-dialog"
            onSubmit={handleProfilePasswordSubmit}
            role="dialog"
          >
            <h2 className="confirm-dialog__title">Mot de passe {selectedProfile.displayName}</h2>
            <p className="confirm-dialog__description">
              Entrez le mot de passe du profil pour ouvrir l'application avec ses permissions.
            </p>
            <PasswordField
              label={`Mot de passe ${selectedProfile.displayName}`}
              name="profile-password"
              onChange={setProfilePassword}
              value={profilePassword}
            />
            {error ? <p className="form-error profile-choice-error">{error}</p> : null}
            <div className="confirm-dialog__actions">
              <Button
                onClick={() => {
                  setProfileToUnlock(null);
                  setProfilePassword("");
                  setError(null);
                }}
                type="button"
                variant="ghost"
              >
                Annuler
              </Button>
              <Button icon={LogIn} type="submit" variant="primary">
                Entrer
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
