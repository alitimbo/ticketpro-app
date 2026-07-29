import { describe, expect, it } from "vitest";
import { createSession } from "../../services/auth";
import {
  appLogFromRecord,
  canCleanLogs,
  createDemoLogs,
  emptyLogFilters,
  exportLogsToCsv,
  filterLogs,
  getLogPageCount,
  paginateLogs,
  scopeLogsForSession,
  translateTechnicalError
} from "./logsPageModel";

const agentSession = createSession("agent", "doumacorporation@gmail.com", Date.now());

describe("logsPageModel", () => {
  it("traduit les erreurs techniques en messages compréhensibles", () => {
    expect(translateTechnicalError("timeout")).toBe("Le routeur ne répond pas. Vérifiez la connexion réseau.");
    expect(translateTechnicalError("connection refused")).toBe(
      "Le routeur refuse la connexion. Vérifiez que l’API MikroTik est activée."
    );
    expect(translateTechnicalError("authentication failed")).toBe("Identifiant ou mot de passe MikroTik incorrect.");
    expect(translateTechnicalError("permission denied")).toBe("Le compte MikroTik n’a pas les droits nécessaires.");
    expect(translateTechnicalError("duplicate user")).toBe("Ce code existe déjà sur le routeur.");
    expect(translateTechnicalError("hotspot not found")).toBe("Aucun Hotspot actif n’a été détecté sur ce routeur.");
  });

  it("filtre par date, niveau, catégorie, routeur et profil", () => {
    const logs = createDemoLogs();
    const filtered = filterLogs(logs, {
      ...emptyLogFilters,
      category: "tickets",
      dateFrom: "2026-07-09",
      dateTo: "2026-07-09",
      level: "warning",
      routerId: "routeur-demo",
      userProfile: "operator"
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].action).toBe("createTickets");
  });

  it("recherche dans le message, l'action et le routeur sans tenir compte de la casse", () => {
    const logs = createDemoLogs();

    expect(filterLogs(logs, { ...emptyLogFilters, query: "ROUTEUR DÉMO" }).length).toBeGreaterThan(0);
    expect(filterLogs(logs, { ...emptyLogFilters, query: "createTickets" })).toHaveLength(1);
    expect(filterLogs(logs, { ...emptyLogFilters, query: "introuvable" })).toHaveLength(0);
  });

  it("exporte les logs sans détail technique masqué", () => {
    const csv = exportLogsToCsv(createDemoLogs().slice(0, 1));

    expect(csv).toContain('"Connexion Opérateur réussie."');
    expect(csv).not.toContain("session=local");
  });

  it("neutralise les formules tableur dans l'export CSV", () => {
    const csv = exportLogsToCsv([
      { ...createDemoLogs()[0], userMessage: "=HYPERLINK(\"https://example.test\")" }
    ]);

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.test\"\")\"");
  });

  it("réserve le nettoyage à l’Admin", () => {
    expect(canCleanLogs("admin")).toBe(true);
    expect(canCleanLogs("operator")).toBe(false);
    expect(canCleanLogs(null)).toBe(false);
  });

  it("normalise un journal persistant et masque ses secrets", () => {
    const log = appLogFromRecord({
      account_id: "account-a",
      category: "categorie-inconnue",
      created_at: "2026-07-29T10:00:00.000Z",
      created_by_profile: "account-a:internal-profile-admin",
      id: "log-1",
      internal_profile_id: "account-a:internal-profile-admin",
      level: "error",
      router_id: "router-a",
      technical_message:
        '{"version":1,"action":"testConnection","code":"router_rejected","detail":"password=secret token=abc"}',
      user_message: "Connexion refusée."
    }, new Map([["router-a", "Routeur A"]]));

    expect(log).toMatchObject({
      action: "testConnection",
      category: "systeme",
      routerName: "Routeur A",
      userProfile: "admin"
    });
    expect(log.technicalDetail).toContain("password=[MASQUÉ]");
    expect(log.technicalDetail).toContain("token=[MASQUÉ]");
    expect(log.technicalDetail).not.toContain("secret");
  });

  it("pagine les journaux sans produire de page zéro", () => {
    const logs = createDemoLogs();
    expect(getLogPageCount(0, 5)).toBe(1);
    expect(getLogPageCount(12, 5)).toBe(3);
    expect(paginateLogs(logs, 2, 5)).toEqual(logs.slice(5, 10));
  });
  it("rattache les logs au compte et limite les profils sans lecture globale", () => {
    const logs = [
      ...createDemoLogs(),
      {
        ...createDemoLogs()[0],
        accountId: "account-douma-demo",
        id: "log-agent-001",
        internalProfileId: "account-douma-demo:internal-profile-agent",
        userProfile: "agent" as const
      }
    ];
    const scoped = scopeLogsForSession(logs, agentSession);

    expect(createDemoLogs().every((log) => log.accountId)).toBe(true);
    expect(scoped).toHaveLength(1);
    expect(scoped.every((log) => log.accountId === "account-douma-demo")).toBe(true);
    expect(scoped.every((log) => log.internalProfileId === "account-douma-demo:internal-profile-agent")).toBe(true);
  });
});
