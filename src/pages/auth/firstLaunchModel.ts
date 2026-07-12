import type { UserRole } from "../../domain/auth";
import {
  hashMainAccountPassword,
  hashProfilePassword,
  getInternalProfilePermissions,
  markFirstLaunchCompleted,
  saveInternalProfiles,
  saveMainAccountRecord,
  saveProfilePasswordHash
} from "../../services/auth";
import {
  defaultAccountSubscription,
  saveAccountSubscription,
  subscriptionPlans,
  type AccountSubscription
} from "../global/subscriptionPageModel";

export type FirstLaunchStep = 1 | 2 | 3 | 4;

export type FirstLaunchAccountForm = {
  companyName: string;
  confirmPassword: string;
  email: string;
  password: string;
  phone: string;
};

export type FirstLaunchProfilePasswords = Record<UserRole, string>;

export type FirstLaunchState = {
  account: FirstLaunchAccountForm;
  profilePasswords: FirstLaunchProfilePasswords;
  selectedPlanId: string;
  subscriptionStatus: "active_manual" | "trial";
};

export type FirstLaunchSummary = {
  accountEmail: string;
  companyName: string;
  configuredProfiles: UserRole[];
  planName: string;
  subscriptionStatus: "active_manual" | "trial";
};

export const firstLaunchSteps: FirstLaunchStep[] = [1, 2, 3, 4];

export const defaultFirstLaunchState: FirstLaunchState = {
  account: {
    companyName: "",
    confirmPassword: "",
    email: "",
    password: "",
    phone: ""
  },
  profilePasswords: {
    admin: "",
    agent: "",
    guest: "",
    operator: ""
  },
  selectedPlanId: "subscription-plan-1-router",
  subscriptionStatus: "trial"
};

export function validateFirstLaunchStep(step: FirstLaunchStep, state: FirstLaunchState): string | null {
  if (step === 1) {
    return validateAccountStep(state.account);
  }

  if (step === 2) {
    return subscriptionPlans.some((plan) => plan.id === state.selectedPlanId && plan.isActive)
      ? null
      : "Choisissez un pack.";
  }

  if (step === 3) {
    return validateProfilePasswords(state.profilePasswords);
  }

  return null;
}

export async function completeFirstLaunch(state: FirstLaunchState): Promise<FirstLaunchSummary> {
  const accountError = validateAccountStep(state.account);
  const planError = validateFirstLaunchStep(2, state);
  const profileError = validateProfilePasswords(state.profilePasswords);

  if (accountError || planError || profileError) {
    throw new Error(accountError ?? planError ?? profileError ?? "Configuration incomplète.");
  }

  const email = state.account.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const accountId = `account-${email}`;
  const selectedPlan = subscriptionPlans.find((plan) => plan.id === state.selectedPlanId) ?? subscriptionPlans[0];

  saveMainAccountRecord({
    companyName: state.account.companyName.trim(),
    createdAt: now,
    displayName: state.account.companyName.trim(),
    email,
    id: accountId,
    lastLoginAt: null,
    passwordHash: await hashMainAccountPassword(email, state.account.password),
    phone: state.account.phone.trim(),
    status: state.subscriptionStatus === "trial" ? "trial" : "active",
    updatedAt: now
  });

  saveAccountSubscription(buildFirstLaunchSubscription(selectedPlan.id, state.subscriptionStatus), accountId);
  saveInternalProfiles(
    (["admin", "operator", "agent", "guest"] as UserRole[]).map((role) => ({
      accountId,
      displayName: roleLabel(role),
      id: `${accountId}:internal-profile-${role}`,
      isEnabled: role === "admin" || Boolean(state.profilePasswords[role].trim()),
      lastUsedAt: null,
      permissions: getInternalProfilePermissions(role),
      role
    })),
    accountId
  );

  for (const role of ["admin", "operator", "agent", "guest"] as UserRole[]) {
    const password = state.profilePasswords[role].trim();
    saveProfilePasswordHash(role, password ? await hashProfilePassword(role, password) : "", accountId);
  }
  markFirstLaunchCompleted();

  return {
    accountEmail: email,
    companyName: state.account.companyName.trim(),
    configuredProfiles: (["admin", "operator", "agent", "guest"] as UserRole[]).filter((role) =>
      Boolean(state.profilePasswords[role].trim())
    ),
    planName: selectedPlan.name,
    subscriptionStatus: state.subscriptionStatus
  };
}

export function buildFirstLaunchSubscription(
  planId: string,
  status: FirstLaunchState["subscriptionStatus"]
): AccountSubscription {
  const selectedPlan = subscriptionPlans.find((plan) => plan.id === planId) ?? subscriptionPlans[0];
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  return {
    ...defaultAccountSubscription,
    currentPeriodEnd: periodEnd.toISOString(),
    currentPeriodStart: now.toISOString(),
    paymentStatus: status === "trial" ? "pending" : "manual",
    planId: selectedPlan.id,
    priceCfaSnapshot: selectedPlan.priceCfa,
    pricePerRouterCfaSnapshot: selectedPlan.pricePerRouterCfa,
    routerLimitSnapshot: selectedPlan.routerLimit,
    status: status === "trial" ? "trial" : "active"
  };
}

function validateAccountStep(account: FirstLaunchAccountForm): string | null {
  if (!account.email.trim() || !account.email.includes("@")) {
    return "Entrez un email valide.";
  }

  if (!account.companyName.trim()) {
    return "Entrez le nom de l'entreprise.";
  }

  if (account.password.length < 6) {
    return "Le mot de passe principal doit contenir au moins 6 caractères.";
  }

  if (account.password !== account.confirmPassword) {
    return "Les mots de passe du compte principal ne correspondent pas.";
  }

  if (account.phone.trim() && account.phone.trim().length < 6) {
    return "Entrez un téléphone valide.";
  }

  return null;
}

function validateProfilePasswords(profilePasswords: FirstLaunchProfilePasswords): string | null {
  if (profilePasswords.admin.length < 6) {
    return "Le mot de passe Admin est obligatoire et doit contenir au moins 6 caractères.";
  }

  const optionalProfiles: UserRole[] = ["operator", "agent", "guest"];
  const weakProfile = optionalProfiles.find((role) => {
    const password = profilePasswords[role];
    return password.length > 0 && password.length < 6;
  });

  return weakProfile ? `Le mot de passe ${roleLabel(weakProfile)} doit contenir au moins 6 caractères.` : null;
}

function roleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    admin: "Admin",
    agent: "Agent",
    guest: "Invité",
    operator: "Opérateur"
  };

  return labels[role];
}
