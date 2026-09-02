import { describe, expect, it } from "vitest";
import {
  buildFileName,
  buildTicketBatch,
  buildTicketRecord,
  createInitialTicketGenerationState,
  defaultTicketGenerationOptions,
  findConfirmedVoucherBatchUsers,
  getTicketSummary,
  inspectVoucherBatchIntegrity,
  validateTicketGeneration
} from "./ticketGenerationModel";

const routers = [
  {
    connectionMode: "local" as const,
    host: "192.168.88.1",
    id: "routeur-demo",
    isReachable: true,
    name: "Routeur démo"
  }
];

const plans = [
  {
    dataLimitMb: 2048,
    downloadLimit: "5M",
    durationMinutes: 180,
    id: "plan-3h",
    name: "3h-2Go",
    priceHint: 500,
    profileName: "plan-3h",
    sharedUsers: 1,
    status: "active" as const,
    uploadLimit: "2M",
    validityMinutes: 180
  }
];
const servers = [
  { addressPool: "pool-1", id: "*1", interfaceName: "bridge-1", isEnabled: true, name: "hotspot1", profileName: "default" },
  { addressPool: "pool-2", id: "*2", interfaceName: "bridge-2", isEnabled: true, name: "hotspot2", profileName: "default" }
];

describe("ticketGenerationModel", () => {
  it("nomme le PDF avec le routeur, le plan, le prix et la quantité", () => {
    expect(buildFileName({
      batchId: "batch-a1b2c3d4-e5f6",
      currency: "EUR",
      generatedAt: new Date("2026-08-11T15:25:30.000Z"),
      planName: "6 h / 2 Go",
      price: 100,
      quantity: 5,
      routerName: "TicketPro Lab Niamey"
    })).toBe("TicketPro-Lab-Niamey-6-h-2-Go-100EUR-5tickets-20260811-152530-a1b2c3d4.pdf");
  });

  it("produit un nom Windows valide lorsque le prix n'est pas défini", () => {
    const fileName = buildFileName({
      batchId: "batch-test",
      currency: "USD",
      generatedAt: new Date("2026-08-11T15:25:30.000Z"),
      planName: "Journée: VIP?",
      price: null,
      quantity: 20,
      routerName: "Routeur Démo / Boutique"
    });

    expect(fileName).toBe("Routeur-Demo-Boutique-Journee-VIP-prix-non-defini-USD-20tickets-20260811-152530-test.pdf");
    expect(fileName).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("désactive le QR code par défaut", () => {
    expect(defaultTicketGenerationOptions.generateQrCode).toBe(false);
  });

  it("valide un lot simple de 20 tickets pour opérateur", () => {
    const state = {
      ...createInitialTicketGenerationState("routeur-demo"),
      selectedPlanId: "plan-3h"
    };

    expect(validateTicketGeneration(state, routers, plans)).toBeNull();
    expect(
      validateTicketGeneration({ ...state, quantity: "custom", customQuantity: "0" }, routers, plans)
    ).toBe("Choisissez une quantité entre 1 et 200.");
    expect(
      validateTicketGeneration(
        { ...state, quantity: "custom", customQuantity: "200" },
        routers,
        plans
      )
    ).toBeNull();
    expect(
      validateTicketGeneration(
        { ...state, quantity: "custom", customQuantity: "201" },
        routers,
        plans
      )
    ).toBe("Choisissez une quantité entre 1 et 200.");
  });

  it("interdit le profil RouterOS default pour protéger son ownership externe", () => {
    const state = {
      ...createInitialTicketGenerationState("routeur-demo"),
      selectedPlanId: "plan-default"
    };
    const defaultPlan = {
      ...plans[0],
      id: "plan-default",
      name: "default",
      profileName: "default"
    };

    expect(validateTicketGeneration(state, routers, [defaultPlan])).toBe(
      "Le profil RouterOS default est réservé. Créez ou sélectionnez un forfait dédié."
    );
  });

  it("prépare le lot local et le résumé sans secret en clair", () => {
    const batch = buildTicketBatch({
      accountId: "account-douma-demo",
      currency: "XOF",
      id: "batch-test",
      operatorProfileId: "account-douma-demo:internal-profile-operator",
      operatorRole: "operator",
      options: {
        ...defaultTicketGenerationOptions,
        codeLength: 6,
        createPdf: false,
        excludeAmbiguous: true,
        generateQrCode: false,
        prefix: "",
        usernameEqualsPassword: true
      },
      planId: "plan-3h",
      priceSnapshot: 500,
      quantity: 20,
      routerId: "routeur-demo",
      syncStatus: "synced"
    });
    const summary = getTicketSummary({
      operatorRole: "operator",
      plan: plans[0],
      quantity: 20,
      router: routers[0],
      syncStatus: "synced"
    });

    expect(batch).toMatchObject({
      created_by_profile: "operator",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      currency: "XOF",
      generated_file_id: "batch-test-pdf",
      price_snapshot: 500,
      quantity: 20,
      status: "terminé",
      sync_status: "synced"
    });
    expect(summary).toMatchObject({
      operator: "Opérateur",
      plan: "3h-2Go",
      router: "Routeur démo",
      totalValue: 10000
    });
    expect(JSON.stringify(batch)).not.toContain("password");

    const ticket = buildTicketRecord({
      accountId: "account-douma-demo",
      batchId: batch.id,
      createdByProfile: "operator",
      createdByProfileId: "account-douma-demo:internal-profile-operator",
      mikrotikId: null,
      passwordSecretRef: "secret://routeur-demo/123456/password",
      planId: plans[0].id,
      planSnapshot: plans[0],
      routerId: "routeur-demo",
      status: "disponible",
      syncStatus: "pending",
      username: "123456"
    });
    expect(ticket).toMatchObject({
      data_limit_mb_snapshot: 2048,
      download_limit_snapshot: "5M",
      duration_minutes_snapshot: 180,
      shared_users_snapshot: 1,
      upload_limit_snapshot: "2M",
      validity_minutes_snapshot: 180
    });
  });

  it("oblige à choisir un serveur ou All lorsque plusieurs Hotspots existent", () => {
    const state = {
      ...createInitialTicketGenerationState("routeur-demo"),
      selectedPlanId: "plan-3h"
    };
    expect(validateTicketGeneration(state, routers, plans, servers)).toContain("Choisissez un serveur");
    expect(validateTicketGeneration({ ...state, selectedServerName: "all" }, routers, plans, servers)).toBeNull();
    expect(validateTicketGeneration({ ...state, selectedServerName: "hotspot2" }, routers, plans, servers)).toBeNull();
  });
  it("confirme exactement les vouchers du lot et ignore les utilisateurs RouterOS externes", () => {
    const batchId = "batch-100";
    const pendingTickets = Array.from({ length: 100 }, (_, index) => ({
      username: `TP${String(index + 1).padStart(3, "0")}`
    }));
    const managedUsers = pendingTickets.map((ticket, index) => ({
      bytesIn: 0,
      bytesOut: 0,
      comment: `TicketPro:v1;batch=${batchId};`,
      createdAt: "2026-08-30T00:00:00.000Z",
      disabled: false,
      id: `*${index + 1}`,
      limitBytesTotal: null,
      limitUptime: "1h",
      macAddress: null,
      passwordSecretRef: `secret://test/${ticket.username}/password`,
      planId: "plan-1h",
      profileName: "plan-1h",
      serverName: "all",
      status: "available" as const,
      uptime: "0s",
      username: ticket.username
    }));
    const routerUsers = [
      ...managedUsers,
      { ...managedUsers[0], comment: "TicketPro:v1;batch=ancien-lot;", id: "*101", username: "ANCIEN01" },
      { ...managedUsers[0], comment: "Utilisateur externe", id: "*102", username: "EXTERNE01" }
    ];

    const confirmed = findConfirmedVoucherBatchUsers({
      batchId,
      pendingTickets,
      profileName: "plan-1h",
      routerUsers
    });

    expect(routerUsers).toHaveLength(102);
    expect(confirmed).toHaveLength(100);
    expect(confirmed.map((user) => user.username)).toEqual(pendingTickets.map((ticket) => ticket.username));
  });

  it("refuse un lot RouterOS qui contient plus de vouchers que la quantité demandée", () => {
    const batchId = "batch-exact-100";
    const expectedTickets = Array.from({ length: 100 }, (_, index) => ({
      username: `TP${String(index + 1).padStart(3, "0")}`
    }));
    const makeUser = (username: string, id: string) => ({
      bytesIn: 0,
      bytesOut: 0,
      comment: `TicketPro:v1;batch=${batchId};`,
      createdAt: "2026-08-30T00:00:00.000Z",
      disabled: false,
      id,
      limitBytesTotal: null,
      limitUptime: "1h",
      macAddress: null,
      passwordSecretRef: `secret://test/${username}/password`,
      planId: "plan-1h",
      profileName: "plan-1h",
      serverName: "all",
      status: "available" as const,
      uptime: "0s",
      username
    });
    const routerUsers = [
      ...expectedTickets.map((ticket, index) => makeUser(ticket.username, `*${index + 1}`)),
      makeUser("EXTRA101", "*101"),
      makeUser("EXTRA102", "*102")
    ];

    const integrity = inspectVoucherBatchIntegrity({
      batchId,
      expectedTickets,
      profileName: "plan-1h",
      routerUsers
    });

    expect(integrity.isExact).toBe(false);
    expect(integrity.managedQuantity).toBe(102);
    expect(integrity.unexpectedUsernames).toEqual(["EXTRA101", "EXTRA102"]);
  });

  it("valide uniquement un lot RouterOS exactement identique aux 100 vouchers attendus", () => {
    const batchId = "batch-exact-ok";
    const expectedTickets = Array.from({ length: 100 }, (_, index) => ({ username: `OK${index + 1}` }));
    const routerUsers = expectedTickets.map((ticket, index) => ({
      bytesIn: 0,
      bytesOut: 0,
      comment: `TicketPro:v1;batch=${batchId};`,
      createdAt: "2026-08-30T00:00:00.000Z",
      disabled: false,
      id: `*${index + 1}`,
      limitBytesTotal: null,
      limitUptime: "1h",
      macAddress: null,
      passwordSecretRef: `secret://test/${ticket.username}/password`,
      planId: "plan-1h",
      profileName: "plan-1h",
      serverName: "all",
      status: "available" as const,
      uptime: "0s",
      username: ticket.username
    }));

    expect(inspectVoucherBatchIntegrity({
      batchId,
      expectedTickets,
      profileName: "plan-1h",
      routerUsers
    })).toMatchObject({ isExact: true, managedQuantity: 100 });
  });
});
