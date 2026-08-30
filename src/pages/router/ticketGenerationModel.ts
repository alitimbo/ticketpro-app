import type { HotspotPlan, HotspotServer, HotspotUser, RouterSummary } from "../../domain/router";
import type { CreateTicketBatchInput, CreateTicketInput, SyncStatus } from "../../domain/database";
import type { UserRole } from "../../domain/auth";
import {
  formatTicketValidityLabel,
  type TicketPdfFormat,
  type TicketPdfInput,
  type TicketPdfTemplate
} from "../../services/pdf";
import { normalizeTicketPrefix, secretRefForTicket, voucherBelongsToBatch } from "../../services/tickets";

export { secretRefForTicket };

export type TicketGenerationStep = 1 | 2 | 3 | 4 | 5 | 6;

export type TicketStatus =
  | "activé"
  | "complété"
  | "disponible"
  | "désactivé"
  | "erreur_sync"
  | "expiré"
  | "imprimé"
  | "supprimé";

export type TicketGenerationOptions = {
  codeLength: number;
  createPdf: boolean;
  excludeAmbiguous: boolean;
  generateQrCode: boolean;
  pdfFormat: TicketPdfFormat;
  pdfTemplate: TicketPdfTemplate;
  prefix: string;
  usernameEqualsPassword: boolean;
};

export type TicketGenerationState = {
  customQuantity: string;
  options: TicketGenerationOptions;
  quantity: number | "custom";
  selectedPlanId: string;
  selectedRouterId: string;
  selectedServerName: string;
  step: TicketGenerationStep;
};

export type TicketGenerationResult = {
  batch: CreateTicketBatchInput;
  failedTickets: CreateTicketInput[];
  fileName: string | null;
  statusLabel: string;
  succeededTickets: CreateTicketInput[];
  syncStatus: SyncStatus;
  totalValue: number | null;
};

export const quickQuantities = [5, 10, 20, 50, 100] as const;

export const defaultTicketGenerationOptions: TicketGenerationOptions = {
  codeLength: 6,
  createPdf: true,
  excludeAmbiguous: true,
  generateQrCode: false,
  pdfFormat: "a4",
  pdfTemplate: "economy",
  prefix: "",
  usernameEqualsPassword: true
};

export const ticketPdfFormatLabels: Record<TicketPdfFormat, string> = {
  a4: "A4 multi-tickets",
  a5: "A5",
  thermal58: "58 mm",
  thermal80: "80 mm"
};

export const ticketPdfTemplateLabels: Record<TicketPdfTemplate, string> = {
  economy: "Économique",
  premium: "Premium",
  qr: "QR code",
  simple: "Simple"
};

export const ticketStatuses: TicketStatus[] = [
  "disponible",
  "désactivé",
  "imprimé",
  "activé",
  "complété",
  "expiré",
  "supprimé",
  "erreur_sync"
];

export function createInitialTicketGenerationState(routerId: string): TicketGenerationState {
  return {
    customQuantity: "20",
    options: defaultTicketGenerationOptions,
    quantity: 20,
    selectedPlanId: "",
    selectedRouterId: routerId,
    selectedServerName: "",
    step: 1
  };
}

export function getSelectedQuantity(state: TicketGenerationState): number {
  return state.quantity === "custom" ? Number(state.customQuantity) : state.quantity;
}

export function findConfirmedVoucherBatchUsers(input: {
  batchId: string;
  pendingTickets: Pick<CreateTicketInput, "username">[];
  profileName: string;
  routerUsers: HotspotUser[];
}): HotspotUser[] {
  const usersByName = new Map<string, HotspotUser>();

  input.routerUsers.forEach((user) => {
    if (
      user.profileName === input.profileName
      && voucherBelongsToBatch(user.comment, input.batchId)
      && !usersByName.has(user.username)
    ) {
      usersByName.set(user.username, user);
    }
  });

  return input.pendingTickets
    .map((ticket) => usersByName.get(ticket.username))
    .filter((user): user is HotspotUser => Boolean(user));
}

export type VoucherBatchIntegrity = {
  duplicateUsernames: string[];
  expectedQuantity: number;
  isExact: boolean;
  managedQuantity: number;
  missingUsernames: string[];
  profileMismatchUsernames: string[];
  unexpectedUsernames: string[];
};

export function inspectVoucherBatchIntegrity(input: {
  batchId: string;
  expectedTickets: Pick<CreateTicketInput, "username">[];
  profileName: string;
  routerUsers: HotspotUser[];
}): VoucherBatchIntegrity {
  const expectedUsernames = new Set(input.expectedTickets.map((ticket) => ticket.username));
  const managedUsers = input.routerUsers.filter((user) => voucherBelongsToBatch(user.comment, input.batchId));
  const managedCounts = new Map<string, number>();

  managedUsers.forEach((user) => {
    managedCounts.set(user.username, (managedCounts.get(user.username) ?? 0) + 1);
  });

  const duplicateUsernames = [...managedCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([username]) => username);
  const missingUsernames = [...expectedUsernames].filter((username) => !managedCounts.has(username));
  const unexpectedUsernames = [...managedCounts.keys()].filter((username) => !expectedUsernames.has(username));
  const profileMismatchUsernames = managedUsers
    .filter((user) => expectedUsernames.has(user.username) && user.profileName !== input.profileName)
    .map((user) => user.username);

  return {
    duplicateUsernames,
    expectedQuantity: expectedUsernames.size,
    isExact:
      input.expectedTickets.length === expectedUsernames.size
      && managedUsers.length === expectedUsernames.size
      && duplicateUsernames.length === 0
      && missingUsernames.length === 0
      && unexpectedUsernames.length === 0
      && profileMismatchUsernames.length === 0,
    managedQuantity: managedUsers.length,
    missingUsernames,
    profileMismatchUsernames,
    unexpectedUsernames
  };
}

export function validateTicketGeneration(
  state: TicketGenerationState,
  routers: RouterSummary[],
  plans: HotspotPlan[],
  servers: HotspotServer[] = []
): string | null {
  if (!routers.some((router) => router.id === state.selectedRouterId)) {
    return "Choisissez un routeur.";
  }

  const selectedPlan = plans.find(
    (plan) => plan.id === state.selectedPlanId && plan.status === "active"
  );
  if (!selectedPlan) {
    return "Choisissez un plan actif.";
  }

  if (selectedPlan.profileName.trim().toLowerCase() === "default") {
    return "Le profil RouterOS default est réservé. Créez ou sélectionnez un forfait dédié.";
  }

  const enabledServers = servers.filter((server) => server.isEnabled);
  if (servers.length > 0 && enabledServers.length === 0) {
    return "Aucun serveur Hotspot actif n'est disponible sur le routeur.";
  }
  if (
    enabledServers.length > 0
    && state.selectedServerName !== "all"
    && !enabledServers.some((server) => server.name === state.selectedServerName)
  ) {
    return enabledServers.length === 1
      ? "Le serveur Hotspot sélectionné n'existe plus. Actualisez la liste."
      : "Choisissez un serveur Hotspot ou l'option All.";
  }

  const quantity = getSelectedQuantity(state);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    return "Choisissez une quantité entre 1 et 500.";
  }

  if (!Number.isInteger(state.options.codeLength) || state.options.codeLength < 3 || state.options.codeLength > 12) {
    return "Choisissez une longueur de code entre 3 et 12.";
  }

  if (state.options.prefix.length > 8) {
    return "Le préfixe doit contenir 8 caractères maximum.";
  }

  return null;
}

export function buildTicketBatch(input: {
  accountId: string;
  currency?: string;
  id: string;
  operatorProfileId: string;
  operatorRole: UserRole;
  planId: string;
  priceSnapshot?: number | null;
  quantity: number;
  routerId: string;
  serverName?: string;
  syncStatus: SyncStatus;
  options: TicketGenerationOptions;
}): CreateTicketBatchInput {
  return {
    account_id: input.accountId,
    code_length: input.options.codeLength,
    currency: normalizeCurrency(input.currency),
    created_by_profile: input.operatorRole,
    created_by_profile_id: input.operatorProfileId,
    generated_file_id: `${input.id}-pdf`,
    id: input.id,
    operator_profile: input.operatorRole,
    plan_id: input.planId,
    price_snapshot: input.priceSnapshot ?? null,
    prefix: normalizePrefix(input.options.prefix) || null,
    quantity: input.quantity,
    router_id: input.routerId,
    hotspot_server_name: input.serverName ?? "all",
    status: input.syncStatus === "synced" ? "terminé" : "partiel",
    sync_status: input.syncStatus
  };
}

export function buildTicketRecord(input: {
  accountId: string;
  batchId: string;
  createdByProfileId: string;
  createdByProfile: UserRole;
  mikrotikId: string | null;
  passwordSecretRef: string;
  planId: string;
  planSnapshot?: HotspotPlan;
  routerId: string;
  serverName?: string;
  profileName?: string;
  status: TicketStatus;
  syncStatus: SyncStatus;
  username: string;
}): CreateTicketInput {
  const id = `ticket-${slugify(input.username)}-${input.batchId}`;

  return {
    account_id: input.accountId,
    activated_at: null,
    batch_id: input.batchId,
    completed_at: null,
    created_by_profile: input.createdByProfile,
    created_by_profile_id: input.createdByProfileId,
    deleted_at: input.status === "supprimé" ? new Date().toISOString() : null,
    downloaded_bytes: 0,
    expires_at: null,
    id,
    ip_address: null,
    mac_address: null,
    mikrotik_id: input.mikrotikId,
    password_encrypted: input.passwordSecretRef,
    plan_id: input.planId,
    duration_minutes_snapshot: input.planSnapshot?.durationMinutes ?? null,
    validity_minutes_snapshot:
      input.planSnapshot?.validityMinutes ?? input.planSnapshot?.durationMinutes ?? null,
    data_limit_mb_snapshot: input.planSnapshot?.dataLimitMb ?? null,
    download_limit_snapshot: input.planSnapshot?.downloadLimit ?? null,
    upload_limit_snapshot: input.planSnapshot?.uploadLimit ?? null,
    shared_users_snapshot: input.planSnapshot?.sharedUsers ?? null,
    printed_count: input.status === "imprimé" ? 1 : 0,
    router_id: input.routerId,
    hotspot_server_name: input.serverName ?? "all",
    mikrotik_profile_name: input.profileName ?? null,
    status: input.status,
    sync_status: input.syncStatus,
    uploaded_bytes: 0,
    username: input.username
  };
}

export function getTicketSummary(input: {
  operatorRole: UserRole;
  plan: HotspotPlan;
  quantity: number;
  router: RouterSummary;
  syncStatus: SyncStatus;
}) {
  return {
    operator: roleLabel(input.operatorRole),
    plan: input.plan.name,
    quantity: input.quantity,
    router: input.router.name,
    sync: syncStatusLabel(input.syncStatus),
    totalValue: input.plan.priceHint === null ? null : input.plan.priceHint * input.quantity
  };
}

export function syncStatusLabel(status: SyncStatus): string {
  const labels: Record<SyncStatus, string> = {
    conflict: "Création partielle",
    local: "Local uniquement",
    pending: "En attente",
    synced: "Synchronisé"
  };

  return labels[status];
}

export function normalizePrefix(prefix: string): string {
  return normalizeTicketPrefix(prefix);
}

export function roleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    admin: "Admin",
    agent: "Agent",
    guest: "Invité",
    operator: "Opérateur"
  };

  return labels[role];
}

export function ticketStatusLabel(status: TicketStatus): string {
  return status === "erreur_sync" ? "Erreur sync" : status.charAt(0).toUpperCase() + status.slice(1);
}

export function createBatchId(): string {
  return `batch-${crypto.randomUUID()}`;
}

export function buildFileName(input: {
  batchId: string;
  currency?: string;
  generatedAt?: Date;
  planName: string;
  price: number | null;
  quantity: number;
  routerName: string;
}): string {
  const generatedAt = input.generatedAt ?? new Date();
  const timestamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const batchSuffix = sanitizeFileSegment(input.batchId.replace(/^batch-/, "")).slice(0, 8) || "lot";
  const currency = sanitizeFileSegment(normalizeCurrency(input.currency)) || "CFA";
  const price = input.price === null
    ? `prix-non-defini-${currency}`
    : `${Math.max(0, Math.round(input.price))}${currency}`;

  return [
    sanitizeFileSegment(input.routerName) || "Routeur",
    sanitizeFileSegment(input.planName) || "Plan",
    price,
    `${Math.max(1, Math.round(input.quantity))}tickets`,
    timestamp,
    batchSuffix
  ].join("-") + ".pdf";
}

export function normalizeCurrency(value: string | null | undefined): string {
  return value?.trim().slice(0, 12) || "CFA";
}

function sanitizeFileSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 48);
}

export function buildTicketPdfInput(input: {
  batch: CreateTicketBatchInput;
  fileName: string;
  generatedAt: string;
  ownerPhone: string;
  plan: HotspotPlan;
  router: RouterSummary;
  tickets: CreateTicketInput[];
}): TicketPdfInput {
  return {
    accountId: input.batch.account_id,
    batchId: input.batch.id,
    createdByProfile: input.batch.created_by_profile,
    createdByProfileId: input.batch.created_by_profile_id,
    currency: normalizeCurrency(input.batch.currency),
    dataLimitLabel: formatDataLimit(input.plan.dataLimitMb),
    durationLabel: formatDuration(input.plan.durationMinutes),
    fileName: input.fileName,
    format: input.batch.generated_file_id ? defaultTicketGenerationOptions.pdfFormat : "a4",
    generatedAt: input.generatedAt,
    hotspotAddress: input.router.hotspotAddress?.trim() || "Adresse Hotspot à configurer",
    ownerPhone: input.ownerPhone.trim(),
    planName: input.plan.name,
    priceLabel: input.plan.priceHint === null
      ? null
      : `${input.plan.priceHint.toLocaleString("fr-FR")} ${normalizeCurrency(input.batch.currency)}`,
    qrCodeEnabled: false,
    routerId: input.router.id,
    template: defaultTicketGenerationOptions.pdfTemplate,
    tickets: input.tickets.map((ticket) => ({
      passwordSecretRef: ticket.password_encrypted,
      username: ticket.username
    })),
    titleLabel: input.router.name,
    validityLabel: formatTicketValidityLabel(input.plan.validityMinutes ?? input.plan.durationMinutes),
    zoneName: input.router.name
  };
}

export function buildTicketPdfInputFromOptions(input: {
  batch: CreateTicketBatchInput;
  fileName: string;
  generatedAt: string;
  options: TicketGenerationOptions;
  ownerPhone: string;
  plan: HotspotPlan;
  router: RouterSummary;
  tickets: CreateTicketInput[];
}): TicketPdfInput {
  return {
    ...buildTicketPdfInput(input),
    format: input.options.pdfFormat,
    qrCodeEnabled: input.options.generateQrCode || input.options.pdfTemplate === "qr",
    template: input.options.pdfTemplate
  };
}

export function userToTicketRecord(input: {
  accountId: string;
  batchId: string;
  createdByProfileId: string;
  createdByProfile: UserRole;
  passwordSecretRef?: string;
  planId?: string;
  planSnapshot?: HotspotPlan;
  routerId: string;
  serverName?: string;
  user: HotspotUser;
}): CreateTicketInput {
  return buildTicketRecord({
    accountId: input.accountId,
    batchId: input.batchId,
    createdByProfileId: input.createdByProfileId,
    createdByProfile: input.createdByProfile,
    mikrotikId: input.user.id,
    passwordSecretRef: input.passwordSecretRef ?? input.user.passwordSecretRef,
    planId: input.planId ?? input.user.planId,
    planSnapshot: input.planSnapshot,
    profileName: input.user.profileName,
    routerId: input.routerId,
    serverName: input.serverName ?? input.user.serverName ?? "all",
    status: "disponible",
    syncStatus: "synced",
    username: input.user.username
  });
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDuration(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return `${minutes / 1440} j`;
  }

  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} h`;
  }

  return `${minutes} min`;
}

function formatDataLimit(megabytes: number | null): string | null {
  if (megabytes === null) {
    return null;
  }

  if (megabytes >= 1024 && megabytes % 1024 === 0) {
    return `${megabytes / 1024} Go`;
  }

  return `${megabytes} MB`;
}
