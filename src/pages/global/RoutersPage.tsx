import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Edit3,
  AlertTriangle,
  Eye,
  Filter,
  Laptop,
  Plus,
  Radar,
  RefreshCw,
  Router,
  Save,
  Search,
  Trash2,
  Wifi,
  WifiOff
} from "lucide-react";
import type { RouterErrorCode, RouterSystemInfo } from "../../domain/router";
import { useAuth } from "../../app/auth/AuthProvider";
import { AuthorizationError, requireProfilePermission } from "../../services/auth";
import { decryptLocalSecret, encryptLocalSecret } from "../../services/security/localSecrets";
import { routerLicenseFingerprint, validateStoredLicense } from "../../services/licensing";
import { RouterConnectionRepository, RouterRepository, useAppDatabase } from "../../services/database";
import {
  FakeRouterAdapter,
  remoteSecurityWarnings,
  RouterService,
  RouterServiceError,
  type DiscoveredRouterCandidate,
  type RouterActionLog
} from "../../services/router";
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  EmptyState,
  FilterButton,
  PageHeader,
  PasswordField,
  StatusDot
} from "../../shared/ui";
import {
  createRouterFromForm,
  connectionModeLabel,
  demoRouters,
  emptyRouterFormValues,
  filterRouters,
  formValuesFromScannedRouter,
  formValuesFromRouter,
  getRouterLimitMessage,
  isRemoteConnectionMode,
  listRoutersForAccount,
  mapRouterErrorToTestStatus,
  routerCardFromRecord,
  routerConnectionInputsFromCard,
  routerRecordFromCard,
  routerTestMessage,
  type RouterCardData,
  type RouterConnectionTestStatus,
  type RouterFilter,
  type RouterFormValues
} from "./routerPageModel";
import { countRoutersForSubscription, getSubscriptionOverview } from "./subscriptionPageModel";

const statusLabels: Record<RouterCardData["status"], string> = {
  active: "Connecté",
  offline: "Hors ligne",
  warning: "À vérifier"
};

type RouterFormMode = "add" | "edit";

type RouterFormState = {
  detectedInfo: RouterSystemInfo | null;
  mode: RouterFormMode;
  router: RouterCardData | null;
  values: RouterFormValues;
  error: string | null;
  testStatus: RouterConnectionTestStatus;
  testMessage: string | null;
};

type ScanState = {
  isOpen: boolean;
  isScanning: boolean;
  results: DiscoveredRouterCandidate[];
  error: string | null;
};

export function RoutersPage() {
  const navigate = useNavigate();
  const { accountSession, saasAccount, session, userCan } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const accountId = accountSession?.accountId ?? session?.account_id ?? null;
  const canAddRouter = userCan("global.routers.add");
  const canEditRouter = userCan("global.routers.edit");
  const canDeleteRouter = userCan("global.routers.delete");
  const canViewSubscription = userCan("global.subscription");
  const [routers, setRouters] = useState<RouterCardData[]>(() => (isPersistent ? [] : demoRouters));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RouterFilter>("all");
  const [selectedRouter, setSelectedRouter] = useState<RouterCardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<RouterActionLog[]>([]);
  const [formState, setFormState] = useState<RouterFormState | null>(null);
  const [scanState, setScanState] = useState<ScanState>({
    error: null,
    isOpen: false,
    isScanning: false,
    results: []
  });
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const connectionRepository = useMemo(() => new RouterConnectionRepository(database), [database]);

  useEffect(() => {
    if (!isInitialized || !accountId) {
      return undefined;
    }

    const scopedAccountId = accountId;
    let mounted = true;

    async function loadRouters() {
      try {
        const records = await routerRepository.listByAccount(scopedAccountId);
        const cards = await Promise.all(
          records.map(async (record) =>
            routerCardFromRecord(record, await connectionRepository.listByRouter(record.id))
          )
        );

        if (!mounted) {
          return;
        }

        setRouters(cards.length > 0 || isPersistent ? cards : demoRouters);
      } catch (error) {
        if (!mounted) {
          return;
        }

        setMessage(error instanceof Error ? error.message : "Impossible de charger les routeurs.");

        if (!isPersistent) {
          setRouters(demoRouters);
        }
      }
    }

    void loadRouters();

    return () => {
      mounted = false;
    };
  }, [accountId, connectionRepository, isInitialized, isPersistent, routerRepository]);

  const accountRouters = useMemo(() => {
    const scopedRouters = listRoutersForAccount(routers, accountId);
    if (!saasAccount || saasAccount.user.router_access.mode === "all") return scopedRouters;
    const allowed = new Set(saasAccount.user.router_access.router_ids);
    return scopedRouters.filter((router) => allowed.has(router.id));
  }, [accountId, routers, saasAccount]);
  const visibleRouters = useMemo(() => filterRouters(accountRouters, query, filter), [accountRouters, filter, query]);
  const subscriptionOverview = useMemo(
    () => getSubscriptionOverview(countRoutersForSubscription(accountRouters)),
    [accountRouters]
  );
  const quotaMessage = getRouterLimitMessage(subscriptionOverview.canAddRouter);
  const canStartRouterCreation = canAddRouter && subscriptionOverview.canAddRouter;

  const openRouter = (router: RouterCardData) => {
    setMessage(null);
    setSelectedRouter(router);
  };

  const openAddForm = async () => {
    try {
      requireProfilePermission(session, "global.routers.add");
    } catch (permissionError) {
      setMessage(permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission d'ajouter un routeur.");
      return;
    }

    if (!subscriptionOverview.canAddRouter) {
      setMessage(quotaMessage);
      return;
    }


    /*
    try {
      await validateStoredLicense(database, accountId ?? "", accountRouters.map(routerLicenseFingerprint));
    } catch (licenseError) {
      setMessage(licenseError instanceof Error ? licenseError.message : "Licence TicketPro non valide.");
      return;
    }
    */

    setFormState({
      detectedInfo: null,
      error: null,
      mode: "add",
      router: null,
      testMessage: null,
      testStatus: "not_tested",
      values: emptyRouterFormValues
    });
  };

  const openScan = async () => {
    try {
      requireProfilePermission(session, "global.routers.add");
    } catch (permissionError) {
      setMessage(permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission d'ajouter un routeur.");
      return;
    }

    if (!subscriptionOverview.canAddRouter) {
      setMessage(quotaMessage);
      return;
    }

    /*
    try {
      await validateStoredLicense(database, accountId ?? "", accountRouters.map(routerLicenseFingerprint));
    } catch (licenseError) {
      setMessage(licenseError instanceof Error ? licenseError.message : "Licence TicketPro non valide.");
      return;
    }
    */

    setScanState({ error: null, isOpen: true, isScanning: false, results: [] });
  };

  const scanLocalNetwork = async () => {
    setScanState((current) => ({ ...current, error: null, isScanning: true }));
    const service = new RouterService({
      authSession: session,
      logger: {
        write: (log) => {
          setLogs((current) => [...current, log]);
        }
      }
    });

    try {
      const results = await service.scanLocalRouters();
      setScanState({ error: null, isOpen: true, isScanning: false, results });
    } catch {
      setScanState({ error: "Recherche impossible. Vérifiez que le PC est connecté au Wi-Fi du routeur.", isOpen: true, isScanning: false, results: [] });
    }
  };

  const useScannedRouter = (router: DiscoveredRouterCandidate) => {
    setScanState({ error: null, isOpen: false, isScanning: false, results: [] });
    setFormState({
      detectedInfo: router.systemInfo,
      error: null,
      mode: "add",
      router: null,
      testMessage: "Routeur detecte. Entrez le mot de passe puis testez la connexion.",
      testStatus: "not_tested",
      values: formValuesFromScannedRouter(router)
    });
  };

  const openEditForm = (router: RouterCardData) => {
    try {
      requireProfilePermission(session, "global.routers.edit");
    } catch (permissionError) {
      setMessage(permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission de modifier ce routeur.");
      return;
    }

    setFormState({
      detectedInfo: {
        architecture: "",
        boardName: router.boardName,
        identity: router.zoneName,
        model: router.model,
        routerOsVersion: router.routerOsVersion,
        serialNumber: router.serialNumber,
        uptime: ""
      },
      error: null,
      mode: "edit",
      router,
      testMessage: router.lastTestMessage,
      testStatus: router.lastTestStatus,
      values: formValuesFromRouter(router)
    });
  };

  const enterRouter = (mode: RouterFormValues["preferredMode"]) => {
    if (!selectedRouter) {
      return;
    }

    setMessage(
      mode === "local"
        ? "Connexion locale selectionnee."
        : `Connexion a distance selectionnee : ${connectionModeLabel(mode)}.`
    );
    setSelectedRouter(null);
    navigate(`/routeurs/${selectedRouter.id}/maison`);
  };

  const testConnection = async (router: RouterCardData) => {
    const result = await runRouterConnectionTest({
      apiPort: router.apiPort,
      apiSslPort: router.apiSslPort,
      encryptedPassword: router.encryptedPassword,
      ipAddress: router.ipAddress,
      mode: router.preferredMode,
      password: "",
      remoteHost: router.remoteHost,
      remotePort: String(router.remotePort),
      remoteUseSsl: router.remoteUseSsl,
      statusHint: router.status,
      username: router.username
    });

    if (isPersistent && accountId && session) {
      try {
        await routerRepository.recordConnectionTest({
          accountId,
          checkedAt: new Date().toISOString(),
          errorMessage: result.status === "connected" ? null : result.message,
          mode: router.preferredMode,
          internalProfileId: session.internal_profile_id,
          routerId: router.id,
          status: result.status === "connected" ? "connected" : result.status === "offline" ? "offline" : "warning"
        });
      } catch {
        setMessage("Connexion testée, mais le résultat n'a pas pu être enregistré.");
      }
    }

    setRouters((current) =>
      current.map((item) => (item.id === router.id ? applyTestResult(item, result.status, result.message, result.systemInfo) : item))
    );
    setMessage(result.message);
  };

  const submitForm = async () => {
    if (!formState) {
      return;
    }

    const validationError = validateRouterForm(formState);

    if (validationError) {
      setFormState({ ...formState, error: validationError });
      return;
    }

    const encryptedPassword =
      formState.values.password.trim().length > 0
        ? await encryptLocalSecret(formState.values.password)
        : formState.router?.encryptedPassword ?? "";

    if (formState.mode === "add") {
      try {
        requireProfilePermission(session, "global.routers.add");
      } catch (permissionError) {
        setFormState({
          ...formState,
          error: permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission d'ajouter un routeur."
        });
        return;
      }

      if (!subscriptionOverview.canAddRouter) {
        setFormState({ ...formState, error: quotaMessage });
        return;
      }

      if (!session || !accountId) {
        setFormState({ ...formState, error: "Session du compte ou du profil interne introuvable." });
        return;
      }

      const created = applyTestResult(
        createRouterFromForm(formState.values, encryptedPassword, formState.detectedInfo, undefined, {
          accountId,
          createdByProfileId: session.internal_profile_id
        }),
        formState.testStatus,
        formState.testMessage,
        formState.detectedInfo
      );
      try {
        /*
        await validateStoredLicense(database, accountId, [
          ...accountRouters.map(routerLicenseFingerprint),
          routerLicenseFingerprint(created)
        ]);
        */
        await routerRepository.createWithConnections(
          routerRecordFromCard(created),
          routerConnectionInputsFromCard(created)
        );

        setRouters((current) => [created, ...current]);
      setMessage(`${created.zoneName} ajouté.`);
      } catch (error) {
        setFormState({
          ...formState,
          error: error instanceof Error ? error.message : "Le routeur n'a pas pu être enregistré."
        });
        return;
      }
    } else if (formState.router) {
      try {
        requireProfilePermission(session, "global.routers.edit");
      } catch (permissionError) {
        setFormState({
          ...formState,
          error: permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission de modifier ce routeur."
        });
        return;
      }

      const persistedRouter = applyTestResult(
        {
          ...formState.router,
          apiPort: Number(formState.values.apiPort),
          apiSslPort: Number(formState.values.apiSslPort),
          boardName: formState.detectedInfo?.boardName ?? formState.router.boardName,
          encryptedPassword,
          ipAddress: formState.values.ipAddress,
          model: formState.values.model || formState.router.model,
          notes: formState.values.notes,
          preferredMode: formState.values.preferredMode,
          remoteHost: formState.values.remoteHost,
          remotePort: Number(formState.values.remotePort),
          remoteUseSsl: formState.values.remoteUseSsl,
          routerOsVersion: formState.detectedInfo?.routerOsVersion ?? formState.router.routerOsVersion,
          serialNumber: formState.detectedInfo?.serialNumber ?? formState.router.serialNumber,
          username: formState.values.username,
          zoneName: formState.values.name
        },
        formState.testStatus,
        formState.testMessage,
        formState.detectedInfo
      );

      try {
        await routerRepository.update(routerRecordFromCard(persistedRouter));
        await connectionRepository.replaceForRouter(
          persistedRouter.id,
          routerConnectionInputsFromCard(persistedRouter)
        );
      } catch (error) {
        setFormState({
          ...formState,
          error: error instanceof Error ? error.message : "Le routeur n'a pas pu être mis à jour."
        });
        return;
      }

      setRouters((current) =>
        current.map((router) =>
          router.id === formState.router?.id
            ? applyTestResult(
                {
                  ...router,
                  apiPort: Number(formState.values.apiPort),
                  apiSslPort: Number(formState.values.apiSslPort),
                  boardName: formState.detectedInfo?.boardName ?? router.boardName,
                  encryptedPassword,
                  ipAddress: formState.values.ipAddress,
                  model: formState.values.model || formState.detectedInfo?.model || "Modèle non renseigné",
                  notes: formState.values.notes,
                  preferredMode: formState.values.preferredMode,
                  remoteHost: formState.values.remoteHost,
                  remotePort: Number(formState.values.remotePort),
                  remoteUseSsl: formState.values.remoteUseSsl,
                  routerOsVersion: formState.detectedInfo?.routerOsVersion ?? router.routerOsVersion,
                  serialNumber: formState.detectedInfo?.serialNumber ?? router.serialNumber,
                  username: formState.values.username,
                  zoneName: formState.values.name
                },
                formState.testStatus,
                formState.testMessage,
                formState.detectedInfo
              )
            : router
        )
      );
      setMessage(`${formState.values.name} modifié.`);
    }

    setFormState(null);
  };

  const testFormConnection = async () => {
    if (!formState) {
      return;
    }

    const validationError = validateRouterFormForTest(formState.values);

    if (validationError) {
      setFormState({ ...formState, error: validationError });
      return;
    }

    const result = await runRouterConnectionTest({
      apiPort: Number(formState.values.apiPort),
      apiSslPort: Number(formState.values.apiSslPort),
      encryptedPassword: formState.router?.encryptedPassword,
      ipAddress: formState.values.ipAddress,
      mode: formState.values.preferredMode,
      password: formState.values.password,
      remoteHost: formState.values.remoteHost,
      remotePort: formState.values.remotePort,
      remoteUseSsl: formState.values.remoteUseSsl,
      statusHint: formState.router?.status,
      username: formState.values.username
    });

    setFormState({
      ...formState,
      detectedInfo: result.systemInfo ?? formState.detectedInfo,
      error: null,
      testMessage: result.message,
      testStatus: result.status,
      values: result.systemInfo
        ? {
            ...formState.values,
            model: result.systemInfo.model
          }
        : formState.values
    });
  };

  const runRouterConnectionTest = async ({
    apiPort,
    apiSslPort,
    encryptedPassword,
    ipAddress,
    mode,
    password,
    remoteHost,
    remotePort,
    remoteUseSsl,
    statusHint,
    username
  }: {
    apiPort: number;
    apiSslPort: number;
    encryptedPassword?: string;
    ipAddress: string;
    mode: RouterFormValues["preferredMode"];
    password: string;
    remoteHost: string;
    remotePort: string;
    remoteUseSsl: boolean;
    statusHint?: RouterCardData["status"];
    username: string;
  }): Promise<{ message: string; status: RouterConnectionTestStatus; systemInfo: RouterSystemInfo | null }> => {
    const targetHost = isRemoteConnectionMode(mode) ? remoteHost : ipAddress;
    let resolvedPassword = password;

    if (!resolvedPassword.trim() && encryptedPassword) {
      try {
        resolvedPassword = await decryptLocalSecret(encryptedPassword);
      } catch {
        return {
          message: "Le mot de passe enregistré ne peut pas être déchiffré. Saisissez-le à nouveau.",
          status: "authentication_failed",
          systemInfo: null
        };
      }
    }

    const logger = {
      write: (log: RouterActionLog) => {
        setLogs((current) => [...current, log]);
      }
    };
    const service = isPersistent
      ? new RouterService({
          authSession: session,
          logger,
          mikrotik: {
            connectionMode: mode,
            host: targetHost,
            password: resolvedPassword,
            port: isRemoteConnectionMode(mode) ? Number(remotePort) : apiPort,
            timeoutMs: 5000,
            useSsl: isRemoteConnectionMode(mode) ? remoteUseSsl : false,
            username
          },
          mode: "mikrotik"
        })
      : new RouterService({
          adapter: new FakeRouterAdapter({
            connectionMode: mode,
            errorMode: inferConnectionError({ host: targetHost, mode, password: resolvedPassword, statusHint }),
            host: targetHost || ipAddress,
            latencyMs: 0
          }),
          authSession: session,
          logger
        });

    try {
      if (isRemoteConnectionMode(mode)) {
        await service.resolveRemoteConnection({
          localHost: ipAddress,
          mode,
          port: Number(remotePort),
          remoteHost,
          routerId: formState?.router?.id ?? "nouveau-routeur",
          useSsl: remoteUseSsl
        });
      }

      await service.testConnection();
      const systemInfo = await service.getSystemInfo();
      return { message: routerTestMessage("connected"), status: "connected", systemInfo };
    } catch (error) {
      const status =
        error instanceof RouterServiceError ? mapRouterErrorToTestStatus(error.code) : "timeout";
      return { message: routerTestMessage(status), status, systemInfo: null };
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          canAddRouter ? (
            <div className="button-row">
              <Button disabled={!canStartRouterCreation} icon={Plus} onClick={openAddForm} variant="primary">
                Formulaire
              </Button>
              <Button disabled={!canStartRouterCreation} icon={Radar} onClick={openScan}>
                Rechercher Wi-Fi
              </Button>
              {!subscriptionOverview.canAddRouter && canViewSubscription ? (
                <Button onClick={() => navigate("/abonnement")}>Changer de pack</Button>
              ) : null}
            </div>
          ) : null
        }
        description="Sélectionnez un routeur, puis choisissez une connexion locale ou distante."
        eyebrow="Global"
        title="Routeurs"
      />

      <Card>
        <div className="router-account-summary">
          <div>
            <strong>
              Routeurs : {subscriptionOverview.routersUsed} / {subscriptionOverview.subscription.routerLimitSnapshot} — {subscriptionOverview.plan.name}
            </strong>
            <span>Compte connecté : {accountSession?.email ?? "non renseigné"}</span>
          </div>
          <Badge status={subscriptionOverview.canAddRouter ? "success" : "warning"}>
            {subscriptionOverview.canAddRouter ? "Ajout disponible" : "Limite atteinte"}
          </Badge>
        </div>
        {quotaMessage ? (
          <p className="form-error subscription-warning">
            {quotaMessage} {canViewSubscription ? "Vous pouvez changer de pack depuis Abonnement." : "Contactez l'Admin pour changer de pack."}
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="router-toolbar">
          <label className="router-search">
            <Search aria-hidden="true" />
            <input
              aria-label="Recherche routeur"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher par nom, IP ou modèle"
              value={query}
            />
          </label>

          <div className="filter-row">
            <FilterButton active={filter === "all"} icon={Filter} onClick={() => setFilter("all")}>
              Filtrer
            </FilterButton>
            <FilterButton active={filter === "active"} onClick={() => setFilter("active")}>
              Connectés
            </FilterButton>
            <FilterButton active={filter === "offline"} onClick={() => setFilter("offline")}>
              Hors ligne
            </FilterButton>
            <FilterButton active={filter === "warning"} onClick={() => setFilter("warning")}>
              À vérifier
            </FilterButton>
          </div>
        </div>
      </Card>

      {message ? <p className="form-error">{message}</p> : null}

      <div className="router-section-heading">
        <h2>Articles ({visibleRouters.length})</h2>
      </div>

      {visibleRouters.length > 0 ? (
        <div className="router-grid">
          {visibleRouters.map((router) => (
            <RouterCard
              canDelete={canDeleteRouter}
              canEdit={canEditRouter}
              key={router.id}
              onEdit={() => openEditForm(router)}
              onOpen={() => openRouter(router)}
              onTest={() => void testConnection(router)}
              router={router}
            />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            action={
              canAddRouter ? (
                <Button disabled={!canStartRouterCreation} icon={Plus} onClick={openAddForm} variant="primary">
                  Ajouter routeur
                </Button>
              ) : null
            }
            description="Aucun routeur ne correspond à votre recherche."
            icon={Router}
            title="Aucun routeur"
          />
        </Card>
      )}

      <ConnectionChoiceDialog
        onCancel={() => setSelectedRouter(null)}
        onLocal={() => enterRouter("local")}
        onRemote={() => enterRouter(selectedRouter?.preferredMode === "local" ? "distant_ip" : selectedRouter?.preferredMode ?? "distant_ip")}
        router={selectedRouter}
      />

      <RouterScanDialog
        onCancel={() => setScanState({ error: null, isOpen: false, isScanning: false, results: [] })}
        onScan={() => void scanLocalNetwork()}
        onSelect={useScannedRouter}
        scanState={scanState}
      />

      <RouterFormDialog
        formState={formState}
        logsCount={logs.length}
        onCancel={() => setFormState(null)}
        onChange={(values) => formState && setFormState({ ...formState, error: null, values })}
        onSubmit={() => void submitForm()}
        onTest={() => void testFormConnection()}
      />
    </div>
  );
}

type RouterCardProps = {
  canDelete: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onOpen: () => void;
  onTest: () => void;
  router: RouterCardData;
};

function RouterCard({ canDelete, canEdit, onEdit, onOpen, onTest, router }: RouterCardProps) {
  const menuItems = [
    { icon: Laptop, label: "Connexion locale", onSelect: onOpen },
    { icon: Wifi, label: "Connexion à distance", onSelect: onOpen },
    { icon: Search, label: "Tester la connexion", onSelect: onTest },
    ...(canEdit ? [{ icon: Edit3, label: "Modifier", onSelect: onEdit }] : []),
    ...(canDelete ? [{ icon: Trash2, label: "Supprimer", onSelect: () => undefined }] : []),
    { icon: Eye, label: "Voir détails", onSelect: onOpen }
  ];

  return (
    <article className="router-card" onClick={onOpen} role="button" tabIndex={0}>
      <header className="router-card__header">
        <div className="router-card__icon">
          <Router aria-hidden="true" />
        </div>
        <div>
          <h3>{router.zoneName}</h3>
          <p>{router.model}</p>
        </div>
        <ActionMenu items={menuItems} />
      </header>

      <div className="router-card__status">
        {router.status === "active" ? (
          <StatusDot label={statusLabels[router.status]} status="active" />
        ) : (
          <Badge status={router.status === "offline" ? "offline" : "warning"}>
            {statusLabels[router.status]}
          </Badge>
        )}
      </div>

      <dl className="router-card__details">
        <div>
          <dt>Carte</dt>
          <dd>{router.boardName}</dd>
        </div>
        <div>
          <dt>Série</dt>
          <dd>{router.serialNumber}</dd>
        </div>
        <div>
          <dt>Adresse IP</dt>
          <dd>{router.ipAddress}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{connectionModeLabel(router.preferredMode)}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{router.routerOsVersion}</dd>
        </div>
        <div>
          <dt>Dernière connexion</dt>
          <dd>{router.lastSeenAt}</dd>
        </div>
        <div>
          <dt>Dernier test</dt>
          <dd>{router.lastTestMessage ?? "Non testé"}</dd>
        </div>
      </dl>
    </article>
  );
}

type ConnectionChoiceDialogProps = {
  onCancel: () => void;
  onLocal: () => void;
  onRemote: () => void;
  router: RouterCardData | null;
};

function ConnectionChoiceDialog({ onCancel, onLocal, onRemote, router }: ConnectionChoiceDialogProps) {
  if (!router) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="connection-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon">
            <Router aria-hidden="true" />
          </div>
          <div>
            <h2>{router.zoneName}</h2>
            <p>
              {router.ipAddress} · {router.model}
            </p>
          </div>
        </header>

        <div className="connection-options">
          <button className="connection-option" onClick={onLocal} type="button">
            <Laptop aria-hidden="true" />
            <span>
              <strong>Connexion locale</strong>
              <small>Utilisée quand ce PC est sur le même réseau que le routeur.</small>
            </span>
          </button>
          <button className="connection-option" onClick={onRemote} type="button">
            <Wifi aria-hidden="true" />
            <span>
              <strong>Connexion à distance</strong>
              <small>
                {connectionModeLabel(router.preferredMode === "local" ? "distant_ip" : router.preferredMode)}
                {router.remoteHost ? ` · ${router.remoteHost}:${router.remotePort}` : " · adresse distante à renseigner"}
              </small>
            </span>
          </button>
        </div>

        <div className="form-error">
          <AlertTriangle aria-hidden="true" />
          <span>{remoteSecurityWarnings.join(" ")}</span>
        </div>

        <div className="confirm-dialog__actions">
          <Button icon={WifiOff} onClick={onCancel} variant="ghost">
            Annuler
          </Button>
        </div>
      </section>
    </div>
  );
}

type RouterScanDialogProps = {
  onCancel: () => void;
  onScan: () => void;
  onSelect: (router: DiscoveredRouterCandidate) => void;
  scanState: ScanState;
};

function RouterScanDialog({ onCancel, onScan, onSelect, scanState }: RouterScanDialogProps) {
  if (!scanState.isOpen) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="connection-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon">
            <Radar aria-hidden="true" />
          </div>
          <div>
            <h2>Recherche Wi-Fi</h2>
            <p>Connectez ce PC au Wi-Fi du routeur, puis lancez la recherche.</p>
          </div>
        </header>

        <div className="data-list">
          {scanState.results.map((router) => (
            <button className="connection-option" key={router.id} onClick={() => onSelect(router)} type="button">
              <Router aria-hidden="true" />
              <span>
                <strong>{router.systemInfo.model}</strong>
                <small>
                  {router.host} · {router.systemInfo.boardName} · RouterOS {router.systemInfo.routerOsVersion}
                </small>
              </span>
            </button>
          ))}
        </div>

        {scanState.results.length === 0 && !scanState.isScanning ? (
          <p className="form-error">Aucun routeur detecte pour le moment.</p>
        ) : null}
        {scanState.error ? <p className="form-error">{scanState.error}</p> : null}

        <div className="confirm-dialog__actions">
          <Button onClick={onCancel} variant="ghost">
            Annuler
          </Button>
          <Button icon={RefreshCw} onClick={onScan} variant="primary">
            {scanState.isScanning ? "Recherche en cours" : "Lancer la recherche"}
          </Button>
        </div>
      </section>
    </div>
  );
}

type RouterFormDialogProps = {
  formState: RouterFormState | null;
  logsCount: number;
  onCancel: () => void;
  onChange: (values: RouterFormValues) => void;
  onSubmit: () => void;
  onTest: () => void;
};

function RouterFormDialog({ formState, logsCount, onCancel, onChange, onSubmit, onTest }: RouterFormDialogProps) {
  if (!formState) {
    return null;
  }

  const values = formState.values;
  const remoteMode = isRemoteConnectionMode(values.preferredMode);

  const update = (partial: Partial<RouterFormValues>) => onChange({ ...values, ...partial });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" className="router-form-dialog" role="dialog">
        <header className="connection-dialog__header">
          <div className="router-card__icon">
            <Router aria-hidden="true" />
          </div>
          <div>
            <h2>{formState.mode === "add" ? "Ajouter routeur" : "Modifier routeur"}</h2>
            <p>Choisissez local, IP distante, VPN ou agent futur.</p>
          </div>
        </header>

        <div className="router-form-grid">
          <label className="form-field">
            Nom du routeur
            <input value={values.name} onChange={(event) => update({ name: event.target.value })} />
          </label>
          <label className="form-field">
            Modèle optionnel
            <input value={values.model} onChange={(event) => update({ model: event.target.value })} />
          </label>
          <label className="form-field">
            Adresse IP locale
            <input value={values.ipAddress} onChange={(event) => update({ ipAddress: event.target.value })} />
          </label>
          <label className="form-field">
            Port API
            <input value={values.apiPort} onChange={(event) => update({ apiPort: event.target.value })} />
          </label>
          <label className="form-field">
            Port API SSL
            <input value={values.apiSslPort} onChange={(event) => update({ apiSslPort: event.target.value })} />
          </label>
          <label className="form-field">
            Utilisateur MikroTik
            <input value={values.username} onChange={(event) => update({ username: event.target.value })} />
          </label>
          <PasswordField
            autoComplete="new-password"
            label="Mot de passe MikroTik"
            onChange={(password) => update({ password })}
            placeholder={formState.mode === "edit" ? "Laisser vide pour conserver" : ""}
            value={values.password}
          />
          <label className="form-field">
            Mode préféré
            <select
              value={values.preferredMode}
              onChange={(event) => update({ preferredMode: event.target.value as RouterFormValues["preferredMode"] })}
            >
              <option value="local">Connexion locale</option>
              <option value="distant_ip">Adresse distante</option>
              <option value="vpn">VPN</option>
              <option value="agent_future">Agent distant futur</option>
            </select>
          </label>
          {remoteMode ? (
            <>
              <label className="form-field">
                Adresse distante
                <input value={values.remoteHost} onChange={(event) => update({ remoteHost: event.target.value })} />
              </label>
              <label className="form-field">
                Port distant
                <input value={values.remotePort} onChange={(event) => update({ remotePort: event.target.value })} />
              </label>
              <label className="toggle-option">
                <input
                  checked={values.remoteUseSsl}
                  onChange={(event) =>
                    update({ remotePort: event.target.checked ? "8729" : "8728", remoteUseSsl: event.target.checked })
                  }
                  type="checkbox"
                />
                <Wifi aria-hidden="true" />
                <span>Utiliser API SSL</span>
              </label>
            </>
          ) : null}
          <label className="form-field router-form-notes">
            Notes internes
            <textarea value={values.notes} onChange={(event) => update({ notes: event.target.value })} />
          </label>
        </div>

        {remoteMode ? (
          <div className="form-error">
            <AlertTriangle aria-hidden="true" />
            <span>{remoteSecurityWarnings.join(" ")}</span>
          </div>
        ) : null}

        {formState.detectedInfo ? (
          <div className="router-form-result">
            <Badge status="success">Infos recuperees</Badge>
            <span>
              {formState.detectedInfo.model} · {formState.detectedInfo.boardName} · RouterOS{" "}
              {formState.detectedInfo.routerOsVersion}
            </span>
          </div>
        ) : null}

        <div className="router-form-result">
          <Badge status={formState.testStatus === "connected" ? "success" : "warning"}>
            {formState.testMessage ?? routerTestMessage(formState.testStatus)}
          </Badge>
          <span>Tests enregistrés : {logsCount}</span>
        </div>

        {formState.error ? <p className="form-error">{formState.error}</p> : null}

        <div className="confirm-dialog__actions">
          <Button onClick={onCancel} variant="ghost">
            Annuler
          </Button>
          <Button icon={Search} onClick={onTest}>
            Tester la connexion
          </Button>
          <Button icon={Save} onClick={onSubmit} variant="primary">
            Enregistrer
          </Button>
        </div>
      </section>
    </div>
  );
}

function inferConnectionError({
  host,
  mode,
  password,
  statusHint
}: {
  host: string;
  mode: RouterFormValues["preferredMode"];
  password: string;
  statusHint?: RouterCardData["status"];
}): RouterErrorCode | null {
  const normalizedHost = host.trim();

  if (mode === "agent_future") {
    return "remote_unavailable";
  }

  if (isRemoteConnectionMode(mode) && !normalizedHost) {
    return "remote_not_configured";
  }

  if (mode === "vpn" && normalizedHost.includes("public")) {
    return "vpn_required";
  }

  if (password.trim().toLowerCase() === "incorrect") {
    return "authentication_failed";
  }

  if (normalizedHost.endsWith(".254")) {
    return "timeout";
  }

  if (normalizedHost.startsWith("10.10.") || statusHint === "warning") {
    return "api_disabled";
  }

  if (statusHint === "offline") {
    return "router_offline";
  }

  return null;
}

function applyTestResult(
  router: RouterCardData,
  status: RouterConnectionTestStatus,
  message: string | null,
  systemInfo: RouterSystemInfo | null = null
): RouterCardData {
  return {
    ...router,
    boardName: systemInfo?.boardName ?? router.boardName,
    lastSeenAt: status === "connected" ? "Maintenant" : router.lastSeenAt,
    lastTestMessage: message,
    lastTestStatus: status,
    lastTestedAt: "Maintenant",
    model: systemInfo?.model ?? router.model,
    remoteEnabled: status === "connected" || router.remoteEnabled,
    routerOsVersion: systemInfo?.routerOsVersion ?? router.routerOsVersion,
    serialNumber: systemInfo?.serialNumber ?? router.serialNumber,
    status: status === "connected" ? "active" : status === "offline" ? "offline" : "warning"
  };
}

function validateRouterForm(formState: RouterFormState): string | null {
  const testError = validateRouterFormForTest(formState.values);

  if (testError) {
    return testError;
  }

  if (formState.mode === "add" && !formState.values.password.trim()) {
    return "Entrez le mot de passe du routeur.";
  }

  return null;
}

function validateRouterFormForTest(values: RouterFormValues): string | null {
  if (!values.name.trim()) {
    return "Entrez le nom du routeur.";
  }

  if (!values.ipAddress.trim()) {
    return "Entrez l’adresse IP locale.";
  }

  if (!values.username.trim()) {
    return "Entrez l’utilisateur MikroTik.";
  }

  if (!Number(values.apiPort) || !Number(values.apiSslPort)) {
    return "Entrez des ports valides.";
  }

  if (isRemoteConnectionMode(values.preferredMode)) {
    if (values.preferredMode !== "agent_future" && !values.remoteHost.trim()) {
      return "Entrez l'adresse distante.";
    }

    if (!Number(values.remotePort)) {
      return "Entrez un port distant valide.";
    }
  }

  return null;
}
