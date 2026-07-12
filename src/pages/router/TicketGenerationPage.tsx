import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, FileText, Hash, Printer, QrCode, Ticket } from "lucide-react";
import type { HotspotPlan, RouterSummary } from "../../domain/router";
import type { CreateGeneratedFileInput, CreateTicketInput, SyncStatus } from "../../domain/database";
import type { UserRole } from "../../domain/auth";
import { useAuth } from "../../app/auth/AuthProvider";
import { AuthorizationError, requireProfilePermission } from "../../services/auth";
import { FakeRouterAdapter, RouterService, RouterServiceError, type RouterActionLog } from "../../services/router";
import { GeneratedFileRepository, InMemoryDatabaseClient } from "../../services/database";
import { buildGeneratedTicketPdfRecord, generateTicketPdf, resolveTicketPdfPassword } from "../../services/pdf";
import {
  LocalPrintService,
  printFormatLabel,
  printerStatusLabel,
  type LocalPrinter,
  type PrintHistoryEntry,
  type PrintPaperFormat,
  type PrintSettings
} from "../../services/printing";
import { Badge, Button, Card, FilterButton, PageHeader, StatCard } from "../../shared/ui";
import type { AppStatus, IconComponent } from "../../shared/ui";
import {
  buildFileName,
  buildTicketBatch,
  buildTicketPdfInputFromOptions,
  buildTicketRecord,
  createBatchId,
  createInitialTicketGenerationState,
  defaultTicketGenerationOptions,
  getSelectedQuantity,
  getTicketSummary,
  normalizePrefix,
  quickQuantities,
  roleLabel,
  syncStatusLabel,
  ticketPdfFormatLabels,
  ticketPdfTemplateLabels,
  ticketStatusLabel,
  ticketStatuses,
  userToTicketRecord,
  validateTicketGeneration,
  type TicketGenerationResult,
  type TicketGenerationState,
  type TicketGenerationStep,
  type TicketStatus
} from "./ticketGenerationModel";
import { TicketCodeGenerator } from "../../services/tickets";

const stepLabels = [
  "Routeur",
  "Plan",
  "Quantité",
  "Options",
  "Confirmation",
  "Résultat"
] as const;

export function TicketGenerationPage() {
  const { routerId = "routeur-demo" } = useParams();
  const { session } = useAuth();
  const [state, setState] = useState<TicketGenerationState>(() => createInitialTicketGenerationState(routerId));
  const [routers, setRouters] = useState<RouterSummary[]>([]);
  const [plans, setPlans] = useState<HotspotPlan[]>([]);
  const [tickets, setTickets] = useState<CreateTicketInput[]>([]);
  const [result, setResult] = useState<TicketGenerationResult | null>(null);
  const [logs, setLogs] = useState<RouterActionLog[]>([]);
  const [generatedFile, setGeneratedFile] = useState<CreateGeneratedFileInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [printers, setPrinters] = useState<LocalPrinter[]>([]);
  const [printSettings, setPrintSettings] = useState<PrintSettings>({
    economical: true,
    format: "thermal80",
    printerId: "pdf-export"
  });
  const [printHistory, setPrintHistory] = useState<PrintHistoryEntry[]>([]);

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
  const codeGenerator = useMemo(() => new TicketCodeGenerator(), []);
  const printService = useMemo(() => new LocalPrintService(), []);
  const generatedFiles = useMemo(() => {
    const database = new InMemoryDatabaseClient();
    void database.initialize();
    return new GeneratedFileRepository(database);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      const [routerList, planList, printerList] = await Promise.all([
        service.listRouters(),
        service.getHotspotPlans(),
        printService.detectPrinters()
      ]);

      if (!mounted) {
        return;
      }

      const defaultPrinter = printService.getDefaultPrinter(printerList);
      setRouters(routerList);
      setPlans(planList);
      setPrinters(printerList);
      setPrintSettings((current) => ({ ...current, printerId: defaultPrinter?.id ?? current.printerId }));
      setState((current) => ({
        ...current,
        selectedPlanId: current.selectedPlanId || planList.find((plan) => plan.status === "active")?.id || "",
        selectedRouterId: routerList.some((router) => router.id === current.selectedRouterId)
          ? current.selectedRouterId
          : routerList[0]?.id ?? current.selectedRouterId
      }));
    }

    void loadData();

    return () => {
      mounted = false;
    };
  }, [printService, service]);

  const selectedRouter = routers.find((router) => router.id === state.selectedRouterId) ?? routers[0] ?? null;
  const selectedPlan = plans.find((plan) => plan.id === state.selectedPlanId) ?? null;
  const quantity = getSelectedQuantity(state);
  const summary =
    session && selectedRouter && selectedPlan && Number.isFinite(quantity)
      ? getTicketSummary({
          operatorRole: session.internal_profile_role,
          plan: selectedPlan,
          quantity,
          router: selectedRouter,
          syncStatus: result?.syncStatus ?? "pending"
        })
      : null;

  const updateState = (partial: Partial<TicketGenerationState>) => {
    setError(null);
    setMessage(null);
    setState((current) => ({ ...current, ...partial }));
  };

  const goNext = () => {
    if (state.step === 5) {
      void generateTickets();
      return;
    }

    const stepError = validateStep(state.step, state, routers, plans);

    if (stepError) {
      setError(stepError);
      return;
    }

    updateState({ step: (state.step + 1) as TicketGenerationStep });
  };

  const goBack = () => {
    if (state.step <= 1 || isGenerating) {
      return;
    }

    updateState({ step: (state.step - 1) as TicketGenerationStep });
  };

  const generateTickets = async () => {
    try {
      requireProfilePermission(session, "router.tickets.generate");
    } catch (permissionError) {
      setError(permissionError instanceof AuthorizationError ? permissionError.message : "Vous n'avez pas la permission de générer des tickets.");
      return;
    }

    const validationError = validateTicketGeneration(state, routers, plans);

    if (validationError || !selectedPlan || !selectedRouter || !session) {
      setError(validationError ?? "La génération n'est pas prête.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setMessage(null);

    const batchId = createBatchId();
    const requestedQuantity = getSelectedQuantity(state);
    const succeededTickets: CreateTicketInput[] = [];
    const failedTickets: CreateTicketInput[] = [];

    try {
      const existingUsers = await service.listHotspotUsers();
      const generatedCredentials = codeGenerator.generate({
        alphabet: "numeric",
        codeLength: state.options.codeLength,
        excludeAmbiguous: state.options.excludeAmbiguous,
        existingTickets: existingUsers,
        prefix: state.options.prefix,
        quantity: requestedQuantity,
        routerId: state.selectedRouterId,
        usernameEqualsPassword: state.options.usernameEqualsPassword
      }).codes;

      for (const credential of generatedCredentials) {
        try {
          const createdUser = await service.createHotspotUser({
            comment: `Lot ${batchId}`,
            passwordSecretRef: credential.passwordSecretRef,
            planId: state.selectedPlanId,
            username: credential.username
          });

          succeededTickets.push(
            userToTicketRecord({
              accountId: session.account_id,
              batchId,
              createdByProfileId: session.internal_profile_id,
              createdByProfile: session.internal_profile_role,
              routerId: state.selectedRouterId,
              user: createdUser
            })
          );
        } catch (creationError) {
          failedTickets.push(
            buildTicketRecord({
              accountId: session.account_id,
              batchId,
              createdByProfileId: session.internal_profile_id,
              createdByProfile: session.internal_profile_role,
              mikrotikId: null,
              passwordSecretRef: credential.passwordSecretRef,
              planId: state.selectedPlanId,
              routerId: state.selectedRouterId,
              status: "erreur_sync",
              syncStatus: "conflict",
              username: credential.username
            })
          );

          if (!(creationError instanceof RouterServiceError)) {
            throw creationError;
          }
        }
      }

      const syncStatus: SyncStatus = failedTickets.length > 0 ? "conflict" : "synced";
      const batch = buildTicketBatch({
        accountId: session.account_id,
        id: batchId,
        operatorProfileId: session.internal_profile_id,
        operatorRole: session.internal_profile_role,
        options: state.options,
        planId: state.selectedPlanId,
        quantity: requestedQuantity,
        routerId: state.selectedRouterId,
        syncStatus
      });
      const fileName = state.options.createPdf ? buildFileName(batchId) : null;

      setTickets([...succeededTickets, ...failedTickets]);
      setGeneratedFile(null);
      setResult({
        batch,
        failedTickets,
        fileName,
        statusLabel: syncStatusLabel(syncStatus),
        succeededTickets,
        syncStatus,
        totalValue: selectedPlan.priceHint === null ? null : selectedPlan.priceHint * requestedQuantity
      });
      setState((current) => ({ ...current, step: 6 }));
      setMessage(
        failedTickets.length > 0
          ? `${succeededTickets.length} ticket(s) créés, ${failedTickets.length} en erreur.`
          : `${succeededTickets.length} ticket(s) créés avec succès.`
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "La génération des tickets a échoué."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const primaryActionLabel =
    state.step === 5 ? `Créer ${Number.isFinite(quantity) ? quantity : 0} tickets` : "Continuer";

  const generatePdf = async () => {
    if (!result || !selectedPlan || !selectedRouter || !result.fileName) {
      setMessage("Aucun PDF à générer pour ce lot.");
      return;
    }

    const pdfInput = buildTicketPdfInputFromOptions({
      batch: result.batch,
      fileName: result.fileName,
      generatedAt: new Date().toISOString(),
      options: state.options,
      plan: selectedPlan,
      router: selectedRouter,
      tickets
    });
    const pdfBytes = generateTicketPdf(pdfInput);
    const fileRecord = buildGeneratedTicketPdfRecord(pdfInput);

    await generatedFiles.create(fileRecord);
    downloadPdf(pdfInput.fileName, pdfBytes);
    setGeneratedFile(fileRecord);
    setMessage(`${pdfInput.fileName} généré et enregistré dans les fichiers.`);
  };

  const printBatch = async () => {
    if (!result || !selectedPlan || !selectedRouter) {
      setMessage("Aucun lot à imprimer.");
      return;
    }

    const printTickets = tickets.map((ticket) =>
      buildPrintTicketFromGeneratedTicket(ticket, selectedPlan, selectedRouter.name, result.batch.id)
    );
    const printResult = await printService.printBatch({ printers, settings: printSettings, tickets: printTickets });

    setPrintHistory((current) => [printResult.historyEntry, ...current]);
    setMessage(printResult.userMessage);

    if (!printResult.ok) {
      return;
    }

    const printedIds = new Set(printResult.printedTicketIds);
    setTickets((current) =>
      current.map((ticket) =>
        printedIds.has(ticket.id)
          ? { ...ticket, printed_count: ticket.printed_count + 1, status: "imprimé" }
          : ticket
      )
    );
  };

  const testPrinter = async () => {
    const printResult = await printService.testPrinter({ printers, settings: printSettings });
    setPrintHistory((current) => [printResult.historyEntry, ...current]);
    setMessage(printResult.userMessage);
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <Button disabled={isGenerating || state.step !== 5} icon={Ticket} onClick={() => void generateTickets()} size="large" variant="primary">
            Créer les tickets
          </Button>
        }
        description="Assistant rapide pour créer un lot de tickets numériques à partir d'un plan."
        eyebrow="Routeur"
        title="Créer des tickets"
      />

      <WizardSteps currentStep={state.step} />

      {message ? <p className="form-error form-error--success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {state.step === 1 ? (
        <StepRouter routers={routers} selectedRouterId={state.selectedRouterId} onSelect={(selectedRouterId) => updateState({ selectedRouterId })} />
      ) : null}
      {state.step === 2 ? (
        <StepPlan plans={plans} selectedPlanId={state.selectedPlanId} onSelect={(selectedPlanId) => updateState({ selectedPlanId })} />
      ) : null}
      {state.step === 3 ? (
        <StepQuantity state={state} onChange={updateState} />
      ) : null}
      {state.step === 4 ? (
        <StepOptions state={state} onChange={updateState} />
      ) : null}
      {state.step === 5 && selectedPlan && selectedRouter && summary ? (
        <StepConfirmation
          logsCount={logs.length}
          options={state.options}
          plan={selectedPlan}
          quantity={quantity}
          router={selectedRouter}
          summary={summary}
        />
      ) : null}
      {state.step === 6 && result && selectedPlan && selectedRouter ? (
        <StepResult
          generatedFile={generatedFile}
          onPdf={() => void generatePdf()}
          onPrint={() => void printBatch()}
          onTestPrinter={() => void testPrinter()}
          onUpdatePrintSettings={(partial) => setPrintSettings((current) => ({ ...current, ...partial }))}
          plan={selectedPlan}
          printHistory={printHistory}
          printers={printers}
          printSettings={printSettings}
          result={result}
          router={selectedRouter}
          tickets={tickets}
        />
      ) : null}

      <div className="wizard-actions">
        <Button disabled={state.step === 1 || isGenerating} icon={ChevronLeft} onClick={goBack} variant="ghost">
          Retour
        </Button>
        {state.step < 6 ? (
          <Button disabled={isGenerating} icon={state.step === 5 ? Ticket : ChevronRight} onClick={goNext} variant="primary">
            {isGenerating ? "Création en cours..." : primaryActionLabel}
          </Button>
        ) : (
          <Button
            icon={Ticket}
            onClick={() => {
              setResult(null);
              setTickets([]);
              updateState({ step: 2, quantity: 20, customQuantity: "20", options: defaultTicketGenerationOptions });
              setGeneratedFile(null);
            }}
            variant="primary"
          >
            Nouveau lot
          </Button>
        )}
      </div>
    </div>
  );
}

function WizardSteps({ currentStep }: { currentStep: TicketGenerationStep }) {
  return (
    <Card>
      <ol className="wizard-steps">
        {stepLabels.map((label, index) => {
          const step = (index + 1) as TicketGenerationStep;
          const stateClass = step === currentStep ? "active" : step < currentStep ? "done" : "idle";

          return (
            <li className={`wizard-step wizard-step--${stateClass}`} key={label}>
              <span>{step < currentStep ? <CheckCircle2 aria-hidden="true" /> : step}</span>
              <strong>{label}</strong>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function StepRouter({
  onSelect,
  routers,
  selectedRouterId
}: {
  onSelect: (routerId: string) => void;
  routers: RouterSummary[];
  selectedRouterId: string;
}) {
  return (
    <Card title="Choisir le routeur actif" description="Le lot sera créé sur le routeur sélectionné.">
      <div className="choice-grid">
        {routers.map((router) => (
          <button
            className={`choice-card ${router.id === selectedRouterId ? "choice-card--selected" : ""}`}
            key={router.id}
            onClick={() => onSelect(router.id)}
            type="button"
          >
            <strong>{router.name}</strong>
            <span>{router.host}</span>
            <Badge status={router.isReachable ? "success" : "offline"}>
              {router.isReachable ? "Connecté" : "Hors ligne"}
            </Badge>
          </button>
        ))}
      </div>
    </Card>
  );
}

function StepPlan({
  onSelect,
  plans,
  selectedPlanId
}: {
  onSelect: (planId: string) => void;
  plans: HotspotPlan[];
  selectedPlanId: string;
}) {
  return (
    <Card title="Choisir le plan" description="Seuls les plans actifs peuvent générer de nouveaux tickets.">
      <div className="choice-grid">
        {plans.map((plan) => (
          <button
            className={`choice-card ${plan.id === selectedPlanId ? "choice-card--selected" : ""}`}
            disabled={plan.status !== "active"}
            key={plan.id}
            onClick={() => onSelect(plan.id)}
            type="button"
          >
            <strong>{plan.name}</strong>
            <span>{plan.durationMinutes} min · {plan.dataLimitMb ? `${plan.dataLimitMb} MB` : "Volume illimité"}</span>
            <span>{plan.priceHint ? `${plan.priceHint} CFA` : "Prix non défini"}</span>
            <Badge status={plan.status === "active" ? "success" : "offline"}>
              {plan.status === "active" ? "Actif" : "Inactif"}
            </Badge>
          </button>
        ))}
      </div>
    </Card>
  );
}

function StepQuantity({
  onChange,
  state
}: {
  onChange: (partial: Partial<TicketGenerationState>) => void;
  state: TicketGenerationState;
}) {
  return (
    <Card title="Choisir la quantité" description="Les quantités rapides permettent de créer un lot en quelques secondes.">
      <div className="filter-row">
        {quickQuantities.map((quantity) => (
          <FilterButton key={quantity} onClick={() => onChange({ quantity, customQuantity: String(quantity) })}>
            {quantity}
          </FilterButton>
        ))}
        <FilterButton onClick={() => onChange({ quantity: "custom" })}>Personnalisé</FilterButton>
      </div>
      <label className="form-field ticket-custom-quantity">
        Quantité personnalisée
        <input
          disabled={state.quantity !== "custom"}
          inputMode="numeric"
          min="1"
          max="500"
          value={state.customQuantity}
          onChange={(event) => onChange({ customQuantity: event.target.value, quantity: "custom" })}
        />
      </label>
    </Card>
  );
}

function StepOptions({
  onChange,
  state
}: {
  onChange: (partial: Partial<TicketGenerationState>) => void;
  state: TicketGenerationState;
}) {
  const updateOptions = (partial: Partial<TicketGenerationState["options"]>) =>
    onChange({ options: { ...state.options, ...partial } });

  return (
    <Card title="Options de génération" description="Les réglages par défaut conviennent pour un lot simple.">
      <div className="router-form-grid">
        <label className="form-field">
          Longueur du code
          <input
            inputMode="numeric"
            value={state.options.codeLength}
            onChange={(event) => updateOptions({ codeLength: Number(event.target.value) })}
          />
        </label>
        <label className="form-field">
          Préfixe optionnel
          <input
            placeholder="Ex. VIP"
            value={state.options.prefix}
            onChange={(event) => updateOptions({ prefix: normalizePrefix(event.target.value) })}
          />
        </label>
      </div>
      <div className="option-list">
        <ToggleOption
          checked={state.options.usernameEqualsPassword}
          icon={Hash}
          label="Identifiant = mot de passe"
          onChange={(checked) => updateOptions({ usernameEqualsPassword: checked })}
        />
        <ToggleOption
          checked={state.options.excludeAmbiguous}
          icon={Hash}
          label="Exclure les chiffres ambigus"
          onChange={(checked) => updateOptions({ excludeAmbiguous: checked })}
        />
        <ToggleOption
          checked={state.options.generateQrCode}
          icon={QrCode}
          label="Générer QR code"
          onChange={(checked) => updateOptions({ generateQrCode: checked })}
        />
        <ToggleOption
          checked={state.options.createPdf}
          icon={FileText}
          label="Créer PDF après génération"
          onChange={(checked) => updateOptions({ createPdf: checked })}
        />
      </div>
      <div className="router-form-grid pdf-options-grid">
        <label className="form-field">
          Format PDF
          <select
            value={state.options.pdfFormat}
            onChange={(event) => updateOptions({ pdfFormat: event.target.value as TicketGenerationState["options"]["pdfFormat"] })}
          >
            {Object.entries(ticketPdfFormatLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          Template
          <select
            value={state.options.pdfTemplate}
            onChange={(event) => updateOptions({ pdfTemplate: event.target.value as TicketGenerationState["options"]["pdfTemplate"] })}
          >
            {Object.entries(ticketPdfTemplateLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          Téléphone support
          <input
            placeholder="Ex. +227 90 00 00 00"
            value={state.options.supportPhone}
            onChange={(event) => updateOptions({ supportPhone: event.target.value })}
          />
        </label>
      </div>
    </Card>
  );
}

function ToggleOption({
  checked,
  icon: Icon,
  label,
  onChange
}: {
  checked: boolean;
  icon: IconComponent;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-option">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

function StepConfirmation({
  logsCount,
  options,
  plan,
  quantity,
  router,
  summary
}: {
  logsCount: number;
  options: TicketGenerationState["options"];
  plan: HotspotPlan;
  quantity: number;
  router: RouterSummary;
  summary: ReturnType<typeof getTicketSummary>;
}) {
  return (
    <div className="page-grid">
      <div className="span-4">
        <StatCard icon={Ticket} label="Quantité" value={String(quantity)} hint="Tickets numériques" />
      </div>
      <div className="span-4">
        <StatCard icon={FileText} label="Valeur totale" value={summary.totalValue === null ? "Non définie" : `${summary.totalValue} CFA`} hint={plan.name} />
      </div>
      <div className="span-4">
        <StatCard icon={CheckCircle2} label="Synchronisation" value={summary.sync} hint={`${logsCount} log(s)`} />
      </div>

      <Card className="span-12" title="Confirmer le lot">
        <div className="summary-grid">
          <SummaryItem label="Plan" value={summary.plan} />
          <SummaryItem label="Quantité" value={String(summary.quantity)} />
          <SummaryItem label="Routeur" value={`${summary.router} · ${router.host}`} />
          <SummaryItem label="Opérateur" value={summary.operator} />
          <SummaryItem label="Code" value={`${options.prefix ? `${options.prefix} + ` : ""}${options.codeLength} chiffres`} />
          <SummaryItem label="PDF" value={options.createPdf ? "Oui" : "Non"} />
        </div>
      </Card>

    </div>
  );
}

function StepResult({
  generatedFile,
  onPdf,
  onPrint,
  onTestPrinter,
  onUpdatePrintSettings,
  plan,
  printHistory,
  printers,
  printSettings,
  result,
  router,
  tickets
}: {
  generatedFile: CreateGeneratedFileInput | null;
  onPdf: () => void;
  onPrint: () => void;
  onTestPrinter: () => void;
  onUpdatePrintSettings: (settings: Partial<PrintSettings>) => void;
  plan: HotspotPlan;
  printHistory: PrintHistoryEntry[];
  printers: LocalPrinter[];
  printSettings: PrintSettings;
  result: TicketGenerationResult;
  router: RouterSummary;
  tickets: CreateTicketInput[];
}) {
  const printTickets = tickets.map((ticket) =>
    buildPrintTicketFromGeneratedTicket(ticket, plan, router.name, result.batch.id)
  );
  const preview = new LocalPrintService().buildPreview(printTickets, printSettings);

  return (
    <div className="page-grid">
      <div className="span-4">
        <StatCard icon={Ticket} label="Créés" value={String(result.succeededTickets.length)} hint="Disponibles" />
      </div>
      <div className="span-4">
        <StatCard icon={CheckCircle2} label="Statut" value={result.statusLabel} hint={router.name} />
      </div>
      <div className="span-4">
        <StatCard icon={FileText} label="Valeur" value={result.totalValue === null ? "Non définie" : `${result.totalValue} CFA`} hint={plan.name} />
      </div>

      <Card
        actions={
          <div className="button-row">
            <Button disabled={!result.fileName} icon={FileText} onClick={onPdf} variant="secondary">
              PDF
            </Button>
            <Button icon={Printer} onClick={onPrint} variant="secondary">
              Impression
            </Button>
          </div>
        }
        className="span-12"
        title="Résultat"
        description={
          generatedFile
            ? `${generatedFile.file_name} enregistré dans les fichiers.`
            : result.fileName
              ? `${result.fileName} prêt à générer.`
              : "Aucun PDF demandé pour ce lot."
        }
      >
        <div className="summary-grid">
          <SummaryItem label="Plan" value={plan.name} />
          <SummaryItem label="Quantité" value={String(result.batch.quantity)} />
          <SummaryItem label="Routeur" value={router.name} />
          <SummaryItem label="Opérateur" value={roleLabel(result.batch.operator_profile as UserRole)} />
          <SummaryItem label="Statut de synchronisation" value={result.statusLabel} />
          <SummaryItem label="Échecs" value={String(result.failedTickets.length)} />
        </div>
        <div className="ticket-preview-list">
          {tickets.slice(0, 8).map((ticket) => (
            <div className="ticket-preview-item" key={ticket.id}>
              <strong>{ticket.username}</strong>
              <Badge status={statusToBadge(ticket.status)}>
                {ticketStatusLabel(ticket.status as TicketStatus)}
              </Badge>
            </div>
          ))}
        </div>
        <div className="status-legend">
          {ticketStatuses.map((status) => (
            <Badge key={status} status={ticketStatusToBadge(status)}>
              {ticketStatusLabel(status)}
            </Badge>
          ))}
        </div>
      </Card>

      <Card
        actions={
          <div className="button-row">
            <Button icon={Printer} onClick={onTestPrinter}>
              Tester imprimante
            </Button>
            <Button icon={Printer} onClick={onPrint} variant="primary">
              Imprimer le lot
            </Button>
          </div>
        }
        className="span-12"
        title="Préparation impression"
        description="Préparez une impression thermique tout en gardant l'export PDF disponible."
      >
        <div className="print-setup-grid">
          <label className="form-field">
            Imprimante
            <select value={printSettings.printerId} onChange={(event) => onUpdatePrintSettings({ printerId: event.target.value })}>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name} - {printerStatusLabel(printer.status)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Format
            <select
              value={printSettings.format}
              onChange={(event) => onUpdatePrintSettings({ format: event.target.value as PrintPaperFormat })}
            >
              <option value="thermal58">58 mm</option>
              <option value="thermal80">80 mm</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label className="toggle-option print-economy-toggle">
            <input
              checked={printSettings.economical}
              onChange={(event) => onUpdatePrintSettings({ economical: event.target.checked })}
              type="checkbox"
            />
            <Printer aria-hidden="true" />
            <span>Impression économique</span>
          </label>
        </div>

        <div className="print-preview-layout">
          <div className="print-preview-ticket">
            <span>Aperçu {preview.paperWidthLabel}</span>
            {preview.lines.map((line) => (
              <strong key={line}>{line}</strong>
            ))}
          </div>
          <div className="print-history-list">
            <h3>Historique d'impression</h3>
            {printHistory.length > 0 ? (
              printHistory.slice(0, 4).map((entry) => (
                <div className="print-history-row" key={entry.id}>
                  <strong>{entry.userMessage}</strong>
                  <span>
                    {entry.printerName} · {printFormatLabel(entry.format)} · {entry.ticketCount} ticket(s)
                  </span>
                </div>
              ))
            ) : (
              <p>Aucune impression préparée pour ce lot.</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function downloadPdf(fileName: string, bytes: Uint8Array) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildPrintTicketFromGeneratedTicket(
  ticket: CreateTicketInput,
  plan: HotspotPlan,
  zoneName: string,
  batchId: string
) {
  return {
    batchId,
    code: ticket.username,
    dataLimitLabel: plan.dataLimitMb ? `${plan.dataLimitMb} MB` : null,
    durationLabel: plan.durationMinutes >= 60 && plan.durationMinutes % 60 === 0 ? `${plan.durationMinutes / 60} h` : `${plan.durationMinutes} min`,
    id: ticket.id,
    passwordLabel: resolveTicketPdfPassword({
      passwordSecretRef: ticket.password_encrypted,
      username: ticket.username
    }),
    planName: plan.name,
    zoneName
  };
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function validateStep(
  step: TicketGenerationStep,
  state: TicketGenerationState,
  routers: RouterSummary[],
  plans: HotspotPlan[]
): string | null {
  if (step === 1 && !routers.some((router) => router.id === state.selectedRouterId)) {
    return "Choisissez un routeur.";
  }

  if (step === 2 && !plans.some((plan) => plan.id === state.selectedPlanId && plan.status === "active")) {
    return "Choisissez un plan actif.";
  }

  if (step === 3) {
    const quantity = getSelectedQuantity(state);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      return "Choisissez une quantité entre 1 et 500.";
    }
  }

  if (step === 4) {
    return validateTicketGeneration(state, routers, plans);
  }

  return null;
}

function ticketStatusToBadge(status: string): AppStatus {
  if (status === "erreur_sync") {
    return "error";
  }

  if (status === "activé") {
    return "active";
  }

  if (status === "imprimé") {
    return "warning";
  }

  if (status === "disponible" || status === "complété") {
    return "success";
  }

  return "offline";
}

function statusToBadge(status: string): AppStatus {
  return ticketStatusToBadge(status);
}
