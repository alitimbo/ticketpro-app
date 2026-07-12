import { afterEach, describe, expect, it } from "vitest";
import { createDemoTickets, scopeTicketsForSession } from "../../pages/router/ticketsPageModel";
import { InMemoryDatabaseClient } from "../database/InMemoryDatabaseClient";
import { TicketBatchRepository } from "../database/repositories/TicketBatchRepository";
import {
  defaultAccountSubscription,
  getSubscriptionOverview,
  saveAccountSubscription
} from "../../pages/global/subscriptionPageModel";
import {
  clearMainAccountSession,
  createMainAccountSession,
  hashMainAccountPassword,
  readMainAccountRecord,
  readMainAccountSession,
  saveMainAccountRecord,
  storeMainAccountSession,
  verifyMainAccount
} from "./mainAccount";
import { findInternalProfile, isInternalProfileEnabled } from "./internalProfiles";
import { allPermissions, hasPermission } from "./permissions";
import { verifyDevelopmentPassword } from "./passwords";
import {
  clearStoredSession,
  createSession,
  readStoredSession,
  storeSession
} from "./session";

const accountEmail = "doumacorporation@gmail.com";
const accountId = "account-douma-demo";

afterEach(() => {
  localStorage.clear();
});

describe("authentification compte principal et profil interne", () => {
  it("1. accepte une connexion compte principal valide", async () => {
    await expect(verifyMainAccount(accountEmail, "test123")).resolves.toBe(true);
  });

  it("2. refuse une connexion compte principal invalide", async () => {
    await expect(verifyMainAccount(accountEmail, "mot-de-passe-invalide")).resolves.toBe(false);
    await expect(verifyMainAccount("inconnu@example.com", "test123")).resolves.toBe(false);
  });

  it("3. refuse la connexion d'un compte suspendu", async () => {
    const account = readMainAccountRecord(accountEmail)!;
    saveMainAccountRecord({
      ...account,
      passwordHash: await hashMainAccountPassword(accountEmail, "test123"),
      status: "suspended"
    });

    await expect(verifyMainAccount(accountEmail, "test123")).resolves.toBe(false);
  });

  it("4. reconnaît un abonnement expiré sans invalider les identifiants du compte", async () => {
    saveAccountSubscription(
      {
        ...defaultAccountSubscription,
        currentPeriodEnd: "2026-07-01T00:00:00.000Z",
        status: "expired"
      },
      accountId
    );

    await expect(verifyMainAccount(accountEmail, "test123")).resolves.toBe(true);
    expect(getSubscriptionOverview(0, accountId, Date.parse("2026-07-11T00:00:00.000Z")).canAddRouter).toBe(false);
  });

  it("5. permet de choisir un profil interne activé avec son mot de passe", async () => {
    expect(findInternalProfile("operator")).toMatchObject({ isEnabled: true, role: "operator" });
    expect(isInternalProfileEnabled("operator")).toBe(true);
    await expect(verifyDevelopmentPassword("operator", "operateur123")).resolves.toBe(true);
  });

  it("6. refuse un mot de passe de profil incorrect", async () => {
    await expect(verifyDevelopmentPassword("agent", "incorrect")).resolves.toBe(false);
  });

  it("7. crée et conserve une session de profil liée au compte", () => {
    const session = createSession("operator", accountEmail, Date.now(), "Opérateur", accountId);
    storeSession(session);

    expect(readStoredSession()).toMatchObject({
      account_email: accountEmail,
      account_id: accountId,
      internal_profile_id: "account-douma-demo:internal-profile-operator",
      internal_profile_role: "operator"
    });
  });

  it("8. déconnecte le profil sans déconnecter le compte principal", () => {
    storeMainAccountSession(createMainAccountSession(accountEmail));
    storeSession(createSession("operator", accountEmail, Date.now(), "Opérateur", accountId));

    clearStoredSession();

    expect(readStoredSession()).toBeNull();
    expect(readMainAccountSession()).not.toBeNull();
  });

  it("9. déconnecte complètement le compte et le profil", () => {
    storeMainAccountSession(createMainAccountSession(accountEmail));
    storeSession(createSession("admin", accountEmail, Date.now(), "Admin", accountId));

    clearStoredSession();
    clearMainAccountSession();

    expect(readStoredSession()).toBeNull();
    expect(readMainAccountSession()).toBeNull();
  });
});

describe("permissions par profil interne", () => {
  it("1. donne toutes les permissions à l'Admin", () => {
    expect(allPermissions.every((permission) => hasPermission("admin", permission))).toBe(true);
  });

  it("2. masque les paramètres sensibles à l'Opérateur", () => {
    expect(hasPermission("operator", "router.tickets.generate")).toBe(true);
    expect(hasPermission("operator", "global.settings")).toBe(false);
    expect(hasPermission("operator", "global.settings.profiles")).toBe(false);
    expect(hasPermission("operator", "router.settings.manage")).toBe(false);
  });

  it("3. limite l'Agent à ses propres lots et tickets", async () => {
    const session = createSession("agent", accountEmail, Date.now(), "Agent", accountId);
    const visibleTickets = scopeTicketsForSession(createDemoTickets(), session);
    const database = new InMemoryDatabaseClient();
    const batches = new TicketBatchRepository(database);
    await database.initialize();
    await Promise.all(
      (["agent", "operator"] as const).map((role) =>
        batches.create({
          account_id: accountId,
          code_length: 6,
          created_by_profile: role,
          created_by_profile_id: `${accountId}:internal-profile-${role}`,
          generated_file_id: null,
          id: `batch-${role}`,
          operator_profile: role,
          plan_id: "plan-demo",
          prefix: null,
          quantity: 20,
          router_id: "routeur-demo",
          status: "generated"
        })
      )
    );
    const visibleBatches = await batches.listByAccount(accountId, session.internal_profile_id);

    expect(visibleTickets.length).toBeGreaterThan(0);
    expect(visibleTickets.every((ticket) => ticket.accountId === accountId)).toBe(true);
    expect(visibleTickets.every((ticket) => ticket.createdByProfileId === session.internal_profile_id)).toBe(true);
    expect(visibleBatches.map((batch) => batch.id)).toEqual(["batch-agent"]);
  });

  it("4. garde l'Invité en lecture seule", () => {
    const writePermissions = [
      "global.routers.add",
      "global.routers.edit",
      "router.plans.write",
      "router.tickets.generate",
      "router.tickets.delete",
      "router.clients.disconnect"
    ] as const;

    expect(hasPermission("guest", "router.tickets.read")).toBe(true);
    expect(hasPermission("guest", "router.report.read")).toBe(true);
    expect(writePermissions.every((permission) => !hasPermission("guest", permission))).toBe(true);
  });
});
