import type { AuthSession } from "../../domain/auth";

export type GeneratedFileType = "csv_export" | "report_pdf" | "tickets_pdf";

export type GeneratedFileStatus = "available" | "missing";

export type ArchivedGeneratedFile = {
  accountId: string;
  batchId: string | null;
  canRegenerate: boolean;
  createdByProfileId: string;
  createdAt: string;
  fileName: string;
  fileType: GeneratedFileType;
  format: string;
  id: string;
  localPath: string;
  operatorProfile: string;
  planId: string | null;
  planName: string | null;
  routerId: string;
  routerName: string;
  status: GeneratedFileStatus;
  ticketQuantity: number | null;
};

export type FileFilters = {
  dateFrom: string;
  dateTo: string;
  fileType: "" | GeneratedFileType;
  operatorProfile: string;
  planId: string;
  routerId: string;
};

export const emptyFileFilters: FileFilters = {
  dateFrom: "",
  dateTo: "",
  fileType: "",
  operatorProfile: "",
  planId: "",
  routerId: ""
};

export function createDemoArchivedFiles(): ArchivedGeneratedFile[] {
  return [
    {
      accountId: "account-douma-demo",
      batchId: "batch-demo-pdf",
      canRegenerate: true,
      createdByProfileId: "account-douma-demo:internal-profile-operator",
      createdAt: "2026-07-08T21:40:00.000Z",
      fileName: "tickets-demo-a4.pdf",
      fileType: "tickets_pdf",
      format: "PDF A4",
      id: "file-ticket-a4-demo",
      localPath: "output/pdf/tickets-demo-a4.pdf",
      operatorProfile: "operator",
      planId: "plan-3h",
      planName: "3h-2Go",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      status: "available",
      ticketQuantity: 40
    },
    {
      accountId: "account-douma-demo",
      batchId: "batch-jour-20",
      canRegenerate: true,
      createdByProfileId: "account-douma-demo:internal-profile-agent",
      createdAt: "2026-07-08T09:10:00.000Z",
      fileName: "tickets-jour-20.pdf",
      fileType: "tickets_pdf",
      format: "PDF 80 mm",
      id: "file-ticket-jour-20",
      localPath: "files/tickets-jour-20.pdf",
      operatorProfile: "agent",
      planId: "plan-jour",
      planName: "Journée",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      status: "missing",
      ticketQuantity: 20
    },
    {
      accountId: "account-douma-demo",
      batchId: null,
      canRegenerate: true,
      createdByProfileId: "account-douma-demo:internal-profile-operator",
      createdAt: "2026-07-07T18:30:00.000Z",
      fileName: "rapport-journalier-2026-07-07.pdf",
      fileType: "report_pdf",
      format: "PDF",
      id: "file-report-2026-07-07",
      localPath: "files/rapport-journalier-2026-07-07.pdf",
      operatorProfile: "operator",
      planId: null,
      planName: null,
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      status: "available",
      ticketQuantity: null
    },
    {
      accountId: "account-autre-demo",
      batchId: null,
      canRegenerate: false,
      createdByProfileId: "account-douma-demo:internal-profile-admin",
      createdAt: "2026-07-06T16:15:00.000Z",
      fileName: "tickets-export-2026-07-06.csv",
      fileType: "csv_export",
      format: "CSV",
      id: "file-csv-2026-07-06",
      localPath: "files/tickets-export-2026-07-06.csv",
      operatorProfile: "admin",
      planId: "plan-1h",
      planName: "1h",
      routerId: "routeur-demo",
      routerName: "Routeur démo",
      status: "available",
      ticketQuantity: 120
    }
  ];
}

export function scopeFilesForSession(
  files: ArchivedGeneratedFile[],
  session: AuthSession | null | undefined
): ArchivedGeneratedFile[] {
  if (!session) {
    return [];
  }

  const accountFiles = files.filter((file) => file.accountId === session.account_id);

  if (session.permissions.includes("router.files.read")) {
    return accountFiles;
  }

  if (session.permissions.includes("router.files.own")) {
    return accountFiles.filter((file) => file.createdByProfileId === session.internal_profile_id);
  }

  return [];
}

export function filterArchivedFiles(files: ArchivedGeneratedFile[], filters: FileFilters): ArchivedGeneratedFile[] {
  const from = filters.dateFrom ? startOfDay(filters.dateFrom) : null;
  const to = filters.dateTo ? endOfDay(filters.dateTo) : null;

  return files.filter((file) => {
    const createdAt = new Date(file.createdAt).getTime();

    if (from !== null && createdAt < from) {
      return false;
    }

    if (to !== null && createdAt > to) {
      return false;
    }

    if (filters.fileType && file.fileType !== filters.fileType) {
      return false;
    }

    if (filters.planId && file.planId !== filters.planId) {
      return false;
    }

    if (filters.operatorProfile && file.operatorProfile !== filters.operatorProfile) {
      return false;
    }

    if (filters.routerId && file.routerId !== filters.routerId) {
      return false;
    }

    return true;
  });
}

export function fileTypeLabel(type: GeneratedFileType): string {
  const labels: Record<GeneratedFileType, string> = {
    csv_export: "Export CSV",
    report_pdf: "Rapport PDF",
    tickets_pdf: "Lot tickets PDF"
  };

  return labels[type];
}

export function fileStatusLabel(status: GeneratedFileStatus): string {
  return status === "available" ? "Disponible" : "Fichier introuvable";
}

export function formatFileDate(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function profileLabel(profile: string): string {
  const labels: Record<string, string> = {
    admin: "Admin",
    agent: "Agent",
    guest: "Invité",
    operator: "Opérateur"
  };

  return labels[profile] ?? profile;
}

function startOfDay(date: string): number {
  return new Date(`${date}T00:00:00.000`).getTime();
}

function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59.999`).getTime();
}
