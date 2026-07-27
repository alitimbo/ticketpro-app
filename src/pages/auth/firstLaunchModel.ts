import type { UserRole } from "../../domain/auth";
import type { DatabaseClient } from "../../services/database";
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
  activationKey: string;
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

export type FirstLaunchLicenseDetails = {
  billingPeriod: "custom" | "monthly" | "yearly";
  description: string;
  durationDays: number;
  maxDevices: number;
  planCode: string;
  planId: string;
  planName: string;
  priceCfa: number | null;
  routerLimit: number;
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
  activationKey: "",
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
    return null;
  }

  if (step === 3) {
    return validateProfilePasswords(state.profilePasswords);
  }

  return null;
}

export async function completeFirstLaunch(
  state: FirstLaunchState,
  database?: DatabaseClient,
  licenseDetails?: FirstLaunchLicenseDetails
): Promise<FirstLaunchSummary> {
  const accountError = validateAccountStep(state.account);
  const planError = validateFirstLaunchStep(2, state);
  const profileError = validateProfilePasswords(state.profilePasswords);

  if (accountError || planError || profileError) {
    throw new Error(accountError ?? planError ?? profileError ?? "Configuration incomplète.");
  }

  const email = state.account.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const accountId = `account-${email}`;
  const selectedPlan = licenseDetails
    ? {
        billingPeriod: licenseDetails.billingPeriod === "yearly" ? "yearly" as const : "monthly" as const,
        description: licenseDetails.description,
        id: licenseDetails.planId,
        isActive: true,
        isRecommended: false,
        name: licenseDetails.planName,
        priceCfa: licenseDetails.priceCfa,
        pricePerRouterCfa: licenseDetails.priceCfa === null
          ? null
          : Math.round(licenseDetails.priceCfa / Math.max(1, licenseDetails.routerLimit)),
        routerLimit: licenseDetails.routerLimit
      }
    : subscriptionPlans.find((plan) => plan.id === state.selectedPlanId) ?? subscriptionPlans[0];
  const accountPasswordHash = await hashMainAccountPassword(email, state.account.password);
  const profilePasswordHashes = Object.fromEntries(
    await Promise.all(
      (["admin", "operator", "agent", "guest"] as UserRole[]).map(async (role) => [
        role,
        state.profilePasswords[role].trim() ? await hashProfilePassword(role, state.profilePasswords[role].trim()) : ""
      ])
    )
  ) as Record<UserRole, string>;
  const subscription = buildFirstLaunchSubscription(
    selectedPlan.id,
    state.subscriptionStatus,
    licenseDetails?.durationDays,
    licenseDetails?.routerLimit,
    licenseDetails?.priceCfa
  );

  if (database) {
    await database.transaction([
      ...(licenseDetails
        ? [{
            sql: `INSERT INTO subscription_plans (
              id, name, router_limit, price_cfa, price_per_router_cfa, billing_period,
              description, is_recommended, is_active, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name, router_limit = excluded.router_limit,
              price_cfa = excluded.price_cfa, price_per_router_cfa = excluded.price_per_router_cfa,
              billing_period = excluded.billing_period, description = excluded.description,
              is_active = excluded.is_active, updated_at = excluded.updated_at`,
            params: [
              licenseDetails.planId,
              licenseDetails.planName,
              licenseDetails.routerLimit,
              licenseDetails.priceCfa,
              selectedPlan.pricePerRouterCfa,
              licenseDetails.billingPeriod === "yearly" ? "yearly" : "monthly",
              licenseDetails.description,
              0,
              1,
              now
            ]
          }]
        : []),
      {
        sql: `INSERT INTO accounts (id, email, password_hash, display_name, company_name, phone, status, last_login_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            password_hash = excluded.password_hash,
            display_name = excluded.display_name,
            company_name = excluded.company_name,
            phone = excluded.phone,
            status = excluded.status,
            updated_at = CURRENT_TIMESTAMP`,
        params: [
          accountId,
          email,
          accountPasswordHash,
          state.account.companyName.trim(),
          state.account.companyName.trim(),
          state.account.phone.trim() || null,
          state.subscriptionStatus === "trial" ? "trial" : "active",
          null
        ]
      },
      ...(["admin", "operator", "agent", "guest"] as UserRole[]).map((role) => ({
        sql: `INSERT INTO internal_profiles (id, account_id, role, display_name, password_hash, is_enabled, permissions_json, last_used_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ON CONFLICT(account_id, role) DO UPDATE SET
            display_name = excluded.display_name,
            password_hash = excluded.password_hash,
            is_enabled = excluded.is_enabled,
            permissions_json = excluded.permissions_json,
            updated_at = CURRENT_TIMESTAMP`,
        params: [
          `${accountId}:internal-profile-${role}`,
          accountId,
          role,
          roleLabel(role),
          profilePasswordHashes[role],
          role === "admin" || Boolean(profilePasswordHashes[role]) ? 1 : 0,
          JSON.stringify(getInternalProfilePermissions(role)),
          null
        ]
      })),
      {
        sql: `INSERT INTO account_subscriptions (
          id, account_id, subscription_plan_id, status, current_period_start, current_period_end,
          router_limit_snapshot, price_cfa_snapshot, price_per_router_cfa_snapshot, payment_status
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id) DO UPDATE SET
          subscription_plan_id = excluded.subscription_plan_id,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          router_limit_snapshot = excluded.router_limit_snapshot,
          price_cfa_snapshot = excluded.price_cfa_snapshot,
          price_per_router_cfa_snapshot = excluded.price_per_router_cfa_snapshot,
          payment_status = excluded.payment_status,
          updated_at = CURRENT_TIMESTAMP`,
        params: [
          `subscription-${accountId}-current`,
          accountId,
          subscription.planId,
          subscription.status,
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
          subscription.routerLimitSnapshot,
          subscription.priceCfaSnapshot,
          subscription.pricePerRouterCfaSnapshot,
          subscription.paymentStatus
        ]
      }
    ]);
  }

  saveMainAccountRecord({
    companyName: state.account.companyName.trim(),
    createdAt: now,
    displayName: state.account.companyName.trim(),
    email,
    id: accountId,
    lastLoginAt: null,
    passwordHash: accountPasswordHash,
    phone: state.account.phone.trim(),
    status: state.subscriptionStatus === "trial" ? "trial" : "active",
    updatedAt: now
  });

  saveAccountSubscription(subscription, accountId);
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
    saveProfilePasswordHash(role, profilePasswordHashes[role], accountId);
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
  status: FirstLaunchState["subscriptionStatus"],
  durationDays?: number,
  routerLimit?: number,
  priceCfa?: number | null
): AccountSubscription {
  const selectedPlan = subscriptionPlans.find((plan) => plan.id === planId) ?? subscriptionPlans[0];
  const now = new Date();
  const periodEnd = new Date(now);
  if (durationDays && durationDays > 0) {
    periodEnd.setDate(periodEnd.getDate() + durationDays);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  return {
    ...defaultAccountSubscription,
    currentPeriodEnd: periodEnd.toISOString(),
    currentPeriodStart: now.toISOString(),
    paymentStatus: status === "trial" ? "pending" : "manual",
    planId: routerLimit === undefined ? selectedPlan.id : planId,
    priceCfaSnapshot: priceCfa === undefined ? selectedPlan.priceCfa : priceCfa,
    pricePerRouterCfaSnapshot: priceCfa === undefined
      ? selectedPlan.pricePerRouterCfa
      : priceCfa === null
        ? null
        : Math.round(priceCfa / Math.max(1, routerLimit ?? selectedPlan.routerLimit)),
    routerLimitSnapshot: routerLimit ?? selectedPlan.routerLimit,
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
