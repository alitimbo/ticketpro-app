import {
  Activity,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  Home,
  ListChecks,
  MonitorDot,
  ReceiptText,
  Router,
  Shield,
  ScrollText,
  Settings,
  Ticket,
  UserRound,
  Users
} from "lucide-react";
import type { Permission, UserRole } from "../../domain/auth";
import type { IconComponent } from "../../shared/ui";

export type NavigationItem = {
  end?: boolean;
  icon: IconComponent;
  label: string;
  permissions: Permission[];
  to: string;
};

export const globalNavigation: NavigationItem[] = [
  { end: true, icon: Home, label: "Maison", permissions: ["global.home"], to: "/" },
  { icon: UserRound, label: "Mon compte", permissions: ["global.home"], to: "/mon-compte" },
  { icon: Router, label: "Routeurs", permissions: ["global.routers.select"], to: "/routeurs" },
  { icon: Shield, label: "VPN distant", permissions: ["global.vpn"], to: "/vpn" },
  { icon: CreditCard, label: "Abonnement", permissions: ["global.subscription"], to: "/abonnement" },
  { icon: ReceiptText, label: "Factures", permissions: ["global.invoices"], to: "/factures" },
  { icon: Settings, label: "Paramètres", permissions: ["global.settings"], to: "/parametres" }
];

export function getRouterNavigation(routerId: string, role?: UserRole): NavigationItem[] {
  const basePath = `/routeurs/${routerId}`;

  return [
    { icon: Home, label: "Maison", permissions: ["router.home"], to: `${basePath}/maison` },
    { icon: ListChecks, label: "Plans", permissions: ["router.plans.read"], to: `${basePath}/plans` },
    {
      icon: Ticket,
      label: role === "agent" ? "Mes tickets" : "Tickets",
      permissions: ["router.tickets.read", "router.tickets.own"],
      to: `${basePath}/tickets`
    },
    {
      icon: ReceiptText,
      label: "Génération tickets",
      permissions: ["router.tickets.generate"],
      to: `${basePath}/tickets/generation`
    },
    {
      icon: FileText,
      label: "Fichiers",
      permissions: ["router.files.read", "router.files.own"],
      to: `${basePath}/fichiers`
    },
    {
      icon: ClipboardList,
      label: "Rapport",
      permissions: ["router.report.read", "router.report.own"],
      to: `${basePath}/rapport`
    },
    {
      icon: Users,
      label: "Clients connectés",
      permissions: ["router.clients.read"],
      to: `${basePath}/clients-connectes`
    },
    {
      icon: Gauge,
      label: "État réseau",
      permissions: ["router.network.read"],
      to: `${basePath}/monitoring`
    },
    { icon: ScrollText, label: "Logs", permissions: ["router.logs.read"], to: `${basePath}/logs` },
    {
      icon: MonitorDot,
      label: "Paramètres routeur",
      permissions: ["router.settings"],
      to: `${basePath}/parametres`
    }
  ];
}

export const statusNavigationIcon = Activity;
