import { useMemo, useState } from "react";
import {
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
  ActionMenu,
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

type FileLog = {
  createdAt: string;
  fileName: string;
  message: string;
};

export function FilesPage() {
  const { session } = useAuth();
  const [files, setFiles] = useState<ArchivedGeneratedFile[]>(() => createDemoArchivedFiles());
  const [filters, setFilters] = useState<FileFilters>(emptyFileFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<FileLog[]>([]);
  const [fileToDelete, setFileToDelete] = useState<ArchivedGeneratedFile | null>(null);

  const scopedFiles = useMemo(() => scopeFilesForSession(files, session), [files, session]);
  const filteredFiles = useMemo(() => filterArchivedFiles(scopedFiles, filters), [scopedFiles, filters]);
  const filterOptions = useMemo(() => buildFilterOptions(scopedFiles), [scopedFiles]);
  const availableCount = scopedFiles.filter((file) => file.status === "available").length;
  const missingCount = scopedFiles.length - availableCount;

  const updateFilters = (partial: Partial<FileFilters>) => {
    setFilters((current) => ({ ...current, ...partial }));
    setMessage(null);
  };

  const writeLog = (file: ArchivedGeneratedFile, messageText: string) => {
    setLogs((current) => [
      { createdAt: new Date().toISOString(), fileName: file.fileName, message: messageText },
      ...current
    ]);
  };

  const openFile = (file: ArchivedGeneratedFile) => {
    if (file.status === "missing") {
      setMessage("Fichier introuvable : impossible de l'ouvrir.");
      writeLog(file, "Ouverture refusée : fichier introuvable.");
      return;
    }

    setMessage(`${file.fileName} prêt à être ouvert depuis son chemin local.`);
    writeLog(file, "Ouverture demandée.");
  };

  const copyFile = async (file: ArchivedGeneratedFile) => {
    if (file.status === "missing") {
      setMessage("Fichier introuvable : copie impossible.");
      writeLog(file, "Copie refusée : fichier introuvable.");
      return;
    }

    try {
      await navigator.clipboard?.writeText(file.localPath);
      setMessage("Chemin local copié.");
    } catch {
      setMessage(`Chemin local : ${file.localPath}`);
    }

    writeLog(file, "Chemin local copié pour export.");
  };

  const reprintFile = (file: ArchivedGeneratedFile) => {
    if (file.status === "missing") {
      setMessage("Fichier introuvable : réimpression impossible.");
      writeLog(file, "Réimpression refusée : fichier introuvable.");
      return;
    }

    setMessage(`${file.fileName} envoyé vers la préparation d'impression.`);
    writeLog(file, "Réimpression demandée.");
  };

  const regenerateFile = (file: ArchivedGeneratedFile) => {
    if (!file.canRegenerate) {
      setMessage("Régénération impossible pour ce fichier.");
      writeLog(file, "Régénération refusée.");
      return;
    }

    setFiles((current) =>
      current.map((item) =>
        item.id === file.id
          ? { ...item, createdAt: new Date().toISOString(), status: "available" }
          : item
      )
    );
    setMessage(`${file.fileName} régénéré localement.`);
    writeLog(file, "Fichier régénéré.");
  };

  const deleteHistory = () => {
    if (!fileToDelete) {
      return;
    }

    setFiles((current) => current.filter((file) => file.id !== fileToDelete.id));
    setMessage(`${fileToDelete.fileName} supprimé de l'historique. Le fichier local n'a pas été supprimé.`);
    writeLog(fileToDelete, "Suppression de l'historique uniquement.");
    setFileToDelete(null);
  };

  const resetFilters = () => {
    setFilters(emptyFileFilters);
    setMessage(null);
  };

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)} size="large">
            Filtres
          </Button>
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
            <span>{logs.length} log(s) fichiers</span>
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
            <select value={filters.fileType} onChange={(event) => updateFilters({ fileType: event.target.value as FileFilters["fileType"] })}>
              <option value="">Tous</option>
              {fileTypes.map((type) => (
                <option key={type} value={type}>
                  {fileTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <Button icon={Filter} onClick={() => setFiltersOpen((current) => !current)}>
            Filtres
          </Button>
        </div>

        {filtersOpen ? (
          <FilesFilterPanel filters={filters} onChange={updateFilters} onReset={resetFilters} options={filterOptions} />
        ) : null}
      </Card>

      {message ? <p className="form-error form-error--success">{message}</p> : null}

      <Card className="files-list-card">
        {filteredFiles.length > 0 ? (
          <div className="files-list">
            {filteredFiles.map((file) => (
              <FileArchiveRow
                file={file}
                key={file.id}
                onCopy={() => void copyFile(file)}
                onDeleteHistory={() => setFileToDelete(file)}
                onOpen={() => openFile(file)}
                onRegenerate={() => regenerateFile(file)}
                onReprint={() => reprintFile(file)}
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

      {logs.length > 0 ? (
        <Card title="Logs fichiers">
          <div className="file-log-list">
            {logs.slice(0, 6).map((log) => (
              <div className="file-log-item" key={`${log.createdAt}-${log.fileName}-${log.message}`}>
                <strong>{formatFileDate(log.createdAt)}</strong>
                <span>{log.fileName}</span>
                <p>{log.message}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

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

const fileTypes: GeneratedFileType[] = ["tickets_pdf", "report_pdf", "csv_export"];

function FileArchiveRow({
  file,
  onCopy,
  onDeleteHistory,
  onOpen,
  onRegenerate,
  onReprint
}: {
  file: ArchivedGeneratedFile;
  onCopy: () => void;
  onDeleteHistory: () => void;
  onOpen: () => void;
  onRegenerate: () => void;
  onReprint: () => void;
}) {
  const Icon = file.fileType === "csv_export" ? FileDown : FileText;
  const status = file.status === "available" ? "success" : "error";
  const menuItems: Array<{ icon: IconComponent; label: string; onSelect: () => void }> = [
    { icon: FolderOpen, label: "Ouvrir", onSelect: onOpen }
  ];

  if (file.fileType === "tickets_pdf") {
    menuItems.push({ icon: Printer, label: "Réimprimer", onSelect: onReprint });
  }

  menuItems.push({ icon: Copy, label: "Exporter / copier", onSelect: onCopy });

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
        <FileMeta label="Profil" value={profileLabel(file.operatorProfile)} />
        <FileMeta label="Date" value={formatFileDate(file.createdAt)} />
        <FileMeta label="Format" value={file.format} />
      </div>
      <div className="file-row__actions">
        <Badge status={status as AppStatus}>{fileStatusLabel(file.status)}</Badge>
        <ActionMenu items={menuItems} />
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
        <select value={filters.planId} onChange={(event) => onChange({ planId: event.target.value })}>
          <option value="">Tous les plans</option>
          {options.plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Profil
        <select value={filters.operatorProfile} onChange={(event) => onChange({ operatorProfile: event.target.value })}>
          <option value="">Tous les profils</option>
          {options.operators.map((operator) => (
            <option key={operator} value={operator}>
              {profileLabel(operator)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Routeur
        <select value={filters.routerId} onChange={(event) => onChange({ routerId: event.target.value })}>
          <option value="">Tous les routeurs</option>
          {options.routers.map((router) => (
            <option key={router.id} value={router.id}>
              {router.name}
            </option>
          ))}
        </select>
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
