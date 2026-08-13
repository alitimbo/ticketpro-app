import type { HotspotPlan, HotspotPlanDraft } from "../../domain/router";
import type { CreateHotspotPlanInput, HotspotPlanRecord } from "../../domain/database";

export type PlanFormValues = {
  currency: string;
  dataAmount: string;
  dataUnit: "go" | "mb";
  downloadLimit: string;
  durationAmount: string;
  durationUnit: "days" | "hours" | "minutes";
  name: string;
  priceHint: string;
  profileName: string;
  sharedUsers: string;
  status: HotspotPlan["status"];
  uploadLimit: string;
  validityAmount: string;
  validityUnit: "days" | "hours" | "minutes";
};

export type PlanTemplate = {
  dataAmount: string;
  dataUnit: PlanFormValues["dataUnit"];
  durationAmount: string;
  durationUnit: PlanFormValues["durationUnit"];
  name: string;
  validityAmount?: string;
  validityUnit?: PlanFormValues["validityUnit"];
};

export type PlanViewModel = HotspotPlan & {
  createdAt: string | null;
  createdByProfileId: string | null;
  currency: string;
  lastSyncedAt: string | null;
  linkedTickets: number;
  mikrotikId: string | null;
  revision: number;
  syncStatus: HotspotPlanRecord["sync_status"];
  updatedAt: string | null;
  updatedByProfileId: string | null;
};

export type CommercialHotspotPlanDraft = HotspotPlanDraft & {
  currency: string;
};

export const quickPlanTemplates: PlanTemplate[] = [
  { dataAmount: "", dataUnit: "mb", durationAmount: "1", durationUnit: "hours", name: "1h", validityAmount: "3", validityUnit: "hours" },
  { dataAmount: "2048", dataUnit: "mb", durationAmount: "3", durationUnit: "hours", name: "3h-2Go", validityAmount: "5", validityUnit: "hours" },
  { dataAmount: "", dataUnit: "mb", durationAmount: "6", durationUnit: "hours", name: "6h" },
  { dataAmount: "", dataUnit: "mb", durationAmount: "24", durationUnit: "hours", name: "24h" },
  { dataAmount: "", dataUnit: "mb", durationAmount: "7", durationUnit: "days", name: "7 jours" },
  { dataAmount: "", dataUnit: "mb", durationAmount: "30", durationUnit: "days", name: "30 jours" }
];

export const emptyPlanFormValues: PlanFormValues = {
  currency: "CFA",
  dataAmount: "",
  dataUnit: "mb",
  downloadLimit: "5M",
  durationAmount: "3",
  durationUnit: "hours",
  name: "",
  priceHint: "",
  profileName: "",
  sharedUsers: "1",
  status: "active",
  uploadLimit: "2M",
  validityAmount: "5",
  validityUnit: "hours"
};

export function applyTemplate(values: PlanFormValues, template: PlanTemplate): PlanFormValues {
  return {
    ...values,
    dataAmount: template.dataAmount,
    dataUnit: template.dataUnit,
    durationAmount: template.durationAmount,
    durationUnit: template.durationUnit,
    name: template.name,
    profileName: toProfileName(template.name),
    validityAmount: template.validityAmount ?? template.durationAmount,
    validityUnit: template.validityUnit ?? template.durationUnit
  };
}

export function planToFormValues(plan: PlanViewModel): PlanFormValues {
  const duration = minutesToDuration(plan.durationMinutes);
  const validity = minutesToDuration(plan.validityMinutes ?? plan.durationMinutes);
  const data = mbToDataAmount(plan.dataLimitMb);

  return {
    currency: normalizePlanCurrency(plan.currency),
    dataAmount: data.dataAmount,
    dataUnit: data.dataUnit,
    downloadLimit: plan.downloadLimit ?? "",
    durationAmount: duration.durationAmount,
    durationUnit: duration.durationUnit,
    name: plan.name,
    priceHint: plan.priceHint !== null ? String(plan.priceHint) : "",
    profileName: plan.profileName,
    sharedUsers: String(plan.sharedUsers),
    status: plan.status,
    uploadLimit: plan.uploadLimit ?? "",
    validityAmount: validity.durationAmount,
    validityUnit: validity.durationUnit
  };
}

export function formValuesToPlanDraft(values: PlanFormValues): CommercialHotspotPlanDraft {
  return {
    currency: normalizePlanCurrency(values.currency),
    dataLimitMb: dataToMb(values.dataAmount, values.dataUnit),
    downloadLimit: values.downloadLimit || null,
    durationMinutes: durationToMinutes(values.durationAmount, values.durationUnit),
    name: values.name.trim(),
    priceHint: values.priceHint ? Number(values.priceHint) : null,
    profileName: values.profileName.trim() || toProfileName(values.name),
    sharedUsers: Number(values.sharedUsers),
    status: values.status,
    uploadLimit: values.uploadLimit || null,
    validityMinutes: durationToMinutes(values.validityAmount, values.validityUnit)
  };
}

export function planFromHotspotPlan(plan: HotspotPlan, linkedTickets = 0): PlanViewModel {
  return {
    ...plan,
    createdAt: null,
    createdByProfileId: null,
    currency: normalizePlanCurrency(plan.currency),
    lastSyncedAt: null,
    linkedTickets,
    mikrotikId: plan.mikrotikId ?? plan.id,
    revision: 1,
    updatedAt: null,
    updatedByProfileId: null,
    syncStatus: "synced"
  };
}

export function planFromRecord(record: HotspotPlanRecord, linkedTickets = 0): PlanViewModel {
  return {
    ...planFromHotspotPlan(
    {
      dataLimitMb: record.data_limit_mb,
      downloadLimit: record.download_limit,
      durationMinutes: record.duration_minutes,
      id: record.id,
      currency: record.currency,
      mikrotikId: record.mikrotik_id,
      name: record.name,
      profileName: record.mikrotik_profile_name ?? record.name,
      priceHint: record.price_hint,
      sharedUsers: record.shared_users,
      status: record.status === "disabled" ? "disabled" : "active",
      uploadLimit: record.upload_limit,
      validityMinutes: record.validity_minutes
    },
    linkedTickets
    ),
    createdAt: record.created_at,
    createdByProfileId: record.created_by_profile_id,
    currency: normalizePlanCurrency(record.currency),
    lastSyncedAt: record.last_synced_at,
    mikrotikId: record.mikrotik_id,
    revision: record.revision,
    syncStatus: record.sync_status,
    updatedAt: record.updated_at,
    updatedByProfileId: record.updated_by_profile_id
  };
}

export function planRecordFromDraft(
  draft: CommercialHotspotPlanDraft,
  routerId: string,
  id: string,
  syncStatus: HotspotPlanRecord["sync_status"] = "local",
  metadata: {
    actorProfileId?: string | null;
    createdByProfileId?: string | null;
    lastSyncedAt?: string | null;
    mikrotikId?: string | null;
    revision?: number;
    updatedByProfileId?: string | null;
  } = {}
): CreateHotspotPlanInput {
  return {
    created_by_profile_id: metadata.createdByProfileId ?? metadata.actorProfileId ?? null,
    currency: normalizePlanCurrency(draft.currency),
    data_limit_mb: draft.dataLimitMb,
    download_limit: draft.downloadLimit,
    duration_minutes: draft.durationMinutes,
    id,
    last_synced_at: metadata.lastSyncedAt ?? null,
    mikrotik_id: metadata.mikrotikId ?? null,
    mikrotik_profile_name: draft.profileName,
    name: draft.name,
    price_hint: draft.priceHint,
    router_id: routerId,
    revision: metadata.revision ?? 1,
    shared_users: draft.sharedUsers,
    status: draft.status ?? "active",
    sync_status: syncStatus,
    upload_limit: draft.uploadLimit,
    updated_by_profile_id: metadata.updatedByProfileId ?? metadata.actorProfileId ?? null,
    validity_minutes: draft.validityMinutes
  };
}

export function validatePlanForm(values: PlanFormValues): string | null {
  if (!values.name.trim()) {
    return "Entrez le nom du plan.";
  }

  if (!values.currency.trim()) {
    return "Choisissez une devise pour ce plan.";
  }

  if (!/^[A-Za-z0-9]{2,12}$/.test(values.currency.trim())) {
    return "La devise doit contenir entre 2 et 12 lettres ou chiffres (ex. CFA, XOF, EUR, USD).";
  }

  if (durationToMinutes(values.durationAmount, values.durationUnit) <= 0) {
    return "Entrez une durée valide.";
  }

  if (durationToMinutes(values.validityAmount, values.validityUnit) <= 0) {
    return "Entrez une validité valide.";
  }

  if (values.dataAmount && dataToMb(values.dataAmount, values.dataUnit) !== null && dataToMb(values.dataAmount, values.dataUnit)! < 0) {
    return "Entrez un volume data valide.";
  }

  if (!Number(values.sharedUsers) || Number(values.sharedUsers) < 1) {
    return "Entrez un nombre d’appareils valide.";
  }

  if (values.priceHint && Number(values.priceHint) < 0) {
    return "Entrez un prix indicatif valide.";
  }

  return null;
}

export function formatPlanMinutes(minutes: number | null): string {
  if (!minutes) {
    return "Non défini";
  }

  if (minutes >= 1440 && minutes % 1440 === 0) {
    return `${minutes / 1440} j`;
  }

  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} h`;
  }

  return `${minutes} min`;
}

export function formatPlanDisplayName(name: string): string {
  const displayName = name.trim().replace(/[\s_-]+cfa$/i, "").trim();
  return displayName || name.trim();
}

export function normalizePlanCurrency(value: string | null | undefined): string {
  return value?.trim().toUpperCase() || "CFA";
}

export function duplicatePlan(plan: PlanViewModel): PlanViewModel {
  return {
    ...plan,
    createdAt: null,
    createdByProfileId: null,
    id: `${plan.id}-copie-${Date.now()}`,
    lastSyncedAt: null,
    linkedTickets: 0,
    mikrotikId: null,
    name: `${plan.name} copie`,
    profileName: `${plan.profileName}-copie`,
    revision: 1,
    syncStatus: "local",
    updatedAt: null,
    updatedByProfileId: null,
    status: "active"
  };
}

function dataToMb(amount: string, unit: PlanFormValues["dataUnit"]): number | null {
  if (!amount.trim()) {
    return null;
  }

  const value = Number(amount);

  if (!Number.isFinite(value)) {
    return -1;
  }

  return unit === "go" ? value * 1024 : value;
}

function durationToMinutes(amount: string, unit: PlanFormValues["durationUnit"]): number {
  const value = Number(amount);

  if (!Number.isFinite(value)) {
    return 0;
  }

  if (unit === "days") {
    return value * 1440;
  }

  if (unit === "hours") {
    return value * 60;
  }

  return value;
}

function minutesToDuration(minutes: number): Pick<PlanFormValues, "durationAmount" | "durationUnit"> {
  if (minutes % 1440 === 0) {
    return { durationAmount: String(minutes / 1440), durationUnit: "days" };
  }

  if (minutes % 60 === 0) {
    return { durationAmount: String(minutes / 60), durationUnit: "hours" };
  }

  return { durationAmount: String(minutes), durationUnit: "minutes" };
}

function mbToDataAmount(value: number | null): Pick<PlanFormValues, "dataAmount" | "dataUnit"> {
  if (!value) {
    return { dataAmount: "", dataUnit: "mb" };
  }

  if (value % 1024 === 0) {
    return { dataAmount: String(value / 1024), dataUnit: "go" };
  }

  return { dataAmount: String(value), dataUnit: "mb" };
}

function toProfileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
