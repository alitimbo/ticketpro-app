import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Copy,
  Edit3,
  Eye,
  FileText,
  Gauge,
  ListChecks,
  Plus,
  RotateCw,
  Save,
  Trash2,
  WifiOff
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import {
  createPersistedRouterService,
  FakeRouterAdapter,
  RouterService,
  type RouterActionLog
} from "../../services/router";
import {
  HotspotPlanRepository,
  RouterConnectionRepository,
  RouterRepository,
  TicketRepository,
  useAppDatabase
} from "../../services/database";
import { ActionMenu, Badge, Button, Card, EmptyState, FilterButton, PageHeader, StatusDot } from "../../shared/ui";
import {
  applyTemplate,
  emptyPlanFormValues,
  formValuesToPlanDraft,
  formatPlanMinutes,
  planFromHotspotPlan,
  planFromRecord,
  planRecordFromDraft,
  planToFormValues,
  quickPlanTemplates,
  validatePlanForm,
  type PlanFormValues,
  type PlanViewModel
} from "./plansPageModel";

type PlanFormState = {
  advancedOpen: boolean;
  error: string | null;
  mode: "create" | "edit";
  plan: PlanViewModel | null;
  values: PlanFormValues;
};

export function PlansPage() {
  const { session, userCan } = useAuth();
  const { routerId = "routeur-demo" } = useParams();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const canManagePlans = userCan("router.plans.write");
  const [plans, setPlans] = useState<PlanViewModel[]>([]);
  const [formState, setFormState] = useState<PlanFormState | null>(null);
  const [logs, setLogs] = useState<RouterActionLog[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [persistedService, setPersistedService] = useState<RouterService | null>(null);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const service = useMemo(
    () =>
      new RouterService({
        adapter: new FakeRouterAdapter({ latencyMs: 0 }),
        logger: {
          write: (log) => setLogs((current) => [...current, log])
        },
        authSession: session
      }),
    [session]
  );

  useEffect(() => {
    if (!isPersistent || !isInitialized || !session) {
      setPersistedService(null);
      return undefined;
    }

    let mounted = true;
    const accountId = session?.account_id;

    async function prepareService() {
      const router = await routerRepository.findById(routerId);

      if (!accountId || !router || router.account_id !== accountId) {
        return;
      }

      const serviceForRouter = await createPersistedRouterService({
        authSession: session,
        connections: await connectionRepository.listByRouter(routerId),
        database,
        logger: { write: (log) => setLogs((current) => [...current, log]) },
        router
      });

      if (mounted) {
        setPersistedService(serviceForRouter);
      }
    }

    void prepareService().catch((error) => {
      if (mounted) {
        setMessage(error instanceof Error ? error.message : "Connexion au routeur indisponible.");
      }
    });

    return () => {
      mounted = false;
    };
  }, [connectionRepository, isInitialized, isPersistent, routerId, routerRepository, session]);

  useEffect(() => {
    if (isPersistent && (!isInitialized || !routerId || !session)) {
      return undefined;
    }

    let mounted = true;
    const accountId = session?.account_id;

    async function loadPlans() {
      if (isPersistent) {
        const [router, records, ticketRecords] = await Promise.all([
          routerRepository.findById(routerId),
          planRepository.listByRouter(routerId),
          ticketRepository.listByRouter(routerId)
        ]);

        if (!mounted) {
          return;
        }

        if (!accountId || !router || router.account_id !== accountId) {
          setPlans([]);
          return;
        }

        setPlans(records.map((record) => planFromRecord(record, ticketRecords.filter((ticket) => ticket.plan_id === record.id && ticket.account_id === accountId).length)));
        return;
      }

      const remotePlans = await service.getHotspotPlans();

      if (!mounted) {
        return;
      }

      setPlans(remotePlans.map((plan, index) => planFromHotspotPlan(plan, index === 0 ? 3 : 0)));
    }

    void loadPlans();

    return () => {
      mounted = false;
    };
  }, [isInitialized, isPersistent, planRepository, routerId, routerRepository, service, session, ticketRepository]);

  const openCreateForm = () => {
    setFormState({
      advancedOpen: false,
      error: null,
      mode: "create",
      plan: null,
      values: emptyPlanFormValues
    });
  };

  const openEditForm = (plan: PlanViewModel) => {
    setFormState({
      advancedOpen: false,
      error: null,
      mode: "edit",
      plan,
      values: planToFormValues(plan)
    });
  };

  const syncPlan = async (plan: PlanViewModel) => {
    if (isPersistent) {
      if (!persistedService) {
        setMessage("Le routeur n'est pas prêt ou son mot de passe doit être ressaisi.");
        return;
      }

      const draft = formValuesToPlanDraft(planToFormValues(plan));
      await persistedService.updateHotspotPlan(plan.profileName, draft);
      await planRepository.update({ ...planRecordFromDraft(draft, routerId, plan.id, "synced") });
      setPlans((current) => current.map((item) => (item.id === plan.id ? { ...item, syncStatus: "synced" } : item)));
    } else {
      await service.updateHotspotPlan(plan.id, { status: plan.status });
    }
    setMessage(`${plan.name} synchronisé.`);
  };

  const submitForm = async () => {
    if (!formState) {
      return;
    }

    const validationError = validatePlanForm(formState.values);

    if (validationError) {
      setFormState({ ...formState, error: validationError });
      return;
    }

    const draft = formValuesToPlanDraft(formState.values);

    if (formState.mode === "create") {
      const planId = `plan-${crypto.randomUUID()}`;
      const localRecord = planRecordFromDraft(draft, routerId, planId, isPersistent ? "pending" : "local");
      const storedRecord = isPersistent ? await planRepository.create(localRecord) : null;
      let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";

      if (isPersistent) {
        try {
          if (!persistedService) {
            throw new Error("Routeur non prêt");
          }
          await persistedService.createHotspotPlan(draft);
          syncStatus = "synced";
          await planRepository.update({ ...localRecord, sync_status: syncStatus });
        } catch {
          setMessage("Plan enregistré localement ; synchronisation à reprendre.");
        }
      }

      const created = isPersistent
        ? planFromRecord({ ...storedRecord!, sync_status: syncStatus })
        : planFromHotspotPlan(await service.createHotspotPlan(draft), 0);
      const viewModel = {
        ...created,
        idleTimeout: formState.values.idleTimeout,
        keepaliveTimeout: formState.values.keepaliveTimeout,
        rateLimit: formState.values.rateLimit,
        sessionTimeout: formState.values.sessionTimeout
      };

      setPlans((current) => [viewModel, ...current]);
      setMessage(`${viewModel.name} créé.`);
    } else if (formState.plan) {
      let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";
      const localRecord = planRecordFromDraft(draft, routerId, formState.plan.id, isPersistent ? "pending" : "local");
      const storedRecord = isPersistent ? await planRepository.update(localRecord) : null;

      if (isPersistent) {
        try {
          if (!persistedService) {
            throw new Error("Routeur non prêt");
          }
          await persistedService.updateHotspotPlan(formState.plan.profileName, draft);
          syncStatus = "synced";
          await planRepository.update({ ...localRecord, sync_status: syncStatus });
        } catch {
          setMessage("Plan modifié localement ; synchronisation à reprendre.");
        }
      }

      const updated = isPersistent
        ? planFromRecord({ ...storedRecord!, sync_status: syncStatus }, formState.plan.linkedTickets)
        : planFromHotspotPlan(await service.updateHotspotPlan(formState.plan.id, draft), formState.plan.linkedTickets);
      const viewModel = {
        ...updated,
        idleTimeout: formState.values.idleTimeout,
        keepaliveTimeout: formState.values.keepaliveTimeout,
        rateLimit: formState.values.rateLimit,
        sessionTimeout: formState.values.sessionTimeout
      };

      setPlans((current) => current.map((plan) => (plan.id === viewModel.id ? viewModel : plan)));
      setMessage(`${viewModel.name} modifié.`);
    }

    setFormState(null);
  };

  const duplicate = async (plan: PlanViewModel) => {
    const draft = formValuesToPlanDraft({
      ...planToFormValues(plan),
      name: `${plan.name} copie`,
      profileName: `${plan.profileName}-copie`,
      status: "active"
    });
    const planId = `plan-${crypto.randomUUID()}`;
    const localRecord = planRecordFromDraft(draft, routerId, planId, isPersistent ? "pending" : "local");
    const storedRecord = isPersistent ? await planRepository.create(localRecord) : null;
    let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";

    if (isPersistent && persistedService) {
      try {
        await persistedService.createHotspotPlan(draft);
        syncStatus = "synced";
        await planRepository.update({ ...localRecord, sync_status: syncStatus });
      } catch {
        setMessage("Copie enregistrée localement ; synchronisation à reprendre.");
      }
    }

    const created = isPersistent
      ? planFromRecord({ ...storedRecord!, sync_status: syncStatus })
      : planFromHotspotPlan(await service.createHotspotPlan(draft), 0);
    const copy = {
      ...created,
      idleTimeout: plan.idleTimeout,
      keepaliveTimeout: plan.keepaliveTimeout,
      rateLimit: plan.rateLimit,
      sessionTimeout: plan.sessionTimeout
    };

    setPlans((current) => [copy, ...current]);
    setMessage(`${plan.name} dupliqué.`);
  };

  const disable = async (plan: PlanViewModel) => {
    const draft = formValuesToPlanDraft({ ...planToFormValues(plan), status: "disabled" });
    if (isPersistent && persistedService) {
      try {
        await persistedService.updateHotspotPlan(plan.profileName, draft);
      } catch {
        setMessage("Plan désactivé localement ; synchronisation à reprendre.");
      }
    }

    const updated = isPersistent
      ? planFromRecord(await planRepository.update({ ...planRecordFromDraft(draft, routerId, plan.id, persistedService ? "synced" : "pending") }), plan.linkedTickets)
      : planFromHotspotPlan(await service.updateHotspotPlan(plan.id, { status: "disabled" }), plan.linkedTickets);
    setPlans((current) =>
      current.map((item) => (item.id === plan.id ? { ...item, status: updated.status } : item))
    );
    setMessage(`${plan.name} désactivé.`);
  };

  const remove = async (plan: PlanViewModel) => {
    if (plan.linkedTickets > 0) {
      setMessage("Suppression impossible : des tickets utilisent ce plan.");
      return;
    }

    if (isPersistent) {
      if (persistedService) {
        try {
          await persistedService.deleteHotspotPlan(plan.profileName);
        } catch {
          setMessage("Suppression distante impossible ; le plan reste conservé localement.");
          return;
        }
      }
      await planRepository.remove(plan.id);
    } else {
      await service.deleteHotspotPlan(plan.id);
    }
    setPlans((current) => current.filter((item) => item.id !== plan.id));
    setMessage(`${plan.name} supprimé.`);
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          canManagePlans ? (
            <Button icon={Plus} onClick={openCreateForm} variant="primary">
              Nouveau plan
            </Button>
          ) : null
        }
        description="Créez des plans simples qui serviront ensuite à générer les tickets."
        eyebrow="Routeur"
        title="Plans"
      />

      <Card title="Templates rapides" description="Choisissez un modèle puis ajustez les champs si besoin.">
        <div className="filter-row">
          {quickPlanTemplates.map((template) => (
            <FilterButton
              key={template.name}
              onClick={() =>
                setFormState({
                  advancedOpen: false,
                  error: null,
                  mode: "create",
                  plan: null,
                  values: applyTemplate(emptyPlanFormValues, template)
                })
              }
            >
              {template.name}
            </FilterButton>
          ))}
        </div>
      </Card>

      {message ? <p className="form-error">{message}</p> : null}

      <div className="router-section-heading">
        <h2>Plans ({plans.length})</h2>
        <span className="muted-inline">Logs : {logs.length}</span>
      </div>

      {plans.length > 0 ? (
        <div className="plans-grid">
          {plans.map((plan) => (
            <PlanCard
              canManage={canManagePlans}
              key={plan.id}
              onDelete={() => void remove(plan)}
              onDisable={() => void disable(plan)}
              onDuplicate={() => void duplicate(plan)}
              onEdit={() => openEditForm(plan)}
              onSync={() => void syncPlan(plan)}
              plan={plan}
            />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            action={
              canManagePlans ? (
                <Button icon={Plus} onClick={openCreateForm} variant="primary">
                  Nouveau plan
                </Button>
              ) : null
            }
            description="Aucun plan n'est encore disponible."
            icon={ListChecks}
            title="Aucun plan"
          />
        </Card>
      )}

      <PlanFormDialog
        canSubmit={canManagePlans && userCan("router.plans.read")}
        formState={formState}
        onCancel={() => setFormState(null)}
        onChange={(values) => formState && setFormState({ ...formState, error: null, values })}
        onSubmit={() => void submitForm()}
        onToggleAdvanced={() => formState && setFormState({ ...formState, advancedOpen: !formState.advancedOpen })}
      />
    </div>
  );
}

type PlanCardProps = {
  canManage: boolean;
  onDelete: () => void;
  onDisable: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onSync: () => void;
  plan: PlanViewModel;
};

function PlanCard({ canManage, onDelete, onDisable, onDuplicate, onEdit, onSync, plan }: PlanCardProps) {
  return (
    <article className="plan-card">
      <header className="plan-card__header">
        <div>
          <h3>{plan.name}</h3>
          <p>
            {formatPlanMinutes(plan.durationMinutes)} · validité {formatPlanMinutes(plan.validityMinutes ?? plan.durationMinutes)} · {plan.dataLimitMb ? `${plan.dataLimitMb} MB` : "Illimité"}
          </p>
        </div>
        <ActionMenu
          items={[
            { icon: Eye, label: "Voir", onSelect: () => undefined },
            ...(canManage
              ? [
                  { icon: Edit3, label: "Modifier", onSelect: onEdit },
                  { icon: Copy, label: "Dupliquer", onSelect: onDuplicate },
                  { icon: WifiOff, label: "Désactiver", onSelect: onDisable },
                  { icon: Trash2, label: "Supprimer", onSelect: onDelete },
                  { icon: RotateCw, label: "Synchroniser", onSelect: onSync }
                ]
              : [])
          ]}
        />
      </header>

      <div className="plan-card__status">
        <Badge status={plan.status === "active" ? "success" : "offline"}>
          {plan.status === "active" ? "Actif" : "Inactif"}
        </Badge>
        <Badge status={plan.syncStatus === "synced" ? "success" : plan.syncStatus === "conflict" ? "error" : "warning"}>
          {plan.syncStatus === "synced" ? "Synchronisé" : plan.syncStatus === "conflict" ? "Conflit" : "À synchroniser"}
        </Badge>
        <span>{plan.priceHint ? `${plan.priceHint} CFA` : "Prix non défini"}</span>
        <span>{plan.linkedTickets} ticket(s)</span>
      </div>

      <dl className="plan-card__details">
        <div>
          <dt>Durée</dt>
          <dd>{formatPlanMinutes(plan.durationMinutes)}</dd>
        </div>
        <div>
          <dt>Validité</dt>
          <dd>{formatPlanMinutes(plan.validityMinutes ?? plan.durationMinutes)}</dd>
        </div>
        <div>
          <dt>Débit</dt>
          <dd>{[plan.downloadLimit, plan.uploadLimit].filter(Boolean).join(" / ") || "Non défini"}</dd>
        </div>
        <div>
          <dt>Appareils</dt>
          <dd>{plan.sharedUsers}</dd>
        </div>
      </dl>
    </article>
  );
}

type PlanFormDialogProps = {
  canSubmit: boolean;
  formState: PlanFormState | null;
  onCancel: () => void;
  onChange: (values: PlanFormValues) => void;
  onSubmit: () => void;
  onToggleAdvanced: () => void;
};

function PlanFormDialog({ canSubmit, formState, onCancel, onChange, onSubmit, onToggleAdvanced }: PlanFormDialogProps) {
  if (!formState) {
    return null;
  }

  const values = formState.values;
  const update = (partial: Partial<PlanFormValues>) => onChange({ ...values, ...partial });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="router-form-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon">
            <ListChecks aria-hidden="true" />
          </div>
          <div>
            <h2>{formState.mode === "create" ? "Nouveau plan" : "Modifier plan"}</h2>
            <p>Les champs avancés sont optionnels.</p>
          </div>
        </header>

        <div className="router-form-grid">
          <label className="form-field">
            Nom du plan
            <input value={values.name} onChange={(event) => update({ name: event.target.value })} />
          </label>
          <label className="form-field">
            Durée d’utilisation
            <div className="inline-inputs">
              <input value={values.durationAmount} onChange={(event) => update({ durationAmount: event.target.value })} />
              <select value={values.durationUnit} onChange={(event) => update({ durationUnit: event.target.value as PlanFormValues["durationUnit"] })}>
                <option value="minutes">minutes</option>
                <option value="hours">heures</option>
                <option value="days">jours</option>
              </select>
            </div>
          </label>
          <label className="form-field">
            Validité après activation
            <div className="inline-inputs">
              <input value={values.validityAmount} onChange={(event) => update({ validityAmount: event.target.value })} />
              <select value={values.validityUnit} onChange={(event) => update({ validityUnit: event.target.value as PlanFormValues["validityUnit"] })}>
                <option value="minutes">minutes</option>
                <option value="hours">heures</option>
                <option value="days">jours</option>
              </select>
            </div>
            <small>Ex. 1h utilisable, valide 3h après activation.</small>
          </label>
          <label className="form-field">
            Volume data
            <div className="inline-inputs">
              <input placeholder="Vide = illimité" value={values.dataAmount} onChange={(event) => update({ dataAmount: event.target.value })} />
              <select value={values.dataUnit} onChange={(event) => update({ dataUnit: event.target.value as PlanFormValues["dataUnit"] })}>
                <option value="mb">MB</option>
                <option value="go">Go</option>
              </select>
            </div>
          </label>
          <label className="form-field">
            Vitesse download
            <input value={values.downloadLimit} onChange={(event) => update({ downloadLimit: event.target.value })} />
          </label>
          <label className="form-field">
            Vitesse upload
            <input value={values.uploadLimit} onChange={(event) => update({ uploadLimit: event.target.value })} />
          </label>
          <label className="form-field">
            Appareils autorisés
            <input value={values.sharedUsers} onChange={(event) => update({ sharedUsers: event.target.value })} />
          </label>
          <label className="form-field">
            Prix indicatif CFA
            <input value={values.priceHint} onChange={(event) => update({ priceHint: event.target.value })} />
          </label>
          <label className="form-field">
            Statut
            <select value={values.status} onChange={(event) => update({ status: event.target.value as PlanFormValues["status"] })}>
              <option value="active">Actif</option>
              <option value="disabled">Inactif</option>
            </select>
          </label>
        </div>

        <button className="advanced-toggle" onClick={onToggleAdvanced} type="button">
          <Gauge aria-hidden="true" />
          {formState.advancedOpen ? "Masquer les champs avancés" : "Afficher les champs avancés"}
        </button>

        {formState.advancedOpen ? (
          <div className="router-form-grid">
            <label className="form-field">
              Nom profil MikroTik
              <input value={values.profileName} onChange={(event) => update({ profileName: event.target.value })} />
            </label>
            <label className="form-field">
              Rate-limit
              <input value={values.rateLimit} onChange={(event) => update({ rateLimit: event.target.value })} />
            </label>
            <label className="form-field">
              Shared-users
              <input value={values.sharedUsers} onChange={(event) => update({ sharedUsers: event.target.value })} />
            </label>
            <label className="form-field">
              Session-timeout
              <input value={values.sessionTimeout} onChange={(event) => update({ sessionTimeout: event.target.value })} />
            </label>
            <label className="form-field">
              Idle-timeout
              <input value={values.idleTimeout} onChange={(event) => update({ idleTimeout: event.target.value })} />
            </label>
            <label className="form-field">
              Keepalive-timeout
              <input value={values.keepaliveTimeout} onChange={(event) => update({ keepaliveTimeout: event.target.value })} />
            </label>
          </div>
        ) : null}

        {formState.error ? <p className="form-error">{formState.error}</p> : null}

        <div className="confirm-dialog__actions">
          <Button onClick={onCancel} variant="ghost">
            Annuler
          </Button>
          <Button disabled={!canSubmit} icon={Save} onClick={onSubmit} variant="primary">
            Enregistrer
          </Button>
        </div>
      </section>
    </div>
  );
}
