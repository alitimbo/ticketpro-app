import type { Permission, UserRole } from "../../domain/auth";

export const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  operator: "Opérateur",
  agent: "Agent",
  guest: "Invité"
};

export const roleDescriptions: Record<UserRole, string> = {
  admin: "Accès complet à l'application, aux routeurs, aux paramètres, aux profils, à l'abonnement et aux factures.",
  operator: "Création de tickets, réimpression, consultation des tickets, fichiers, rapports et clients connectés.",
  agent: "Création de tickets limitée, consultation de ses propres lots et rapport limité à son activité.",
  guest: "Consultation uniquement."
};

export const allPermissions: Permission[] = [
  "global.home",
  "global.routers",
  "global.routers.select",
  "global.routers.manage",
  "global.routers.add",
  "global.routers.edit",
  "global.routers.delete",
  "global.subscription",
  "global.invoices",
  "global.vpn",
  "global.settings",
  "global.settings.profiles",
  "router.home",
  "router.plans.read",
  "router.plans.write",
  "router.tickets.read",
  "router.tickets.generate",
  "router.tickets.own",
  "router.tickets.reprint",
  "router.tickets.disable",
  "router.tickets.delete",
  "router.tickets.sync",
  "router.tickets.revealPassword",
  "router.files.read",
  "router.files.own",
  "router.report.read",
  "router.report.own",
  "router.clients.read",
  "router.clients.disconnect",
  "router.network.read",
  "router.logs.read",
  "router.logs.clean",
  "router.settings",
  "router.settings.manage"
];

export const permissionsByRole: Record<UserRole, Permission[]> = {
  admin: allPermissions,
  operator: [
    "global.home",
    "global.routers",
    "global.routers.select",
    "router.home",
    "router.plans.read",
    "router.tickets.read",
    "router.tickets.generate",
    "router.tickets.reprint",
    "router.files.read",
    "router.report.read",
    "router.clients.read"
  ],
  agent: [
    "global.home",
    "global.routers.select",
    "router.home",
    "router.tickets.generate",
    "router.tickets.own",
    "router.tickets.reprint",
    "router.files.own",
    "router.report.own"
  ],
  guest: [
    "global.home",
    "router.home",
    "router.tickets.read",
    "router.report.read",
    "router.network.read"
  ]
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return permissionsByRole[role].includes(permission);
}

export function hasAnyPermission(role: UserRole, permissions: Permission[] = []): boolean {
  return permissions.length === 0 || permissions.some((permission) => hasPermission(role, permission));
}

export function hasAllPermissions(role: UserRole, permissions: Permission[] = []): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}

export function getDefaultPathForRole(role: UserRole): string {
  if (role === "guest") {
    return "/routeurs/routeur-demo/maison";
  }

  if (role === "agent") {
    return "/routeurs/routeur-demo/tickets/generation";
  }

  return "/";
}
