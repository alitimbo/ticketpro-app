import type { HotspotPlan, HotspotPlanDraft } from "../../domain/router";

export type PlanFormValues = {
  dataAmount: string;
  dataUnit: "go" | "mb";
  downloadLimit: string;
  durationAmount: string;
  durationUnit: "days" | "hours" | "minutes";
  idleTimeout: string;
  keepaliveTimeout: string;
  name: string;
  priceHint: string;
  profileName: string;
  rateLimit: string;
  sessionTimeout: string;
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
  idleTimeout: string;
  keepaliveTimeout: string;
  linkedTickets: number;
  rateLimit: string;
  sessionTimeout: string;
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
  dataAmount: "",
  dataUnit: "mb",
  downloadLimit: "5M",
  durationAmount: "3",
  durationUnit: "hours",
  idleTimeout: "5m",
  keepaliveTimeout: "2m",
  name: "",
  priceHint: "",
  profileName: "",
  rateLimit: "5M/2M",
  sessionTimeout: "3h",
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
    sessionTimeout: durationToTimeout(template.durationAmount, template.durationUnit),
    validityAmount: template.validityAmount ?? template.durationAmount,
    validityUnit: template.validityUnit ?? template.durationUnit
  };
}

export function planToFormValues(plan: PlanViewModel): PlanFormValues {
  const duration = minutesToDuration(plan.durationMinutes);
  const validity = minutesToDuration(plan.validityMinutes ?? plan.durationMinutes);
  const data = mbToDataAmount(plan.dataLimitMb);

  return {
    dataAmount: data.dataAmount,
    dataUnit: data.dataUnit,
    downloadLimit: plan.downloadLimit ?? "",
    durationAmount: duration.durationAmount,
    durationUnit: duration.durationUnit,
    idleTimeout: plan.idleTimeout,
    keepaliveTimeout: plan.keepaliveTimeout,
    name: plan.name,
    priceHint: plan.priceHint ? String(plan.priceHint) : "",
    profileName: plan.profileName,
    rateLimit: plan.rateLimit,
    sessionTimeout: plan.sessionTimeout,
    sharedUsers: String(plan.sharedUsers),
    status: plan.status,
    uploadLimit: plan.uploadLimit ?? "",
    validityAmount: validity.durationAmount,
    validityUnit: validity.durationUnit
  };
}

export function formValuesToPlanDraft(values: PlanFormValues): HotspotPlanDraft {
  return {
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
    idleTimeout: "5m",
    keepaliveTimeout: "2m",
    linkedTickets,
    rateLimit: [plan.downloadLimit, plan.uploadLimit].filter(Boolean).join("/") || "Non défini",
    sessionTimeout: `${plan.durationMinutes}m`
  };
}

export function validatePlanForm(values: PlanFormValues): string | null {
  if (!values.name.trim()) {
    return "Entrez le nom du plan.";
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

export function duplicatePlan(plan: PlanViewModel): PlanViewModel {
  return {
    ...plan,
    id: `${plan.id}-copie-${Date.now()}`,
    linkedTickets: 0,
    name: `${plan.name} copie`,
    profileName: `${plan.profileName}-copie`,
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

function durationToTimeout(amount: string, unit: PlanFormValues["durationUnit"]): string {
  if (unit === "days") {
    return `${amount}d`;
  }

  if (unit === "hours") {
    return `${amount}h`;
  }

  return `${amount}m`;
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
