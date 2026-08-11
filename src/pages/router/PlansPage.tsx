import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Copy,
  Edit3,
  Eye,
  FileText,
  ListChecks,
  LoaderCircle,
  Plus,
  RotateCw,
  Save,
  Trash2,
  WifiOff
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import {
  createRemotePlanIdempotently,
  createPersistedRouterService,
  deleteRemotePlanIdempotently,
  FakeRouterAdapter,
  RouterService,
  synchronizePlanVouchers,
  updateRemotePlanIdempotently,
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
import { RouterCloudRecoveryService } from "../../services/recovery";

type PlanFormState = {
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
  const [selectedPlan, setSelectedPlan] = useState<PlanViewModel | null>(null);
  const [syncingPlanId, setSyncingPlanId] = useState<string | null>(null);
  const [formOperation, setFormOperation] = useState<"create" | "edit" | null>(null);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const recoveryService = useMemo(
    () => session
      ? new RouterCloudRecoveryService(database, session.account_id, session.internal_profile_id)
      : null,
    [database, session]
  );
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

  const getPersistedService = async (): Promise<RouterService> => {
    if (persistedService) return persistedService;
    if (!isInitialized || !session) {
      throw new Error("La base locale ou la session n'est pas encore prête.");
    }

    const router = await routerRepository.findById(routerId);
    if (!router || router.account_id !== session.account_id) {
      throw new Error("Routeur introuvable pour cette organisation.");
    }

    const serviceForRouter = await createPersistedRouterService({
      authSession: session,
      connections: await connectionRepository.listByRouter(routerId),
      database,
      logger: { write: (log) => setLogs((current) => [...current, log]) },
      router
    });
    setPersistedService(serviceForRouter);
    return serviceForRouter;
  };

  const backupRouterSnapshot = async () => {
    if (!isPersistent || !recoveryService) return;
    try {
      await recoveryService.backupRouter(routerId);
    } catch {
      setMessage("Plan enregistré ; sauvegarde VPS en attente de reconnexion.");
    }
  };

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
      error: null,
      mode: "create",
      plan: null,
      values: emptyPlanFormValues
    });
  };

  const openEditForm = (plan: PlanViewModel) => {
    setFormState({
      error: null,
      mode: "edit",
      plan,
      values: planToFormValues(plan)
    });
  };

  const syncPlan = async (plan: PlanViewModel) => {
    if (syncingPlanId) return;
    setSyncingPlanId(plan.id);
    setMessage(`${plan.name} : synchronisation RouterOS en cours…`);

    try {
      if (isPersistent) {
        const activeService = await getPersistedService();
        let draft = formValuesToPlanDraft(planToFormValues(plan));
        if (plan.syncStatus === "synced") {
          const remotePlan = (await activeService.getHotspotPlans()).find(
            (candidate) =>
              candidate.profileName === plan.profileName
              || candidate.id === plan.profileName
          );
          if (!remotePlan) {
            throw new Error("Le profil est absent du MikroTik.");
          }
          // Pour un plan déjà synchronisé, le bouton relit RouterOS. Le nom
          // commercial et le prix restent locaux, car RouterOS ne les stocke
          // pas toujours dans le profil Hotspot.
          draft = {
            dataLimitMb: remotePlan.dataLimitMb,
            downloadLimit: remotePlan.downloadLimit,
            durationMinutes: remotePlan.durationMinutes,
            name: plan.name,
            priceHint: plan.priceHint,
            profileName: remotePlan.profileName,
            sharedUsers: remotePlan.sharedUsers,
            status: remotePlan.status,
            uploadLimit: remotePlan.uploadLimit,
            validityMinutes: remotePlan.validityMinutes
          };
        } else {
          await updateRemotePlanIdempotently(activeService, plan.profileName, draft);
        }
        const record = await planRepository.update({
          ...planRecordFromDraft(draft, routerId, plan.id, "synced")
        });
        const syncedPlan = planFromRecord(record, plan.linkedTickets);
        setPlans((current) =>
          current.map((item) => (item.id === plan.id ? syncedPlan : item))
        );
        setSelectedPlan((current) => (current?.id === plan.id ? syncedPlan : current));
        await backupRouterSnapshot();
      } else {
        await service.updateHotspotPlan(plan.id, { status: plan.status });
      }
      setMessage(
        plan.syncStatus === "synced"
          ? `${plan.name} actualisé depuis RouterOS.`
          : `${plan.name} synchronisé vers RouterOS.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Synchronisation impossible : ${error.message}`
          : "Synchronisation RouterOS impossible."
      );
    } finally {
      setSyncingPlanId(null);
    }
  };

  const submitForm = async () => {
    if (!formState || formOperation) {
      return;
    }

    const validationError = validatePlanForm(formState.values);

    if (validationError) {
      setFormState({ ...formState, error: validationError });
      return;
    }

    const submittedForm = formState;
    setFormOperation(submittedForm.mode);
    setMessage(null);

    try {
      const draft = formValuesToPlanDraft(submittedForm.values);

      if (submittedForm.mode === "create") {
        const planId = `plan-${crypto.randomUUID()}`;
        const localRecord = planRecordFromDraft(draft, routerId, planId, isPersistent ? "pending" : "local");
        const storedRecord = isPersistent ? await planRepository.create(localRecord) : null;
        let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";

        if (isPersistent) {
          try {
            await createRemotePlanIdempotently(await getPersistedService(), draft);
            syncStatus = "synced";
            await planRepository.update({ ...localRecord, sync_status: syncStatus });
          } catch {
            setMessage("Plan enregistré localement ; synchronisation à reprendre.");
          }
        }

        const created = isPersistent
          ? planFromRecord({ ...storedRecord!, sync_status: syncStatus })
          : planFromHotspotPlan(await service.createHotspotPlan(draft), 0);
        const viewModel = created;

        setPlans((current) => [viewModel, ...current]);
        if (isPersistent) await backupRouterSnapshot();
        setMessage(
          syncStatus === "synced"
            ? `${viewModel.name} créé et synchronisé.`
            : `${viewModel.name} créé localement ; synchronisation RouterOS à reprendre.`
        );
      } else if (submittedForm.plan) {
        let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";
        let updatedRouterUsers = 0;
        const localRecord = planRecordFromDraft(draft, routerId, submittedForm.plan.id, isPersistent ? "pending" : "local");
        const storedRecord = isPersistent ? await planRepository.update(localRecord) : null;

        if (isPersistent) {
          try {
            const activeService = await getPersistedService();
            await updateRemotePlanIdempotently(
              activeService,
              submittedForm.plan.profileName,
              draft
            );
            const voucherSync = await synchronizePlanVouchers({
              draft,
              localPlanId: submittedForm.plan.id,
              localTickets: await ticketRepository.listByRouter(routerId),
              service: activeService
            });
            updatedRouterUsers = voucherSync.updatedRouterUsers;
            syncStatus = "synced";
            await planRepository.update({ ...localRecord, sync_status: syncStatus });
          } catch {
            setMessage("Plan modifié localement ; synchronisation à reprendre.");
          }
        }

        const updated = isPersistent
          ? planFromRecord({ ...storedRecord!, sync_status: syncStatus }, submittedForm.plan.linkedTickets)
          : planFromHotspotPlan(await service.updateHotspotPlan(submittedForm.plan.id, draft), submittedForm.plan.linkedTickets);
        const viewModel = updated;

        setPlans((current) => current.map((plan) => (plan.id === viewModel.id ? viewModel : plan)));
        if (isPersistent) await backupRouterSnapshot();
        setMessage(
          syncStatus === "synced"
            ? `${viewModel.name} modifié ; ${updatedRouterUsers} voucher(s) encore présent(s) sur RouterOS mis à jour.`
            : `${viewModel.name} modifié localement ; synchronisation RouterOS à reprendre.`
        );
      }

      setFormState(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "L'enregistrement du plan a échoué.";
      setFormState((current) => current ? { ...current, error: errorMessage } : current);
    } finally {
      setFormOperation(null);
    }
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

    if (isPersistent) {
      try {
        await createRemotePlanIdempotently(await getPersistedService(), draft);
        syncStatus = "synced";
        await planRepository.update({ ...localRecord, sync_status: syncStatus });
      } catch {
        setMessage("Copie enregistrée localement ; synchronisation à reprendre.");
      }
    }

    const created = isPersistent
      ? planFromRecord({ ...storedRecord!, sync_status: syncStatus })
      : planFromHotspotPlan(await service.createHotspotPlan(draft), 0);
    const copy = created;

    setPlans((current) => [copy, ...current]);
    if (isPersistent) await backupRouterSnapshot();
    setMessage(`${plan.name} dupliqué.`);
  };

  const toggleStatus = async (plan: PlanViewModel) => {
    const nextStatus = plan.status === "active" ? "disabled" : "active";
    const draft = formValuesToPlanDraft({ ...planToFormValues(plan), status: nextStatus });
    let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";
    if (isPersistent) {
      try {
        await updateRemotePlanIdempotently(
          await getPersistedService(),
          plan.profileName,
          draft
        );
        syncStatus = "synced";
      } catch {
        syncStatus = "pending";
      }
    }

    const updated = isPersistent
      ? planFromRecord(
          await planRepository.update({
            ...planRecordFromDraft(draft, routerId, plan.id, syncStatus)
          }),
          plan.linkedTickets
        )
      : planFromHotspotPlan(await service.updateHotspotPlan(plan.id, { status: nextStatus }), plan.linkedTickets);
    setPlans((current) =>
      current.map((item) => (item.id === plan.id ? updated : item))
    );
    if (isPersistent) await backupRouterSnapshot();
    const action = nextStatus === "disabled" ? "désactivé" : "réactivé";
    setMessage(
      syncStatus === "synced"
        ? `${plan.name} ${action}.`
        : `${plan.name} ${action} localement ; synchronisation à reprendre.`
    );
  };

  const remove = async (plan: PlanViewModel) => {
    if (plan.linkedTickets > 0) {
      setMessage(
        `Suppression protégée : ${plan.linkedTickets} ticket(s) utilisent ce plan. `
        + "Désactivez le plan pour interdire les nouvelles générations sans couper les clients existants."
      );
      return;
    }

    if (isPersistent) {
      try {
        await deleteRemotePlanIdempotently(
          await getPersistedService(),
          plan.profileName
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? `Suppression distante impossible : ${error.message} Le plan reste conservé localement.`
            : "Suppression distante impossible ; le plan reste conservé localement."
        );
        return;
      }
      await planRepository.remove(plan.id);
      await backupRouterSnapshot();
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
              onDisable={() => void toggleStatus(plan)}
              onDuplicate={() => void duplicate(plan)}
              onEdit={() => openEditForm(plan)}
              onView={() => setSelectedPlan(plan)}
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
        isSubmitting={formOperation !== null}
        onCancel={() => setFormState(null)}
        onChange={(values) => formState && setFormState({ ...formState, error: null, values })}
        onSubmit={() => void submitForm()}
      />
      <PlanDetailDialog onClose={() => setSelectedPlan(null)} plan={selectedPlan} />
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
  onView: () => void;
  plan: PlanViewModel;
};

function PlanCard({ canManage, onDelete, onDisable, onDuplicate, onEdit, onSync, onView, plan }: PlanCardProps) {
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
            { icon: Eye, label: "Voir", onSelect: onView },
            ...(canManage
              ? [
                  { icon: Edit3, label: "Modifier", onSelect: onEdit },
                  { icon: Copy, label: "Dupliquer", onSelect: onDuplicate },
                  {
                    icon: WifiOff,
                    label: plan.status === "active" ? "Désactiver" : "Réactiver",
                    onSelect: onDisable
                  },
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

function PlanDetailDialog({
  onClose,
  plan
}: {
  onClose: () => void;
  plan: PlanViewModel | null;
}) {
  if (!plan) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="client-detail-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon">
            <ListChecks aria-hidden="true" />
          </div>
          <div>
            <h2>{plan.name}</h2>
            <p>Paramètres appliqués aux vouchers</p>
          </div>
          <Badge status={plan.syncStatus === "synced" ? "success" : "warning"}>
            {plan.syncStatus === "synced" ? "Synchronisé" : "À synchroniser"}
          </Badge>
        </header>

        <dl className="client-detail-grid">
          <PlanDetailLine label="État commercial" value={plan.status === "active" ? "Actif" : "Inactif"} />
          <PlanDetailLine label="Durée d’utilisation" value={formatPlanMinutes(plan.durationMinutes)} />
          <PlanDetailLine
            label="Validité après activation"
            value={formatPlanMinutes(plan.validityMinutes ?? plan.durationMinutes)}
          />
          <PlanDetailLine
            label="Volume de données"
            value={plan.dataLimitMb ? `${plan.dataLimitMb} MB` : "Illimité"}
          />
          <PlanDetailLine label="Débit descendant" value={plan.downloadLimit ?? "Non défini"} />
          <PlanDetailLine label="Débit montant" value={plan.uploadLimit ?? "Non défini"} />
          <PlanDetailLine label="Appareils simultanés" value={String(plan.sharedUsers)} />
          <PlanDetailLine
            label="Prix indicatif"
            value={plan.priceHint === null ? "Non défini" : `${plan.priceHint} CFA`}
          />
          <PlanDetailLine label="Tickets liés" value={String(plan.linkedTickets)} />
        </dl>

        <div className="confirm-dialog__actions">
          <Button onClick={onClose} variant="primary">Fermer</Button>
        </div>
      </section>
    </div>
  );
}

function PlanDetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type PlanFormDialogProps = {
  canSubmit: boolean;
  formState: PlanFormState | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onChange: (values: PlanFormValues) => void;
  onSubmit: () => void;
};

function PlanFormDialog({ canSubmit, formState, isSubmitting, onCancel, onChange, onSubmit }: PlanFormDialogProps) {
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
            <p>Configurez les limites réellement appliquées aux vouchers.</p>
          </div>
        </header>

        <fieldset className="plan-form-fields" disabled={isSubmitting}>
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
        </fieldset>

        {formState.error ? <p className="form-error">{formState.error}</p> : null}

        <div className="confirm-dialog__actions">
          <Button disabled={isSubmitting} onClick={onCancel} variant="ghost">
            Annuler
          </Button>
          <Button
            className={isSubmitting ? "button--loading" : ""}
            disabled={!canSubmit || isSubmitting}
            icon={isSubmitting ? LoaderCircle : Save}
            onClick={onSubmit}
            variant="primary"
          >
            {isSubmitting
              ? formState.mode === "create" ? "Création…" : "Enregistrement…"
              : formState.mode === "create" ? "Créer le plan" : "Enregistrer"}
          </Button>
        </div>
      </section>
    </div>
  );
}
