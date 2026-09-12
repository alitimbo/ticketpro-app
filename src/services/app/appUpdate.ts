import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update
} from "@tauri-apps/plugin-updater";
import { isTauriRuntime } from "../../config/runtime";
import { DatabaseBackupService, type DatabaseBackup } from "../database";

export type AppUpdate = {
  currentVersion: string;
  date?: string;
  enforcement: "recommended" | "required";
  minimumSupportedVersion?: string;
  notes?: string;
  version: string;
};

export type AppUpdateDownloadProgress = {
  downloadedBytes: number;
  percent: number | null;
  totalBytes: number | null;
};

export type AppUpdateInstallResult = {
  backup: DatabaseBackup;
};

let cachedUpdate: Update | null | undefined;
let pendingCheck: Promise<Update | null> | null = null;

type AppUpdatePolicyResponse = {
  enforcement?: unknown;
  minimum_supported_version?: unknown;
  version?: unknown;
};

async function getUpdatePolicy(update: Update): Promise<Pick<AppUpdate, "enforcement" | "minimumSupportedVersion">> {
  const apiUrl = String(import.meta.env.VITE_LICENSE_API_URL ?? "").replace(/\/$/, "");
  if (!apiUrl) return { enforcement: "recommended" };

  try {
    const response = await fetch(
      `${apiUrl}/v1/app-updates/policy?current_version=${encodeURIComponent(update.currentVersion)}`,
      { headers: { accept: "application/json" }, method: "GET" }
    );
    if (!response.ok) return { enforcement: "recommended" };
    const policy = await response.json() as AppUpdatePolicyResponse;
    if (policy.version !== update.version) return { enforcement: "recommended" };
    return {
      enforcement: policy.enforcement === "required" ? "required" : "recommended",
      ...(typeof policy.minimum_supported_version === "string"
        ? { minimumSupportedVersion: policy.minimum_supported_version }
        : {})
    };
  } catch {
    return { enforcement: "recommended" };
  }
}

async function toPublicUpdate(update: Update): Promise<AppUpdate> {
  return {
    currentVersion: update.currentVersion,
    date: update.date,
    ...(await getUpdatePolicy(update)),
    notes: update.body,
    version: update.version
  };
}

export function appUpdatesAreSupported(): boolean {
  return isTauriRuntime();
}

export async function checkForAppUpdate(force = false): Promise<AppUpdate | null> {
  if (!appUpdatesAreSupported()) return null;

  if (!force && cachedUpdate !== undefined) {
    return cachedUpdate ? toPublicUpdate(cachedUpdate) : null;
  }
  if (pendingCheck) {
    const update = await pendingCheck;
    return update ? toPublicUpdate(update) : null;
  }

  pendingCheck = check({ timeout: 30_000 });
  try {
    cachedUpdate = await pendingCheck;
    return cachedUpdate ? toPublicUpdate(cachedUpdate) : null;
  } finally {
    pendingCheck = null;
  }
}

export async function installAvailableAppUpdate(
  onProgress?: (progress: AppUpdateDownloadProgress) => void
): Promise<AppUpdateInstallResult> {
  if (!appUpdatesAreSupported()) {
    throw new Error("Les mises à jour automatiques exigent TicketPro Desktop.");
  }
  const update = cachedUpdate ?? await check({ timeout: 30_000 });
  if (!update) {
    throw new Error("Aucune mise à jour n'est actuellement disponible.");
  }

  const backupService = new DatabaseBackupService();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = await backupService.backup(
    `ticketpro-pre-update-${update.currentVersion}-vers-${update.version}-${timestamp}.sqlite`
  );

  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  const reportProgress = (event: DownloadEvent) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? null;
      downloadedBytes = 0;
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
    } else {
      downloadedBytes = totalBytes ?? downloadedBytes;
    }
    onProgress?.({
      downloadedBytes,
      percent: totalBytes && totalBytes > 0
        ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
        : null,
      totalBytes
    });
  };

  await update.downloadAndInstall(reportProgress, { timeout: 10 * 60_000 });
  await relaunch();
  return { backup };
}

export function describeAppUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/public key|signature|base64/i.test(message)) {
    return "La signature de la mise à jour est invalide. Installation annulée.";
  }
  if (/timed? out|timeout/i.test(message)) {
    return "Le serveur de mise à jour ne répond pas assez vite. Réessayez.";
  }
  if (/network|connect|dns|fetch|request/i.test(message)) {
    return "Impossible de joindre le serveur de mise à jour.";
  }
  return message || "La mise à jour a échoué.";
}
