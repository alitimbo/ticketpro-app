import { describe, expect, it } from "vitest";
import {
  buildMonitoringViewModel,
  createChartPath,
  formatBytes,
  formatTraffic,
  type MonitoringSource
} from "./monitoringPageModel";

const baseSource: MonitoringSource = {
  activeUsers: [],
  checkedAt: new Date("2026-07-09T10:00:00.000Z"),
  connection: {
    checkedAt: "2026-07-09T10:00:00.000Z",
    latencyMs: 20,
    mode: "local",
    ok: true
  },
  dateTime: {
    date: "2026-07-09",
    time: "10:00:00",
    timeZone: "Africa/Niamey"
  },
  health: {
    activeClientsCount: 0,
    cpuLoad: 18,
    memoryTotal: 256 * 1024 * 1024,
    memoryUsed: 84 * 1024 * 1024,
    temperatureCelsius: 44,
    uptime: "5d 08:42:17"
  },
  plans: [],
  servers: [
    {
      addressPool: "clients",
      id: "*1",
      interfaceName: "bridge",
      isEnabled: true,
      name: "Principal",
      profileName: "default"
    }
  ],
  ticketUsers: [],
  traffic: [{ interfaceName: "ether1", isRunning: true, rxBytesPerSecond: 384_000, txBytesPerSecond: 92_000 }]
};

describe("monitoringPageModel", () => {
  it("affiche un diagnostic simple quand tout va bien", () => {
    const model = buildMonitoringViewModel(baseSource);

    expect(model.overallMessage).toBe("Tout fonctionne normalement");
    expect(model.overallStatus).toBe("success");
    expect(model.cpuSeries).toHaveLength(60);
    expect(model.memorySeries).toHaveLength(60);
  });

  it("remonte un message clair si le routeur ne répond pas", () => {
    const model = buildMonitoringViewModel({ ...baseSource, connection: null });

    expect(model.overallMessage).toBe("Le routeur ne répond pas");
    expect(model.apiStatus).toBe("error");
    expect(model.lastErrors.map((item) => item.message)).toContain("Le routeur ne répond pas");
  });

  it("signale la mémoire élevée et le Hotspot manquant", () => {
    const model = buildMonitoringViewModel({
      ...baseSource,
      health: { ...baseSource.health, memoryUsed: 230 * 1024 * 1024 },
      servers: []
    });

    expect(model.overallMessage).toBe("Le Hotspot n’a pas été détecté");
    expect(model.lastErrors.map((item) => item.message)).toEqual(
      expect.arrayContaining(["Le Hotspot n’a pas été détecté", "La mémoire du routeur est élevée"])
    );
  });

  it("formate les volumes et génère un tracé lisible", () => {
    expect(formatBytes(256 * 1024 * 1024)).toBe("256 MB");
    expect(formatTraffic(384_000)).toBe("375 KB/s");
    expect(createChartPath([0, 50, 100])).toBe("M 0 64 L 120 32 L 240 0");
  });
});
