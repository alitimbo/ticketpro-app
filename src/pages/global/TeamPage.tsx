import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  LockKeyhole,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
  Users
} from "lucide-react";
import type { UserRole } from "../../domain/auth";
import { useAuth } from "../../app/auth/AuthProvider";
import { RouterRepository, useAppDatabase } from "../../services/database";
import {
  createSaasTeamMember,
  listSaasTeam,
  removeSaasTeamMember,
  resendSaasTeamInvitation,
  updateSaasTeamMember,
  type SaasOrganizationUser
} from "../../services/saas";
import { Badge, Button, Card, EmptyState, PageHeader } from "../../shared/ui";

type MemberForm = {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  appRole: UserRole;
  routerAccessMode: "all" | "selected";
  routerIds: string[];
};

const emptyForm: MemberForm = {
  id: null,
  name: "",
  email: "",
  phone: "",
  appRole: "operator",
  routerAccessMode: "selected",
  routerIds: []
};

const roleLabels: Record<UserRole, string> = {
  admin: "Administrateur",
  operator: "Opérateur",
  agent: "Agent",
  guest: "Invité"
};

const roleDescriptions: Record<UserRole, string> = {
  admin: "Gestion opérationnelle complète et gestion de l'équipe.",
  operator: "Tickets, fichiers, rapports et clients sur les routeurs autorisés.",
  agent: "Création de tickets et consultation de sa propre activité.",
  guest: "Consultation uniquement."
};

const roleGuide: Array<{
  accessLabel: string;
  allowed: string[];
  restriction: string;
  role: UserRole;
}> = [
  {
    accessLabel: "Accès élevé",
    allowed: [
      "Gérer les routeurs, les plans et les paramètres",
      "Configurer le VPN, l'anti-partage et les vouchers",
      "Gérer les employés de niveau inférieur"
    ],
    restriction: "Seul le propriétaire gère la facturation et les autres administrateurs.",
    role: "admin"
  },
  {
    accessLabel: "Exploitation",
    allowed: [
      "Créer et réimprimer des vouchers",
      "Consulter les plans, fichiers et rapports",
      "Voir les clients des routeurs autorisés"
    ],
    restriction: "Aucun accès aux paramètres, au VPN ou aux actions sensibles.",
    role: "operator"
  },
  {
    accessLabel: "Accès limité",
    allowed: [
      "Créer des vouchers",
      "Consulter uniquement ses propres lots",
      "Voir ses fichiers et son rapport d'activité"
    ],
    restriction: "Ne voit pas les plans, les clients ou le travail des autres employés.",
    role: "agent"
  },
  {
    accessLabel: "Lecture seule",
    allowed: [
      "Consulter les tickets autorisés",
      "Lire les rapports",
      "Consulter l'état du réseau"
    ],
    restriction: "Ne peut créer, modifier, supprimer ou déconnecter aucun élément.",
    role: "guest"
  }
];

export function TeamPage() {
  const { accountSession, saasAccount } = useAuth();
  const { database, isInitialized } = useAppDatabase();
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const [members, setMembers] = useState<SaasOrganizationUser[]>([]);
  const [routers, setRouters] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<MemberForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = saasAccount?.user.role === "owner";

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMembers(await listSaasTeam());
    } catch (loadError) {
      setError(errorMessage(loadError, "Impossible de charger l'équipe."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!isInitialized || !accountSession) return;
    void routerRepository.listByAccount(accountSession.accountId).then((records) => {
      setRouters(records.map((router) => ({ id: router.id, name: router.name })));
    });
  }, [accountSession, isInitialized, routerRepository]);

  const openEdit = (member: SaasOrganizationUser) => {
    setMessage(null);
    setError(null);
    setForm({
      id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone ?? "",
      appRole: member.app_role,
      routerAccessMode: member.router_access.mode,
      routerIds: member.router_access.router_ids
    });
  };

  const save = async () => {
    if (!form) return;
    setError(null);
    setMessage(null);
    if (!form.name.trim() || !form.email.includes("@")) {
      setError("Renseignez le nom et un email valide.");
      return;
    }
    setIsSaving(true);
    try {
      if (form.id) {
        const current = members.find((member) => member.id === form.id);
        if (!current) throw new Error("Employé introuvable.");
        await updateSaasTeamMember({
          userId: form.id,
          name: form.name.trim(),
          appRole: form.appRole,
          status: current.status,
          routerAccessMode: form.appRole === "admin" ? "all" : form.routerAccessMode,
          routerIds: form.routerIds
        });
        setMessage("Accès de l'employé mis à jour.");
      } else {
        const result = await createSaasTeamMember({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || undefined,
          appRole: form.appRole,
          routerAccessMode: form.appRole === "admin" ? "all" : form.routerAccessMode,
          routerIds: form.routerIds
        });
        setMessage(result.message);
      }
      setForm(null);
      await refresh();
    } catch (saveError) {
      setError(errorMessage(saveError, "Impossible d'enregistrer l'employé."));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStatus = async (member: SaasOrganizationUser) => {
    setError(null);
    try {
      await updateSaasTeamMember({
        userId: member.id,
        name: member.name,
        appRole: member.app_role,
        status: member.status === "active" ? "disabled" : "active",
        routerAccessMode: member.router_access.mode,
        routerIds: member.router_access.router_ids
      });
      setMessage(member.status === "active" ? "Employé suspendu." : "Employé réactivé.");
      await refresh();
    } catch (statusError) {
      setError(errorMessage(statusError, "Modification impossible."));
    }
  };

  const remove = async (member: SaasOrganizationUser) => {
    if (!window.confirm(`Supprimer définitivement le compte de ${member.name} ?`)) return;
    setError(null);
    try {
      await removeSaasTeamMember(member.id);
      setMessage("Employé supprimé.");
      await refresh();
    } catch (removeError) {
      setError(errorMessage(removeError, "Suppression impossible."));
    }
  };

  const resendInvitation = async (member: SaasOrganizationUser) => {
    setError(null);
    try {
      const result = await resendSaasTeamInvitation(member.id);
      setMessage(result.message);
    } catch (invitationError) {
      setError(errorMessage(invitationError, "Envoi impossible."));
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <Button icon={Plus} onClick={() => setForm({ ...emptyForm })} variant="primary">
            Ajouter un employé
          </Button>
        }
        description="Invitez votre équipe, attribuez les rôles et limitez l'accès aux routeurs nécessaires."
        eyebrow="Organisation"
        title="Équipe & accès"
      />

      {message ? <p className="form-error form-error--success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <Card
        title="Comprendre les rôles"
        description="Les rôles sont prédéfinis afin de garder une gestion simple, cohérente et sécurisée."
      >
        <div className="team-role-grid">
          {roleGuide.map((item) => (
            <article className={`team-role-card team-role-card--${item.role}`} key={item.role}>
              <header className="team-role-card__header">
                <div className="team-role-card__identity">
                  <ShieldCheck aria-hidden="true" />
                  <strong>{roleLabels[item.role]}</strong>
                </div>
                <Badge status={item.role === "admin" ? "warning" : "active"}>
                  {item.accessLabel}
                </Badge>
              </header>
              <p>{roleDescriptions[item.role]}</p>
              <ul className="team-role-card__permissions">
                {item.allowed.map((permission) => (
                  <li key={permission}>
                    <CheckCircle2 aria-hidden="true" />
                    <span>{permission}</span>
                  </li>
                ))}
              </ul>
              <div className="team-role-card__restriction">
                <LockKeyhole aria-hidden="true" />
                <span>{item.restriction}</span>
              </div>
            </article>
          ))}
        </div>
      </Card>

      <Card
        title="Membres de l'organisation"
        description="Chaque personne se connecte avec son propre email et son propre mot de passe."
      >
        {isLoading ? <p>Chargement de l'équipe…</p> : null}
        {!isLoading && members.length === 0 ? (
          <EmptyState
            description="Ajoutez votre premier employé pour lui attribuer un accès sécurisé."
            icon={Users}
            title="Aucun employé"
          />
        ) : null}
        <div className="data-list">
          {members.map((member) => {
            const isProtectedOwner = member.role === "owner";
            const canManageMember = !isProtectedOwner && (isOwner || member.app_role !== "admin");
            return (
              <article className="internal-profile-card" key={member.id}>
                <div className="internal-profile-card__header">
                  <div className="internal-profile-card__title">
                    <ShieldCheck aria-hidden="true" />
                    <div>
                      <strong>{member.name}</strong>
                      <span>{member.email}</span>
                    </div>
                  </div>
                  <Badge status={member.status === "active" ? "success" : "offline"}>
                    {member.invitation_pending
                      ? "Invitation en attente"
                      : member.status === "active"
                        ? "Actif"
                        : "Suspendu"}
                  </Badge>
                </div>
                <div className="internal-profile-permissions">
                  <Badge status="active">{isProtectedOwner ? "Propriétaire" : roleLabels[member.app_role]}</Badge>
                  <Badge status="active">
                    {member.router_access.mode === "all"
                      ? "Tous les routeurs"
                      : `${member.router_access.router_ids.length} routeur(s)`}
                  </Badge>
                </div>
                <p className="login-panel__text">{roleDescriptions[member.app_role]}</p>
                {canManageMember ? (
                  <div className="internal-profile-card__actions">
                    <Button onClick={() => openEdit(member)} variant="ghost">Modifier</Button>
                    {member.invitation_pending ? (
                      <Button icon={Mail} onClick={() => void resendInvitation(member)} variant="ghost">
                        Renvoyer l'invitation
                      </Button>
                    ) : null}
                    <Button
                      icon={member.status === "active" ? UserX : UserCheck}
                      onClick={() => void toggleStatus(member)}
                      variant="ghost"
                    >
                      {member.status === "active" ? "Suspendre" : "Réactiver"}
                    </Button>
                    <Button icon={Trash2} onClick={() => void remove(member)} variant="danger">
                      Supprimer
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </Card>

      {form ? (
        <div className="dialog-backdrop" role="presentation">
          <section aria-modal="true" className="confirm-dialog team-dialog" role="dialog">
            <h2 className="confirm-dialog__title">{form.id ? "Modifier l'employé" : "Ajouter un employé"}</h2>
            <p className="confirm-dialog__description">
              {form.id
                ? "Les nouvelles permissions seront appliquées à sa prochaine action."
                : "Un email sécurisé lui permettra de définir son mot de passe."}
            </p>
            <div className="form-grid">
              <label className="form-field">
                Nom complet
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label className="form-field">
                Email
                <input
                  disabled={Boolean(form.id)}
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </label>
              <label className="form-field">
                Téléphone
                <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </label>
              <label className="form-field">
                Rôle
                <select
                  value={form.appRole}
                  onChange={(event) => {
                    const appRole = event.target.value as UserRole;
                    setForm({
                      ...form,
                      appRole,
                      routerAccessMode: appRole === "admin" ? "all" : form.routerAccessMode
                    });
                  }}
                >
                  {isOwner ? <option value="admin">Administrateur</option> : null}
                  <option value="operator">Opérateur</option>
                  <option value="agent">Agent</option>
                  <option value="guest">Invité</option>
                </select>
              </label>
              {form.appRole !== "admin" ? (
                <label className="form-field">
                  Portée des routeurs
                  <select
                    value={form.routerAccessMode}
                    onChange={(event) => setForm({
                      ...form,
                      routerAccessMode: event.target.value as "all" | "selected"
                    })}
                  >
                    <option value="all">Tous les routeurs</option>
                    <option value="selected">Routeurs sélectionnés</option>
                  </select>
                </label>
              ) : null}
            </div>

            {form.appRole !== "admin" && form.routerAccessMode === "selected" ? (
              <div className="option-list">
                {routers.length === 0 ? <p>Aucun routeur local disponible pour l'affectation.</p> : null}
                {routers.map((router) => (
                  <label className="toggle-option" key={router.id}>
                    <input
                      checked={form.routerIds.includes(router.id)}
                      onChange={(event) => setForm({
                        ...form,
                        routerIds: event.target.checked
                          ? [...form.routerIds, router.id]
                          : form.routerIds.filter((id) => id !== router.id)
                      })}
                      type="checkbox"
                    />
                    <span>{router.name}</span>
                  </label>
                ))}
              </div>
            ) : null}

            {error ? <p className="form-error">{error}</p> : null}
            <div className="confirm-dialog__actions">
              <Button onClick={() => setForm(null)} variant="ghost">Annuler</Button>
              <Button disabled={isSaving} icon={form.id ? RefreshCw : Plus} onClick={() => void save()} variant="primary">
                {isSaving ? "Enregistrement…" : form.id ? "Enregistrer" : "Envoyer l'invitation"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
