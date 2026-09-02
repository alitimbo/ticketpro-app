import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Download,
  FileDown,
  FileText,
  Filter,
  FolderOpen,
  Printer,
  RefreshCw,
  Trash2
} from "lucide-react";
import { useAuth } from "../../app/auth/AuthProvider";
import {
  GeneratedFileRepository,
  HotspotPlanRepository,
  AccountRepository,
  PrintHistoryRepository,
  RouterRepository,
  TicketRepository,
  TicketBatchRepository,
  useAppDatabase
} from "../../services/database";
import { TauriFileService } from "../../services/files";
import { AuditLogService } from "../../services/logging";
import { OrganizationOperationsSyncService, OrganizationTicketCatalogService } from "../../services/sync";
import {
  applyArchivedTicketTimingSnapshots,
  createTicketPrintArchivePayload,
  generateTicketPdf,
  RecoveredVoucherBatchPdfService,
  regenerateArchivedTicketPdf,
  ticketPdfInputFromPrintArchive
} from "../../services/pdf";
import {
  ActionMenu,
  AsyncStateCard,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  StatCard
} from "../../shared/ui";
import type { AppStatus, IconComponent } from "../../shared/ui";
import {
  createDemoArchivedFiles,
  archivedFileFromRecord,
  emptyFileFilters,
  fileStatusLabel,
  fileTypeLabel,
  filterArchivedFiles,
  formatFileDate,
  profileLabel,
  scopeFilesForSession,
  type ArchivedGeneratedFile,
  type FileFilters,
  type GeneratedFileType
} from "./filesPageModel";

export function FilesPage() {
  const { saasAccount, session } = useAuth();
  const { database, isInitialized, isPersistent } = useAppDatabase();
  const [files, setFiles] = useState<ArchivedGeneratedFile[]>(() => (isPersistent ? [] : createDemoArchivedFiles()));
  const [filters, setFilters] = useState<FileFilters>(emptyFileFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(isPersistent);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<ArchivedGeneratedFile | null>(null);
  const migratedRouterIdsRef = useRef(new Set<string>());
  const filesLoadRunningRef = useRef(false);
  const loadedFilesScopeRef = useRef<string | null>(null);
  const generatedFileRepository = useMemo(() => new GeneratedFileRepository(database), [database]);
  const accountRepository = useMemo(() => new AccountRepository(database), [database]);
  const auditLogService = useMemo(() => new AuditLogService(database), [database]);
  const printHistoryRepository = useMemo(() => new PrintHistoryRepository(database), [database]);
  const routerRepository = useMemo(() => new RouterRepository(database), [database]);
  const planRepository = useMemo(() => new HotspotPlanRepository(database), [database]);
  const batchRepository = useMemo(() => new TicketBatchRepository(database), [database]);
  const ticketRepository = useMemo(() => new TicketRepository(database), [database]);
  const fileService = useMemo(() => new TauriFileService(), []);
  const organizationOperations = useMemo(
    () => session
      ? new OrganizationOperationsSyncService(
          database,
          session.account_id,
          session.internal_profile_id,
          session.internal_profile_role
        )
      : null,
    [database, session]
  );
  const organizationTicketCatalog = useMemo(
    () => session
      ? new OrganizationTicketCatalogService(
          database,
          session.account_id,
          session.internal_profile_id,
          session.internal_profile_role
        )
      : null,
    [database, session]
  );
  const recoveredBatchPdfs = useMemo(
    () => session
      ? new RecoveredVoucherBatchPdfService(database, fileService, {
          cloudPublisher: organizationOperations ?? undefined
        })
      : null,
    [database, fileService, organizationOperations, session]
  );

  const loadFiles = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!isPersistent || !isInitialized || !session) {
      return;
    }
    if (filesLoadRunningRef.current) return;
    filesLoadRunningRef.current = true;

    if (!options.silent) {
      setIsLoading(true);
      setLoadError(null);
      setSyncWarning(null);
    }

    try {
      const routers = await (saasAccount?.organization.id
          ? routerRepository.listByOrganization(session.account_id, saasAccount.organization.id)
          : routerRepository.listByAccount(session.account_id));

      let pdfRecoveryFailed = false;
      let recoveredPdfCount = 0;
      await Promise.all(routers.map(async (router) => {
        const recovery = await recoveredBatchPdfs?.recoverMissingForRouter(
          session.account_id,
          router.id
        );
        recoveredPdfCount += recovery?.results.filter((result) => result.status === "created").length ?? 0;
        if ((recovery?.failedBatchCount ?? 0) > 0) pdfRecoveryFailed = true;
      }));
      if (recoveredPdfCount > 0) {
        setMessage(`${recoveredPdfCount} PDF interrompu(s) récupéré(s) automatiquement.`);
      }

      const readFiles = async (checkLocalAvailability: boolean) => {
        const [records, batches] = await Promise.all([
          generatedFileRepository.listByAccount(session.account_id),
          batchRepository.listByAccount(session.account_id)
        ]);
        const routerIds = new Set(routers.map((router) => router.id));
        const scopedRecords = records.filter((record) => routerIds.has(record.router_id));
        const scopedBatches = batches.filter((batch) => routerIds.has(batch.router_id));
        const plans = await Promise.all(routers.map((router) => planRepository.listByRouter(router.id)));
        const routerById = new Map(routers.map((router) => [router.id, router]));
        const batchById = new Map(scopedBatches.map((batch) => [batch.id, batch]));
        const planById = new Map(plans.flat().map((plan) => [plan.id, plan]));
        const archived = await Promise.all(
          scopedRecords.map(async (record) => {
            const metadata = checkLocalAvailability
              ? await fileService.metadata(record.file_path).catch(() => null)
              : null;
            const batch = record.batch_id ? batchById.get(record.batch_id) : null;
            const plan = batch ? planById.get(batch.plan_id) : null;

            return archivedFileFromRecord(record, {
              fileExists: metadata?.exists ?? null,
              planId: plan?.id,
              planName: plan?.name,
              routerName: routerById.get(record.router_id)?.name ?? record.router_id,
              ticketQuantity: batch?.quantity
            });
          })
        );

        setFiles(archived);
      };

      const filesScope = `${session.account_id}:${saasAccount?.organization.id ?? "account"}`;
      if (loadedFilesScopeRef.current !== filesScope) {
        setFiles([]);
        // Render SQLite archives first. Network and filesystem checks continue afterwards.
        await readFiles(false);
        loadedFilesScopeRef.current = filesScope;
      }

      let organizationSyncFailed = false;
      await Promise.all(routers.map(async (router) => {
        await organizationTicketCatalog?.pullRouter(router.id).catch(() => {
          organizationSyncFailed = true;
        });
        if (!migratedRouterIdsRef.current.has(router.id)) {
          try {
            await organizationOperations?.publishFiles(router.id);
            migratedRouterIdsRef.current.add(router.id);
          } catch {
            organizationSyncFailed = true;
          }
        }
        await organizationOperations?.pullFiles(router.id).catch(() => {
          organizationSyncFailed = true;
        });
      }));
      await readFiles(true);
      setLoadError(null);
      setSyncWarning(pdfRecoveryFailed
        ? "Un lot confirmé reste sans PDF local. TicketPro réessaiera automatiquement."
        : organizationSyncFailed
        ? "Les fichiers locaux sont affichés, mais la récupération des archives de l'organisation a échoué. TicketPro réessaiera automatiquement."
        : null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Impossible de récupérer les fichiers.";
      setLoadError(detail);
      throw error;
    } finally {
      filesLoadRunningRef.current = false;
      if (!options.silent) setIsLoading(false);
    }
  }, [
    batchRepository,
    fileService,
    generatedFileRepository,
    isInitialized,
    isPersistent,
    organizationOperations,
    organizationTicketCatalog,
    planRepository,
    recoveredBatchPdfs,
    routerRepository,
    saasAccount?.organization.id,
    session
  ]);

  useEffect(() => {
    let mounted = true;

    void loadFiles().catch(() => {
      if (mounted) {
        setMessage("Les fichiers persistants n'ont pas pu être chargés.");
      }
    });

    return () => {
      mounted = false;
    };
  }, [loadFiles]);

  useEffect(() => {
    if (!isPersistent) return undefined;
    const synchronize = () => {
      if (document.visibilityState === "hidden") return;
      void loadFiles({ silent: true }).catch(() => undefined);
    };
    const interval = window.setInterval(synchronize, 15_000);
    window.addEventListener("focus", synchronize);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", synchronize);
    };
  }, [isPersistent, loadFiles]);

  const scopedFiles = useMemo(() => scopeFilesForSession(files, session), [files, session]);
  const filteredFiles = useMemo(() => filterArchivedFiles(scopedFiles, filters), [scopedFiles, filters]);
  const filterOptions = useMemo(() => buildFilterOptions(scopedFiles), [scopedFiles]);
  const availableCount = scopedFiles.filter((file) => file.status === "available").length;
  const missingCount = scopedFiles.filter((file) => file.status === "missing").length;

  const updateFilters = (partial: Partial<FileFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
    setMessage(null);
  };

  const writeLog = (
    file: ArchivedGeneratedFile,
    action: string,
    messageText: string,
    level: "error" | "info" | "warning" = "info"
  ) => {
    if (isPersistent && session) {
      void auditLogService.write({
        accountId: session.account_id,
        action,
        category: "fichiers",
        internalProfileId: session.internal_profile_id,
        internalProfileRole: session.internal_profile_role,
        level,
        message: messageText,
        technicalMessage: `file=${file.fileName}`
      });
    }
  };

  const openFile = async (file: ArchivedGeneratedFile) => {
    if (file.status === "missing") {
      setMessage("Fichier introuvable : impossible de l'ouvrir.");
      writeLog(file, "file.open.failed", "Ouverture refusée : fichier introuvable.", "warning");
      return;
    }

    try {
      if (isPersistent) {
        await fileService.open(file.localPath);
      }
      setMessage(`${file.fileName} ouvert.`);
      writeLog(file, "file.opened", "Fichier ouvert.");
    } catch {
      setMessage("Le fichier n'a pas pu être ouvert.");
      writeLog(file, "file.open.failed", "Ouverture échouée.", "error");
    }
  };

  const revealFile = async (file: ArchivedGeneratedFile) => {
    if (file.status === "missing") {
      setMessage("Fichier introuvable : impossible d'ouvrir son dossier.");
      writeLog(file, "file.reveal.failed", "Ouverture du dossier refusée : fichier introuvable.", "warning");
      return;
    }

    try {
      await fileService.reveal(file.localPath);
      setMessage(`${file.fileName} sélectionné dans son dossier.`);
      writeLog(file, "file.revealed", "Dossier du fichier ouvert.");
    } catch {
      setMessage("Le dossier du fichier n'a pas pu être ouvert.");
      writeLog(file, "file.reveal.failed", "Ouverture du dossier échouée.", "error");
    }
  };

  const copyPath = async (file: ArchivedGeneratedFile) => {
    try {
      await navigator.clipboard.writeText(file.localPath);
      setMessage("Chemin local copié.");
      writeLog(file, "file.path_copied", "Chemin local copié.");
    } catch {
      setMessage(`Copie impossible. Chemin local : ${file.localPath}`);
      writeLog(file, "file.path_copy.failed", "Copie du chemin échouée.", "warning");
    }
  };

  const exportFile = async (file: ArchivedGeneratedFile) => {
    if (file.status === "missing") {
      setMessage("Fichier introuvable : export impossible.");
      writeLog(file, "file.export.failed", "Export refusé : fichier introuvable.", "warning");
      return;
    }

    setBusyFileId(file.id);
    try {
      const exported = await fileService.exportToDownloads(file.localPath);
      setMessage(`${exported.file_name} exporté dans Téléchargements/TicketPro.`);
      writeLog(file, "file.exported", `Fichier exporté sous ${exported.file_name}.`);
    } catch {
      setMessage("Le fichier n'a pas pu être exporté vers Téléchargements.");
      writeLog(file, "file.export.failed", "Export vers Téléchargements échoué.", "error");
    } finally {
      setBusyFileId(null);
    }
  };

  const regenerateFileContent = async (file: ArchivedGeneratedFile) => {
    if (!file.batchId || !session) {
      throw new Error("Le fichier ou son lot d'origine est introuvable.");
    }
    const [record, batch] = await Promise.all([
      generatedFileRepository.findById(file.id),
      batchRepository.findById(file.batchId)
    ]);
    if (!record || record.account_id !== session.account_id || !batch) {
      throw new Error("Les données d'origine du fichier sont introuvables.");
    }

    const [timingPlan, timingTickets] = await Promise.all([
      planRepository.findById(batch.plan_id),
      ticketRepository.listByBatch(batch.id)
    ]);

    let bytes: Uint8Array | null = null;
    let format: "a4" | "a5" | "thermal58" | "thermal80" = "a4";
    let ticketCount = 0;
    let cloudFailure: unknown = null;

    if (organizationOperations) {
      try {
        const archive = await organizationOperations.getTicketPrintArchive(file.routerId, record.id);
        const pdfInput = applyArchivedTicketTimingSnapshots({
          input: ticketPdfInputFromPrintArchive(archive, {
            accountId: session.account_id,
            batchId: batch.id,
            createdByProfile: record.created_by_profile,
            createdByProfileId: record.created_by_profile_id,
            fileName: record.file_name,
            routerId: record.router_id
          }),
          plan: timingPlan,
          tickets: timingTickets
        });
        bytes = generateTicketPdf(pdfInput);
        format = pdfInput.format;
        ticketCount = pdfInput.tickets.length;
        await organizationOperations.publishTicketPrintArchive(
          file.routerId,
          record.id,
          createTicketPrintArchivePayload(pdfInput)
        ).catch(() => undefined);
      } catch (error) {
        cloudFailure = error;
      }
    }

    if (!bytes) {
      try {
        const [account, router] = await Promise.all([
          accountRepository.findById(session.account_id),
          routerRepository.findById(batch.router_id)
        ]);
        if (!account || !router || !timingPlan) {
          throw new Error("Le compte, le routeur ou le plan d'origine est introuvable.");
        }
        const regenerated = await regenerateArchivedTicketPdf({
          account,
          batch,
          file: record,
          plan: timingPlan,
          router,
          tickets: timingTickets
        });
        bytes = regenerated.bytes;
        format = regenerated.format;
        ticketCount = regenerated.ticketCount;
        await organizationOperations?.publishTicketPrintArchive(
          file.routerId,
          record.id,
          createTicketPrintArchivePayload(regenerated.input)
        ).catch(() => undefined);
      } catch (localError) {
        const localDetail = localError instanceof Error ? localError.message : "données locales illisibles";
        const cloudDetail = cloudFailure instanceof Error ? cloudFailure.message : "archive distante absente";
        throw new Error(
          `Impossible de reconstruire ce lot (${cloudDetail}; ${localDetail}). `
          + "Pour un ancien lot à mots de passe distincts, utilisez le PC d'origine ou le PDF déjà exporté."
        );
      }
    }

    await fileService.writeBytes(record.file_path, bytes);
    await generatedFileRepository.markRegenerated(record.id, session.account_id);
    setFiles((current) =>
      current.map((item) => (item.id === file.id ? { ...item, status: "available" } : item))
    );
    return { filePath: record.file_path, format, ticketCount };
  };

  const reprintFile = async (file: ArchivedGeneratedFile) => {
    if (!file.batchId || !session) {
      setMessage("Fichier ou lot introuvable : réimpression impossible.");
      writeLog(file, "file.print.failed", "Réimpression refusée : fichier ou lot introuvable.", "warning");
      return;
    }

    setBusyFileId(file.id);
    try {
      const printers = await fileService.listPrinters();
      const printer = printers.find((item) => item.is_default) ?? printers[0];
      if (!printer) {
        throw new Error("Aucune imprimante Windows n'est installée.");
      }

      const regenerated = await regenerateFileContent(file);
      await fileService.printFile(regenerated.filePath, printer.name);
      try {
        await printHistoryRepository.create({
          account_id: session.account_id,
          batch_id: file.batchId,
          created_by_profile: session.internal_profile_role,
          created_by_profile_id: session.internal_profile_id,
          format: regenerated.format,
          id: `print-${crypto.randomUUID()}`,
          mode: "batch",
          printer_id: printer.id,
          printer_name: printer.name,
          router_id: file.routerId,
          status: "printed",
          ticket_count: regenerated.ticketCount,
          user_message: `${regenerated.ticketCount} ticket(s) envoyés à ${printer.name}.`
        });
        setMessage(`${file.fileName} régénéré avec la mise en page actuelle puis envoyé à ${printer.name}.`);
        writeLog(file, "file.printed", `PDF actuel envoyé à ${printer.name}.`);
      } catch {
        setMessage(`${file.fileName} a été envoyé à ${printer.name}, mais l'historique n'a pas pu être enregistré.`);
        writeLog(
          file,
          "file.print_history.failed",
          `Fichier envoyé à ${printer.name}, historique non enregistré.`,
          "warning"
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Windows a refusé l'impression.";
      setMessage(`Réimpression impossible : ${detail}`);
      writeLog(file, "file.print.failed", `Réimpression échouée : ${detail}`, "error");
    } finally {
      setBusyFileId(null);
    }
  };

  const regenerateFile = async (file: ArchivedGeneratedFile) => {
    if (!file.canRegenerate || !file.batchId || !session) {
      setMessage("Régénération impossible pour ce fichier.");
      writeLog(file, "file.regenerate.failed", "Régénération refusée.", "warning");
      return;
    }

    setBusyFileId(file.id);
    try {
      const regenerated = await regenerateFileContent(file);
      setMessage(`${file.fileName} régénéré avec ${regenerated.ticketCount} ticket(s).`);
      writeLog(file, "file.regenerated", `PDF régénéré avec ${regenerated.ticketCount} ticket(s).`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "La régénération a échoué.";
      setMessage(`Régénération impossible : ${detail}`);
      writeLog(file, "file.regenerate.failed", `Régénération échouée : ${detail}`, "error");
    } finally {
      setBusyFileId(null);
    }
  };

  const deleteHistory = async () => {
    if (!fileToDelete) {
      return;
    }

    if (isPersistent && session) {
      try {
        await generatedFileRepository.remove(fileToDelete.id, session.account_id);
        await organizationOperations?.publishFile(fileToDelete.routerId, fileToDelete.id).catch(() => undefined);
      } catch {
        setMessage("Le fichier n'a pas pu être retiré de l'historique.");
        return;
      }
    }

    setFiles((current) => current.filter((file) => file.id !== fileToDelete.id));
    setMessage(`${fileToDelete.fileName} supprimé de l'historique. Le fichier local n'a pas été supprimé.`);
    writeLog(fileToDelete, "file.history_deleted", "Suppression de l'historique uniquement.");
    setFileToDelete(null);
  };

  const refreshFiles = async () => {
    setIsRefreshing(true);
    try {
      await loadFiles();
      setMessage("État des fichiers actualisé depuis le disque.");
    } catch {
      setMessage("L'état des fichiers n'a pas pu être actualisé.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const resetFilters = () => {
    setFilters(emptyFileFilters);
    setMessage(null);
  };

  if (isPersistent && files.length === 0 && (isLoading || loadError)) {
    return (
      <div className="page-stack">
        <PageHeader
          description="Archive locale et organisationnelle des PDF de tickets, rapports PDF et exports CSV."
          eyebrow="Routeur"
          title="Fichiers"
        />
        <AsyncStateCard
          description="TicketPro vérifie les archives locales et récupère les fichiers partagés par l'organisation."
          errorDescription={loadError ?? "Vérifiez la connexion puis relancez la récupération."}
          errorTitle="Impossible de charger les fichiers"
          loadingDescription="Lecture des lots, plans, archives PDF et disponibilité des fichiers sur ce poste."
          loadingTitle="Récupération des fichiers…"
          onRetry={() => void loadFiles()}
          status={loadError ? "error" : "loading"}
          title="Préparation de l'archive"
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <>
            <Button disabled={isRefreshing} icon={RefreshCw} onClick={() => void refreshFiles()} size="large" variant="secondary">
              {isRefreshing ? "Actualisation..." : "Actualiser"}
            </Button>
            <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)} size="large">
              Filtres
            </Button>
          </>
        }
        description="Archive locale des PDF de tickets, rapports PDF et exports CSV générés par l'application."
        eyebrow="Routeur"
        title="Fichiers"
      />

      <div className="page-grid">
        <div className="span-4">
          <StatCard icon={FileText} label="Fichiers" value={String(scopedFiles.length)} hint="Historique visible" />
        </div>
        <div className="span-4">
          <StatCard icon={FolderOpen} label="Disponibles" value={String(availableCount)} hint="Chemins présents" />
        </div>
        <div className="span-4">
          <StatCard icon={FileDown} label="Introuvables" value={String(missingCount)} hint="À régénérer si possible" />
        </div>
      </div>

      <Card>
        <div className="files-toolbar">
          <div className="tickets-count">
            <strong>Articles ({filteredFiles.length})</strong>
          </div>
          <label className="date-field">
            Depuis
            <input type="date" value={filters.dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} />
          </label>
          <label className="date-field">
            À
            <input type="date" value={filters.dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} />
          </label>
          <label className="date-field">
            Type
            <div className="files-select-control">
              <select value={filters.fileType} onChange={(event) => updateFilters({ fileType: event.target.value as FileFilters["fileType"] })}>
                <option value="">Tous les types</option>
                {fileTypes.map((type) => (
                  <option key={type} value={type}>
                    {fileTypeLabel(type)}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
          </label>
          <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)}>
            Filtres
          </Button>
        </div>

        {filtersOpen ? (
          <FilesFilterPanel filters={filters} onChange={updateFilters} onReset={resetFilters} options={filterOptions} />
        ) : null}
      </Card>

      {syncWarning ? <p className="form-error">{syncWarning}</p> : null}
      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <Card className="files-list-card">
        {filteredFiles.length > 0 ? (
          <div className="files-list">
            {filteredFiles.map((file) => (
              <FileArchiveRow
                file={file}
                isBusy={busyFileId === file.id}
                key={file.id}
                onCopyPath={() => void copyPath(file)}
                onDeleteHistory={() => setFileToDelete(file)}
                onExport={() => void exportFile(file)}
                onOpen={() => openFile(file)}
                onRegenerate={() => void regenerateFile(file)}
                onReveal={() => void revealFile(file)}
                onReprint={() => void reprintFile(file)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            action={
              <Button icon={Filter} onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            }
            description="Aucun fichier ne correspond aux critères."
            icon={FileText}
            title="Aucun fichier trouvé"
          />
        )}
      </Card>

      <ConfirmDialog
        confirmLabel="Supprimer l'historique"
        description={
          fileToDelete
            ? `Cette action retire ${fileToDelete.fileName} de l'historique uniquement. Le fichier local ne sera pas supprimé.`
            : ""
        }
        isOpen={Boolean(fileToDelete)}
        onCancel={() => setFileToDelete(null)}
        onConfirm={deleteHistory}
        title="Supprimer de l'historique ?"
      />
    </div>
  );
}

type FilterOptions = {
  operators: string[];
  plans: Array<{ id: string; name: string }>;
  routers: Array<{ id: string; name: string }>;
};

const fileTypes: GeneratedFileType[] = ["tickets_pdf", "report_pdf", "report_csv", "csv_export"];

function FileArchiveRow({
  file,
  isBusy,
  onCopyPath,
  onDeleteHistory,
  onExport,
  onOpen,
  onRegenerate,
  onReveal,
  onReprint
}: {
  file: ArchivedGeneratedFile;
  isBusy: boolean;
  onCopyPath: () => void;
  onDeleteHistory: () => void;
  onExport: () => void;
  onOpen: () => void;
  onRegenerate: () => void;
  onReveal: () => void;
  onReprint: () => void;
}) {
  const Icon = file.fileType === "csv_export" || file.fileType === "report_csv" ? FileDown : FileText;
  const status = file.status === "available" ? "success" : file.status === "missing" ? "error" : "warning";
  const menuItems: Array<{ icon: IconComponent; label: string; onSelect: () => void }> = [
    { icon: FileText, label: "Ouvrir le fichier", onSelect: onOpen },
    { icon: FolderOpen, label: "Afficher dans le dossier", onSelect: onReveal }
  ];

  if (file.fileType === "tickets_pdf") {
    menuItems.push({ icon: Printer, label: "Réimprimer", onSelect: onReprint });
  }

  menuItems.push({ icon: Download, label: "Exporter vers Téléchargements", onSelect: onExport });
  menuItems.push({ icon: Copy, label: "Copier le chemin", onSelect: onCopyPath });

  if (file.canRegenerate) {
    menuItems.push({ icon: RefreshCw, label: "Régénérer", onSelect: onRegenerate });
  }

  menuItems.push({ icon: Trash2, label: "Supprimer de l'historique", onSelect: onDeleteHistory });

  return (
    <article className="file-row">
      <div className="file-row__identity">
        <span className="file-row__icon">
          <Icon aria-hidden="true" />
        </span>
        <div>
          <h3>{file.fileName}</h3>
          <p>{file.localPath}</p>
        </div>
      </div>
      <div className="file-row__meta">
        <FileMeta label="Type" value={fileTypeLabel(file.fileType)} />
        <FileMeta label="Routeur" value={file.routerName} />
        <FileMeta label="Plan" value={file.planName ?? "Non applicable"} />
        <FileMeta label="Tickets" value={file.ticketQuantity === null ? "Non applicable" : String(file.ticketQuantity)} />
        <FileMeta
          label="Créé par"
          value={file.creatorLabel
            ? `${file.creatorLabel} · ${profileLabel(file.operatorProfile)}`
            : profileLabel(file.operatorProfile)}
        />
        <FileMeta label="Date" value={formatFileDate(file.createdAt)} />
        <FileMeta label="Format" value={file.format} />
      </div>
      <div className="file-row__actions">
        <Badge status={status as AppStatus}>{fileStatusLabel(file.status)}</Badge>
        <ActionMenu disabled={isBusy} items={menuItems} />
      </div>
    </article>
  );
}

function FileMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FilesFilterPanel({
  filters,
  onChange,
  onReset,
  options
}: {
  filters: FileFilters;
  onChange: (partial: Partial<FileFilters>) => void;
  onReset: () => void;
  options: FilterOptions;
}) {
  return (
    <div className="files-filter-panel">
      <label className="form-field">
        Plan
        <div className="files-select-control">
          <select value={filters.planId} onChange={(event) => onChange({ planId: event.target.value })}>
            <option value="">Tous les plans</option>
            {options.plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
      </label>
      <label className="form-field">
        Profil
        <div className="files-select-control">
          <select value={filters.operatorProfile} onChange={(event) => onChange({ operatorProfile: event.target.value })}>
            <option value="">Tous les profils</option>
            {options.operators.map((operator) => (
              <option key={operator} value={operator}>
                {profileLabel(operator)}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
      </label>
      <label className="form-field">
        Routeur
        <div className="files-select-control">
          <select value={filters.routerId} onChange={(event) => onChange({ routerId: event.target.value })}>
            <option value="">Tous les routeurs</option>
            {options.routers.map((router) => (
              <option key={router.id} value={router.id}>
                {router.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
      </label>
      <div className="files-filter-panel__actions">
        <Button onClick={onReset} variant="ghost">
          Réinitialiser
        </Button>
      </div>
    </div>
  );
}

function buildFilterOptions(files: ArchivedGeneratedFile[]): FilterOptions {
  return {
    operators: unique(files.map((file) => file.operatorProfile)),
    plans: uniqueBy(
      files
        .filter((file) => file.planId && file.planName)
        .map((file) => ({ id: file.planId!, name: file.planName! })),
      (plan) => plan.id
    ),
    routers: uniqueBy(
      files.map((file) => ({ id: file.routerId, name: file.routerName })),
      (router) => router.id
    )
  };
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const map = new Map<string, T>();

  values.forEach((value) => {
    map.set(getKey(value), value);
  });

  return Array.from(map.values());
}
