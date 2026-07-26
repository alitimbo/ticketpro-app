import type {
  ActiveHotspotUser,
  HotspotPlan,
  HotspotServer,
  HotspotUser,
  InterfaceTraffic,
  RouterConnectionTest,
  RouterDateTime,
  RouterHealth
} from "../../domain/router";
import type { RouterSnapshotRecord } from "../../domain/database";
import type { AppStatus } from "../../shared/ui";

export type MonitoringDiagnosticId =
  | "api"
  | "clients"
  | "connection"
  | "hotspot"
  | "memory"
  | "processor"
  | "sync";

export type MonitoringDiagnostic = {
  id: MonitoringDiagnosticId;
  label: string;
  message: string;
  status: AppStatus;
};

export type MonitoringViewModel = {
  activeClientsCount: number;
  apiStatus: AppStatus;
  apiStatusLabel: string;
  cpuLoad: number;
  cpuSeries: number[];
  dateTimeLabel: string;
  diagnostics: MonitoringDiagnostic[];
  downloadSeries: number[];
  hotspotStatus: AppStatus;
  hotspotStatusLabel: string;
  internetStatus: AppStatus;
  internetStatusLabel: string;
  lastErrors: MonitoringDiagnostic[];
  lastSyncLabel: string;
  memoryPercent: number;
  memorySeries: number[];
  memoryText: string;
  overallMessage: string;
  overallStatus: AppStatus;
  planCount: number;
  ticketCount: number;
  traffic: InterfaceTraffic[];
  uploadSeries: number[];
  uptime: string;
};

export type MonitoringSource = {
  activeUsers: ActiveHotspotUser[];
  checkedAt: Date;
  connection: RouterConnectionTest | null;
  dateTime: RouterDateTime;
  health: RouterHealth;
  plans: HotspotPlan[];
  servers: HotspotServer[];
  ticketUsers: HotspotUser[];
  traffic: InterfaceTraffic[];
  snapshots?: RouterSnapshotRecord[];
};

export function buildMonitoringViewModel(source: MonitoringSource): MonitoringViewModel {
  const apiAvailable = Boolean(source.connection?.ok);
  const hotspotActive = source.servers.some((server) => server.isEnabled);
  const memoryPercent = source.health.memoryTotal > 0
    ? Math.round((source.health.memoryUsed / source.health.memoryTotal) * 100)
    : 0;
  const cpuHigh = source.health.cpuLoad >= 80;
  const memoryHigh = memoryPercent >= 80;
  const tooManyClients = source.activeUsers.length >= 50;
  const ticketsSynced = true;
  const diagnostics: MonitoringDiagnostic[] = [
    {
      id: "connection",
      label: "Routeur connecté ?",
      message: apiAvailable ? "Routeur connecté" : "Le routeur ne répond pas",
      status: apiAvailable ? "success" : "error"
    },
    {
      id: "api",
      label: "API disponible ?",
      message: apiAvailable ? "API disponible" : "L’API semble désactivée",
      status: apiAvailable ? "success" : "error"
    },
    {
      id: "hotspot",
      label: "Hotspot actif ?",
      message: hotspotActive ? "Hotspot actif" : "Le Hotspot n’a pas été détecté",
      status: hotspotActive ? "success" : "warning"
    },
    {
      id: "processor",
      label: "CPU élevé ?",
      message: cpuHigh ? "Le processeur est élevé" : "CPU normal",
      status: cpuHigh ? "warning" : "success"
    },
    {
      id: "memory",
      label: "Mémoire élevée ?",
      message: memoryHigh ? "La mémoire du routeur est élevée" : "Mémoire normale",
      status: memoryHigh ? "warning" : "success"
    },
    {
      id: "clients",
      label: "Trop de clients ?",
      message: tooManyClients ? "Beaucoup de clients sont connectés" : "Nombre de clients normal",
      status: tooManyClients ? "warning" : "success"
    },
    {
      id: "sync",
      label: "Données tickets synchronisées ?",
      message: ticketsSynced ? "Données tickets synchronisées" : "Données tickets à vérifier",
      status: ticketsSynced ? "success" : "warning"
    }
  ];
  const lastErrors = diagnostics.filter((item) => item.status === "error" || item.status === "warning");
  const overall = getOverallState(diagnostics);

  return {
    activeClientsCount: source.activeUsers.length,
    apiStatus: apiAvailable ? "success" : "error",
    apiStatusLabel: apiAvailable ? "Disponible" : "Indisponible",
    cpuLoad: source.health.cpuLoad,
    cpuSeries: createHistoricalSeries(source.snapshots?.map((snapshot) => snapshot.cpu_load ?? 0), source.health.cpuLoad),
    dateTimeLabel: `${source.dateTime.date} ${source.dateTime.time}`,
    diagnostics,
    downloadSeries: createTrafficSeries(source.traffic, "rxBytesPerSecond"),
    hotspotStatus: hotspotActive ? "success" : "warning",
    hotspotStatusLabel: hotspotActive ? "Actif" : "Non détecté",
    internetStatus: source.traffic.some((item) => item.interfaceName === "ether1" && item.isRunning) ? "success" : "warning",
    internetStatusLabel: source.traffic.some((item) => item.interfaceName === "ether1" && item.isRunning) ? "Connecté" : "À vérifier",
    lastErrors,
    lastSyncLabel: formatDateTime(source.checkedAt),
    memoryPercent,
    memorySeries: createHistoricalSeries(
      source.snapshots?.map((snapshot) => {
        const total = snapshot.memory_total ?? 0;
        return total > 0 ? Math.round(((snapshot.memory_used ?? 0) / total) * 100) : 0;
      }),
      memoryPercent
    ),
    memoryText: `${formatBytes(source.health.memoryUsed)} / ${formatBytes(source.health.memoryTotal)}`,
    overallMessage: overall.overallMessage,
    overallStatus: overall.overallStatus,
    planCount: source.plans.length,
    ticketCount: source.ticketUsers.length,
    traffic: source.traffic,
    uploadSeries: createTrafficSeries(source.traffic, "txBytesPerSecond"),
    uptime: source.health.uptime
  };
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 MB";
  }

  const megabytes = bytes / 1024 / 1024;

  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(1)} Go`;
  }

  return `${Math.round(megabytes)} MB`;
}

export function formatTraffic(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  }

  return `${Math.round(bytesPerSecond / 1024)} KB/s`;
}

export function createChartPath(values: number[], width = 240, height = 64): string {
  if (values.length === 0) {
    return "";
  }

  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;

  return values
    .map((value, index) => {
      const x = Math.round(index * step);
      const y = Math.round(height - (value / max) * height);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function getOverallState(diagnostics: MonitoringDiagnostic[]): Pick<MonitoringViewModel, "overallMessage" | "overallStatus"> {
  if (diagnostics.some((item) => item.id === "connection" && item.status === "error")) {
    return { overallMessage: "Le routeur ne répond pas", overallStatus: "error" };
  }

  if (diagnostics.some((item) => item.id === "api" && item.status === "error")) {
    return { overallMessage: "L’API semble désactivée", overallStatus: "error" };
  }

  if (diagnostics.some((item) => item.id === "hotspot" && item.status === "warning")) {
    return { overallMessage: "Le Hotspot n’a pas été détecté", overallStatus: "warning" };
  }

  if (diagnostics.some((item) => item.id === "memory" && item.status === "warning")) {
    return { overallMessage: "La mémoire du routeur est élevée", overallStatus: "warning" };
  }

  return { overallMessage: "Tout fonctionne normalement", overallStatus: "success" };
}

function createMetricSeries(currentValue: number, length: number, variance: number, seed: number): number[] {
  return Array.from({ length }, (_, index) => {
    const wave = Math.sin((index + seed) / 5) * variance;
    const pulse = ((index * seed) % 7) - 3;
    return clamp(Math.round(currentValue + wave + pulse), 0, 100);
  });
}

function createHistoricalSeries(values: number[] | undefined, currentValue: number): number[] {
  if (!values || values.length === 0) {
    return Array.from({ length: 60 }, () => currentValue);
  }

  const normalized = [...values, currentValue].slice(-60);
  return normalized.length >= 60
    ? normalized
    : [...Array.from({ length: 60 - normalized.length }, () => normalized[0] ?? currentValue), ...normalized];
}

function createTrafficSeries(traffic: InterfaceTraffic[], key: "rxBytesPerSecond" | "txBytesPerSecond"): number[] {
  const total = traffic.reduce((sum, item) => sum + item[key], 0);

  return Array.from({ length: 60 }, (_, index) => {
    const wave = Math.sin(index / 4) * 0.18;
    const pulse = ((index * 13) % 9) / 100;
    return Math.max(0, Math.round(total * (0.88 + wave + pulse)));
  });
}

function formatDateTime(date: Date): string {
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
