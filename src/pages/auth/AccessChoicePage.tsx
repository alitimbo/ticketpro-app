import { Building2, ShieldCheck, Store } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge, Card } from "../../shared/ui";

export function AccessChoicePage() {
  const navigate = useNavigate();

  return (
    <main className="login-page">
      <section className="profile-choice-panel" aria-labelledby="access-choice-title">
        <Card>
          <div className="login-panel__header">
            <p className="login-panel__brand">TicketPro par Akicorp Solutions</p>
            <Badge status="active">Accès sécurisé</Badge>
            <h1 className="login-panel__title" id="access-choice-title">
              Choisissez votre espace
            </h1>
            <p className="login-panel__text">
              Retrouvez votre réseau d’organisation ou votre activité de distribution.
            </p>
          </div>

          <div className="first-launch-journeys">
            <button className="first-launch-journey" onClick={() => navigate("/login")} type="button">
              <Building2 aria-hidden="true" size={28} />
              <strong>Organisation</strong>
              <span>Accéder aux routeurs, profils, ventes et statistiques de votre réseau.</span>
            </button>
            <button
              className="first-launch-journey"
              onClick={() => navigate("/connexion-revendeur")}
              type="button"
            >
              <Store aria-hidden="true" size={28} />
              <strong>Distributeur / revendeur</strong>
              <span>Gérer vos packs, crédits et sous-licences destinées à vos clients.</span>
            </button>
          </div>

          <div className="auth-note">
            <ShieldCheck aria-hidden="true" size={18} />
            <p>Une session encore valide est restaurée automatiquement au prochain lancement.</p>
          </div>
        </Card>
      </section>
    </main>
  );
}
