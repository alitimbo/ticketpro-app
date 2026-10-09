import { useEffect, useMemo, useRef, useState } from "react";
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
import { ActionMenu, AsyncStateCard, Badge, Button, Card, EmptyState, FilterButton, PageHeader, StatusDot } from "../../shared/ui";
import {
  applyTemplate,
  describePlanChangeImpact,
  emptyPlanFormValues,
  formValuesToPlanDraft,
  formatPlanDisplayName,
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
import { reconcileRouterPlanCatalog, RouterCloudRecoveryService } from "../../services/recovery";
import type { HotspotPlanHistoryRecord } from "../../domain/database";

type PlanFormState = {
  error: string | null;
  mode: "create" | "edit";
  plan: PlanViewModel | null;
  values: PlanFormValues;
};

export function PlansPage() {
  const { saasAccount, session, userCan } = useAuth();
  const { routerId = "routeur-demo" } = useParams();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const canManagePlans = userCan("router.plans.write");
  const [plans, setPlans] = useState<PlanViewModel[]>([]);
  const [formState, setFormState] = useState<PlanFormState | null>(null);
  const [logs, setLogs] = useState<RouterActionLog[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [persistedServiceEntry, setPersistedServiceEntry] = useState<{
    routerId: string;
    service: RouterService;
  } | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const catalogRequestIdRef = useRef(0);
  const [selectedPlan, setSelectedPlan] = useState<PlanViewModel | null>(null);
  const [selectedPlanHistory, setSelectedPlanHistory] = useState<HotspotPlanHistoryRecord[]>([]);
  const [syncingPlanId, setSyncingPlanId] = useState<string | null>(null);
  const [formOperation, setFormOperation] = useState<"create" | "edit" | null>(null);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const recoveryService = useMemo(
    () => session
      ? new RouterCloudRecoveryService(
          database,
          session.account_id,
          session.internal_profile_id,
          undefined,
          saasAccount?.organization.id ?? null
        )
      : null,
    [database, saasAccount?.organization.id, session]
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
    if (persistedServiceEntry?.routerId === routerId) return persistedServiceEntry.service;
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
    setPersistedServiceEntry({ routerId, service: serviceForRouter });
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
      setPersistedServiceEntry(null);
      return undefined;
    }

    let mounted = true;
    const accountId = session?.account_id;
    setPersistedServiceEntry(null);
    setCatalogStatus("loading");

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
        setPersistedServiceEntry({ routerId, service: serviceForRouter });
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

  const refreshPlans = async () => {
    if (isPersistent && (!isInitialized || !routerId || !session)) return;
    const requestId = ++catalogRequestIdRef.current;
    setCatalogStatus("loading");
    setMessage(null);

    try {
      if (isPersistent) {
        const activeService = await getPersistedService();
        const [router, remotePlans, ticketRecords] = await Promise.all([
          routerRepository.findById(routerId),
          activeService.getHotspotPlans(),
          ticketRepository.listByRouter(routerId)
        ]);
        if (requestId !== catalogRequestIdRef.current) return;
        if (!router || router.account_id !== session?.account_id) {
          throw new Error("Routeur introuvable pour cette organisation.");
        }

        const reconciliation = await reconcileRouterPlanCatalog({
          plans: remotePlans,
          repository: planRepository,
          routerId
        });
        if (requestId !== catalogRequestIdRef.current) return;
        const visibleRecords = [
          ...reconciliation.liveRecords,
          ...reconciliation.retainedPendingRecords
        ];
        setPlans(visibleRecords.map((record) => planFromRecord(
          record,
          ticketRecords.filter((ticket) =>
            ticket.plan_id === record.id && ticket.account_id === session.account_id
          ).length
        )));
        setCatalogStatus("ready");
        setMessage(
          `${remotePlans.length} profil(s) relu(s) en direct sur RouterOS.`
          + (reconciliation.removedCount > 0
            ? ` ${reconciliation.removedCount} plan(s) absent(s) retiré(s) du catalogue local.`
            : "")
        );
        if (
          reconciliation.createdCount > 0
          || reconciliation.identityUpdatedCount > 0
          || reconciliation.removedCount > 0
        ) {
          await backupRouterSnapshot();
        }
        return;
      }

      const remotePlans = await service.getHotspotPlans();
      if (requestId !== catalogRequestIdRef.current) return;
      setPlans(remotePlans.map((plan, index) => planFromHotspotPlan(plan, index === 0 ? 3 : 0)));
      setCatalogStatus("ready");
    } catch (error) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogStatus("error");
      setMessage(error instanceof Error
        ? `Lecture RouterOS impossible : ${error.message}`
        : "Lecture en direct des profils RouterOS impossible.");
    }
  };

  useEffect(() => {
    if (isPersistent && persistedServiceEntry?.routerId !== routerId) return;
    void refreshPlans();
    // Refresh when the concrete service for this router becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPersistent, persistedServiceEntry, routerId]);

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
        let remoteMikrotikId = plan.mikrotikId;
        if (plan.syncStatus === "synced") {
          const remotePlan = (await activeService.getHotspotPlans()).find(
            (candidate) =>
              candidate.profileName === plan.profileName
              || candidate.id === plan.profileName
          );
          if (!remotePlan) {
            throw new Error("Le profil est absent du MikroTik.");
          }
          remoteMikrotikId = remotePlan.id;
          // Pour un plan déjà synchronisé, le bouton relit RouterOS. Le nom
          // commercial et le prix restent locaux, car RouterOS ne les stocke
          // pas toujours dans le profil Hotspot.
          draft = {
            currency: plan.currency,
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
          const remotePlan = await updateRemotePlanIdempotently(activeService, plan.profileName, draft);
          remoteMikrotikId = remotePlan.id;
        }
        const record = await planRepository.update({
          ...planRecordFromDraft(draft, routerId, plan.id, "synced", {
            createdByProfileId: plan.createdByProfileId,
            lastSyncedAt: new Date().toISOString(),
            mikrotikId: remoteMikrotikId,
            revision: plan.revision,
            updatedByProfileId: session?.internal_profile_id ?? null
          })
        }, {
          action: "synchronized",
          actorProfileId: session?.internal_profile_id ?? null,
          source: "routeros-manual-sync"
        });
        const syncedPlan = planFromRecord(record, plan.linkedTickets);
        setPlans((current) =>
          current.map((item) => (item.id === plan.id ? syncedPlan : item))
        );
        setSelectedPlan((current) => (current?.id === plan.id ? syncedPlan : current));
        if (selectedPlan?.id === plan.id) {
          setSelectedPlanHistory(await planRepository.listHistory(plan.id));
        }
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
        const localRecord = planRecordFromDraft(draft, routerId, planId, isPersistent ? "pending" : "local", {
          actorProfileId: session?.internal_profile_id ?? null
        });
        let storedRecord = isPersistent
          ? await planRepository.create(localRecord, {
              actorProfileId: session?.internal_profile_id ?? null,
              source: "plans-form"
            })
          : null;
        let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";

        if (isPersistent) {
          try {
            const remotePlan = await createRemotePlanIdempotently(await getPersistedService(), draft);
            syncStatus = "synced";
            storedRecord = await planRepository.update({
              ...localRecord,
              mikrotik_id: remotePlan.id,
              sync_status: syncStatus
            }, {
              action: "synchronized",
              actorProfileId: session?.internal_profile_id ?? null,
              source: "routeros-create"
            });
          } catch {
            setMessage("Plan enregistré localement ; synchronisation à reprendre.");
          }
        }

        const created = isPersistent
          ? planFromRecord({ ...storedRecord!, sync_status: syncStatus })
          : planFromHotspotPlan({ ...await service.createHotspotPlan(draft), currency: draft.currency }, 0);
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
        let voucherImpact: { immutableTicketsSkipped: number; updatedRouterUsers: number } | undefined;
        const localRecord = planRecordFromDraft(draft, routerId, submittedForm.plan.id, isPersistent ? "pending" : "local", {
          createdByProfileId: submittedForm.plan.createdByProfileId,
          lastSyncedAt: submittedForm.plan.lastSyncedAt,
          mikrotikId: submittedForm.plan.mikrotikId,
          revision: submittedForm.plan.revision,
          updatedByProfileId: session?.internal_profile_id ?? null
        });
        let storedRecord = isPersistent
          ? await planRepository.update(localRecord, {
              actorProfileId: session?.internal_profile_id ?? null,
              source: "plans-form"
            })
          : null;

        if (isPersistent) {
          try {
            const activeService = await getPersistedService();
            const remotePlan = await updateRemotePlanIdempotently(
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
            voucherImpact = voucherSync;
            syncStatus = "synced";
            storedRecord = await planRepository.update({
              ...localRecord,
              mikrotik_id: remotePlan.id,
              sync_status: syncStatus
            }, {
              action: "synchronized",
              actorProfileId: session?.internal_profile_id ?? null,
              source: "routeros-update"
            });
          } catch {
            setMessage("Plan modifié localement ; synchronisation à reprendre.");
          }
        }

        const updated = isPersistent
          ? planFromRecord({ ...storedRecord!, sync_status: syncStatus }, submittedForm.plan.linkedTickets)
          : planFromHotspotPlan({
              ...await service.updateHotspotPlan(submittedForm.plan.id, draft),
              currency: draft.currency
            }, submittedForm.plan.linkedTickets);
        const viewModel = updated;

        setPlans((current) => current.map((plan) => (plan.id === viewModel.id ? viewModel : plan)));
        if (isPersistent) await backupRouterSnapshot();
        const impact = describePlanChangeImpact(submittedForm.plan, draft, voucherImpact);
        setMessage(
          syncStatus === "synced"
            ? `${viewModel.name} modifié et confirmé par RouterOS ; ${updatedRouterUsers} voucher(s) mis à jour. ${impact}`
            : `${viewModel.name} modifié localement seulement : RouterOS n'a pas confirmé la modification, synchronisation à reprendre. ${impact}`
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

  const openPlanDetails = async (plan: PlanViewModel) => {
    setSelectedPlan(plan);
    setSelectedPlanHistory([]);
    if (!isPersistent) return;
    try {
      setSelectedPlanHistory(await planRepository.listHistory(plan.id));
    } catch {
      setMessage("Le plan est disponible, mais son historique local n'a pas pu être chargé.");
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
    const localRecord = planRecordFromDraft(draft, routerId, planId, isPersistent ? "pending" : "local", {
      actorProfileId: session?.internal_profile_id ?? null
    });
    let storedRecord = isPersistent
      ? await planRepository.create(localRecord, {
          actorProfileId: session?.internal_profile_id ?? null,
          source: "plan-duplicate"
        })
      : null;
    let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";

    if (isPersistent) {
      try {
        const remotePlan = await createRemotePlanIdempotently(await getPersistedService(), draft);
        syncStatus = "synced";
        storedRecord = await planRepository.update({
          ...localRecord,
          mikrotik_id: remotePlan.id,
          sync_status: syncStatus
        }, {
          action: "synchronized",
          actorProfileId: session?.internal_profile_id ?? null,
          source: "routeros-duplicate"
        });
      } catch {
        setMessage("Copie enregistrée localement ; synchronisation à reprendre.");
      }
    }

    const created = isPersistent
      ? planFromRecord({ ...storedRecord!, sync_status: syncStatus })
      : planFromHotspotPlan({ ...await service.createHotspotPlan(draft), currency: draft.currency }, 0);
    const copy = created;

    setPlans((current) => [copy, ...current]);
    if (isPersistent) await backupRouterSnapshot();
    setMessage(`${plan.name} dupliqué.`);
  };

  const toggleStatus = async (plan: PlanViewModel) => {
    const nextStatus = plan.status === "active" ? "disabled" : "active";
    const draft = formValuesToPlanDraft({ ...planToFormValues(plan), status: nextStatus });
    let syncStatus: PlanViewModel["syncStatus"] = isPersistent ? "pending" : "synced";
    let remoteMikrotikId = plan.mikrotikId;
    if (isPersistent) {
      try {
        const remotePlan = await updateRemotePlanIdempotently(
          await getPersistedService(),
          plan.profileName,
          draft
        );
        remoteMikrotikId = remotePlan.id;
        syncStatus = "synced";
      } catch {
        syncStatus = "pending";
      }
    }

    const updated = isPersistent
      ? planFromRecord(
          await planRepository.update({
            ...planRecordFromDraft(draft, routerId, plan.id, syncStatus, {
              createdByProfileId: plan.createdByProfileId,
              lastSyncedAt: syncStatus === "synced" ? new Date().toISOString() : plan.lastSyncedAt,
              mikrotikId: remoteMikrotikId,
              revision: plan.revision,
              updatedByProfileId: session?.internal_profile_id ?? null
            })
          }, {
            actorProfileId: session?.internal_profile_id ?? null,
            source: "plan-status"
          }),
          plan.linkedTickets
        )
      : planFromHotspotPlan({
          ...await service.updateHotspotPlan(plan.id, { status: nextStatus }),
          currency: plan.currency
        }, plan.linkedTickets);
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
      await planRepository.remove(plan.id, {
        actorProfileId: session?.internal_profile_id ?? null,
        source: "plans-page"
      });
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
          <div className="filter-row">
            <Button
              className={catalogStatus === "loading" ? "button--loading" : ""}
              disabled={catalogStatus === "loading"}
              icon={catalogStatus === "loading" ? LoaderCircle : RotateCw}
              onClick={() => void refreshPlans()}
            >
              {catalogStatus === "loading" ? "Lecture RouterOS…" : "Actualiser RouterOS"}
            </Button>
            {canManagePlans ? (
              <Button disabled={catalogStatus !== "ready"} icon={Plus} onClick={openCreateForm} variant="primary">
                Nouveau plan
              </Button>
            ) : null}
          </div>
        }
        description={canManagePlans
          ? "Créez des plans simples qui serviront ensuite à générer les tickets."
          : "Consultez les plans disponibles pour ce routeur."}
        eyebrow="Routeur"
        title="Plans"
      />

      {canManagePlans ? (
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
      ) : null}

      {message ? <p className="form-error">{message}</p> : null}

      <div className="router-section-heading">
        <h2>Plans ({plans.length})</h2>
        <span className="muted-inline">Logs : {logs.length}</span>
      </div>

      {catalogStatus !== "ready" ? (
        <AsyncStateCard
          description="TicketPro lit les profils Hotspot directement sur le MikroTik puis réconcilie la base locale."
          errorDescription="Les données locales sont conservées. Vérifiez la connexion au routeur puis relancez la lecture."
          errorTitle="Catalogue RouterOS indisponible"
          loadingDescription="Les durées, débits, quotas et profils supprimés sont vérifiés avant l’affichage."
          loadingTitle="Lecture des plans RouterOS en cours…"
          onRetry={() => void refreshPlans()}
          status={catalogStatus}
          title="Synchronisation des plans"
        />
      ) : plans.length > 0 ? (
        <div className="plans-grid">
          {plans.map((plan) => (
            <PlanCard
              canManage={canManagePlans}
              key={plan.id}
              onDelete={() => void remove(plan)}
              onDisable={() => void toggleStatus(plan)}
              onDuplicate={() => void duplicate(plan)}
              onEdit={() => openEditForm(plan)}
              onView={() => void openPlanDetails(plan)}
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
      <PlanDetailDialog
        history={selectedPlanHistory}
        onClose={() => {
          setSelectedPlan(null);
          setSelectedPlanHistory([]);
        }}
        plan={selectedPlan}
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
  onView: () => void;
  plan: PlanViewModel;
};

function PlanCard({ canManage, onDelete, onDisable, onDuplicate, onEdit, onSync, onView, plan }: PlanCardProps) {
  const isTicketProPlan = plan.ticketSettingsSource === "ticketpro" || plan.validityMinutes !== null;

  return (
    <article className="plan-card">
      <header className="plan-card__header">
        <div>
          <h3>{formatPlanDisplayName(plan.name)}</h3>
          <p>{isTicketProPlan
            ? `${formatPlanMinutes(plan.durationMinutes)} · validité ${formatPlanMinutes(plan.validityMinutes ?? plan.durationMinutes)} · ${plan.dataLimitMb ? `${plan.dataLimitMb} MB` : "Illimité"}`
            : `Profil RouterOS natif · session ${formatRouterOsDuration(plan.profileSettings?.sessionTimeout)} · cookie MAC ${formatRouterOsDuration(plan.profileSettings?.macCookieTimeout)}`}</p>
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
        <span>{plan.priceHint !== null ? `${plan.priceHint} ${plan.currency}` : `Prix non défini · ${plan.currency}`}</span>
        <span>{plan.linkedTickets} ticket(s)</span>
      </div>

      <dl className="plan-card__details">
        <div>
          <dt>{isTicketProPlan ? "Durée" : "Session maximale"}</dt>
          <dd>{isTicketProPlan ? formatPlanMinutes(plan.durationMinutes) : formatRouterOsDuration(plan.profileSettings?.sessionTimeout)}</dd>
        </div>
        <div>
          <dt>{isTicketProPlan ? "Validité" : "Cookie MAC"}</dt>
          <dd>{isTicketProPlan ? formatPlanMinutes(plan.validityMinutes ?? plan.durationMinutes) : formatRouterOsDuration(plan.profileSettings?.macCookieTimeout)}</dd>
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
  history,
  onClose,
  plan
}: {
  history: HotspotPlanHistoryRecord[];
  onClose: () => void;
  plan: PlanViewModel | null;
}) {
  if (!plan) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="plan-detail-title" aria-modal="true" className="client-detail-dialog plan-detail-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon">
            <ListChecks aria-hidden="true" />
          </div>
          <div>
            <h2 id="plan-detail-title">{formatPlanDisplayName(plan.name)}</h2>
            <p>Paramètres appliqués aux vouchers</p>
          </div>
          <Badge status={plan.syncStatus === "synced" ? "success" : "warning"}>
            {plan.syncStatus === "synced" ? "Synchronisé" : "À synchroniser"}
          </Badge>
        </header>

        <div className="plan-detail-dialog__body">
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
            value={plan.priceHint === null ? `Non défini · ${plan.currency}` : `${plan.priceHint} ${plan.currency}`}
          />
          <PlanDetailLine label="Identifiant MikroTik" value={plan.mikrotikId ?? "En attente de synchronisation"} />
          <PlanDetailLine label="Profil MikroTik" value={plan.profileName} />
          <PlanDetailLine label="Révision TicketPro" value={String(plan.revision)} />
          <PlanDetailLine label="Créé le" value={formatPlanAuditDate(plan.createdAt)} />
          <PlanDetailLine label="Dernière modification" value={formatPlanAuditDate(plan.updatedAt)} />
          <PlanDetailLine label="Dernière synchronisation" value={formatPlanAuditDate(plan.lastSyncedAt)} />
          <PlanDetailLine label="Créé par" value={plan.createdByProfileId ?? "Historique antérieur"} />
          <PlanDetailLine label="Modifié par" value={plan.updatedByProfileId ?? "Historique antérieur"} />
          <PlanDetailLine label="Tickets liés" value={String(plan.linkedTickets)} />
        </dl>

        <section className="ticket-detail-section" aria-label="Paramètres natifs du profil RouterOS">
          <h3>Paramètres natifs RouterOS</h3>
          <p className="muted-inline">
            {plan.ticketSettingsSource === "routeros"
              ? "Ce profil est lu tel quel depuis RouterOS. Le cookie MAC ne représente pas la validité d'un ticket."
              : "Les limites commerciales ci-dessus sont recopiées sur chaque voucher. Les réglages ci-dessous appartiennent au profil RouterOS."}
          </p>
          <dl className="client-detail-grid">
            <PlanDetailLine label="Durée maximale d'une session" value={formatRouterOsDuration(plan.profileSettings?.sessionTimeout)} />
            <PlanDetailLine label="Délai d'inactivité" value={formatRouterOsDuration(plan.profileSettings?.idleTimeout)} />
            <PlanDetailLine label="Keepalive timeout" value={formatRouterOsDuration(plan.profileSettings?.keepaliveTimeout)} />
            <PlanDetailLine label="MAC Cookie" value={formatRouterOsBoolean(plan.profileSettings?.addMacCookie)} />
            <PlanDetailLine label="Durée MAC Cookie" value={plan.profileSettings === undefined ? "Non relue" : plan.profileSettings.addMacCookie ? formatRouterOsDuration(plan.profileSettings.macCookieTimeout) : "Non applicable"} />
            <PlanDetailLine label="Address Pool" value={plan.profileSettings?.addressPool || "Par défaut"} />
            <PlanDetailLine label="Address List" value={plan.profileSettings?.addressList || "Aucune"} />
            <PlanDetailLine label="Status Auto Refresh" value={formatRouterOsDuration(plan.profileSettings?.statusAutorefresh)} />
            <PlanDetailLine label="Transparent Proxy" value={formatRouterOsBoolean(plan.profileSettings?.transparentProxy)} />
            <PlanDetailLine label="Scripts on-login / on-logout" value={plan.profileSettings?.onLogin || plan.profileSettings?.onLogout ? "Configurés" : "Aucun"} />
            <PlanDetailLine label="Filtres / marques de paquets" value={hasPacketControls(plan) ? "Configurés" : "Aucun"} />
          </dl>
        </section>

        <div className="router-section-heading">
          <h3>Historique ({history.length})</h3>
        </div>
        {history.length > 0 ? (
          <div className="print-history-list">
            {history.slice(0, 10).map((entry) => (
              <div className="print-history-row" key={entry.id}>
                <div>
                  <strong>{formatPlanHistoryAction(entry.action)}</strong>
                  <span>{entry.name} · {entry.price_hint === null ? "Prix non défini" : `${entry.price_hint} ${entry.currency}`}</span>
                </div>
                <small>
                  Révision {entry.revision} · {formatPlanAuditDate(entry.created_at)} · {entry.actor_profile_id ?? "Système"}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-inline">Aucun événement historique disponible pour ce plan.</p>
        )}
        </div>

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

function formatPlanAuditDate(value: string | null): string {
  if (!value) return "Non disponible";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("fr-FR");
}

function formatRouterOsDuration(value: string | null | undefined): string {
  if (!value || value === "0" || value === "0s" || value === "none") return "Illimitée";
  return value;
}

function formatRouterOsBoolean(value: boolean | undefined): string {
  if (value === undefined) return "Non relu";
  return value ? "Activé" : "Désactivé";
}

function hasPacketControls(plan: PlanViewModel): boolean {
  const settings = plan.profileSettings;
  return Boolean(settings?.incomingFilter || settings?.outgoingFilter || settings?.incomingPacketMark || settings?.outgoingPacketMark);
}

function formatPlanHistoryAction(action: HotspotPlanHistoryRecord["action"]): string {
  const labels: Record<HotspotPlanHistoryRecord["action"], string> = {
    created: "Création",
    deleted: "Suppression",
    restored: "Restauration",
    synchronized: "Synchronisation RouterOS",
    updated: "Modification"
  };
  return labels[action];
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
            Prix indicatif
            <div className="inline-inputs">
              <input min="0" type="number" value={values.priceHint} onChange={(event) => update({ priceHint: event.target.value })} />
              <input
                aria-label="Devise du plan"
                maxLength={12}
                placeholder="CFA, XOF, EUR…"
                required
                value={values.currency}
                onChange={(event) => update({ currency: event.target.value.toUpperCase() })}
              />
            </div>
            <small>Devise obligatoire, conservée avec le plan et chaque lot généré.</small>
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
