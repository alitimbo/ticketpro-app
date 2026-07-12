import { beforeEach, describe, expect, it } from "vitest";
import { emptyReportFilters, filterReportTickets, createDemoReportTickets } from "../../pages/router/reportPageModel";
import { InMemoryDatabaseClient } from "./InMemoryDatabaseClient";
import { RouterRepository } from "./repositories/RouterRepository";
import { TicketBatchRepository } from "./repositories/TicketBatchRepository";
import { TicketRepository } from "./repositories/TicketRepository";
import { createTableRepository } from "./repositories/TableRepository";

const accountId = "account-douma-demo";
const profileId = "account-douma-demo:internal-profile-agent";

describe("rattachement des données au compte et au profil", () => {
  let database: InMemoryDatabaseClient;

  beforeEach(async () => {
    database = new InMemoryDatabaseClient();
    await database.initialize();
  });

  it("1. rattache un routeur au compte principal", async () => {
    const routers = new RouterRepository(database);
    const created = await routers.create({
      account_id: accountId,
      api_port: 8728,
      api_ssl_port: 8729,
      board_name: "C52iG-5HaxD2HaxD",
      connection_mode: "local",
      created_by_profile_id: profileId,
      encrypted_password: "secret://router/router-owned/password",
      id: "router-owned",
      label: "Zone principale",
      last_seen_at: null,
      local_ip: "192.168.88.1",
      model: "hAP ax²",
      name: "zone-principale",
      routeros_version: "7.x",
      serial_number: "SERIAL-TEST",
      status: "active",
      username: "api-user",
      zone_id: "zone-main"
    });

    expect(created).toMatchObject({ account_id: accountId, created_by_profile_id: profileId });
    await expect(routers.listByAccount(accountId)).resolves.toHaveLength(1);
    await expect(routers.listByAccount("account-other")).resolves.toHaveLength(0);
  });

  it("2. rattache un ticket_batch au compte principal", async () => {
    const batches = new TicketBatchRepository(database);
    const batch = await batches.create({
      account_id: accountId,
      code_length: 7,
      created_by_profile: "agent",
      created_by_profile_id: profileId,
      generated_file_id: null,
      id: "batch-owned",
      operator_profile: "agent",
      plan_id: "plan-3h",
      prefix: null,
      quantity: 20,
      router_id: "router-owned",
      status: "generated"
    });

    expect(batch).toMatchObject({ account_id: accountId, created_by_profile_id: profileId });
    await expect(batches.listByAccount(accountId, profileId)).resolves.toHaveLength(1);
  });

  it("3. rattache un ticket au compte principal", async () => {
    const tickets = new TicketRepository(database);
    const ticket = await tickets.create({
      account_id: accountId,
      activated_at: null,
      batch_id: "batch-owned",
      completed_at: null,
      created_by_profile: "agent",
      created_by_profile_id: profileId,
      deleted_at: null,
      downloaded_bytes: 0,
      expires_at: null,
      id: "ticket-owned",
      ip_address: null,
      mac_address: null,
      mikrotik_id: null,
      password_encrypted: "secret://ticket/ticket-owned/password",
      plan_id: "plan-3h",
      printed_count: 0,
      router_id: "router-owned",
      status: "available",
      uploaded_bytes: 0,
      username: "7384921"
    });

    expect(ticket).toMatchObject({ account_id: accountId, created_by_profile_id: profileId });
    await expect(tickets.listByAccount(accountId, profileId)).resolves.toHaveLength(1);
  });

  it("4. rattache un log au profil interne actif", async () => {
    const logs = createTableRepository(database, "app_logs");
    const log = await logs.create({
      account_id: accountId,
      category: "tickets",
      created_by_profile: "agent",
      id: "log-owned",
      internal_profile_id: profileId,
      level: "info",
      router_id: "router-owned",
      technical_message: null,
      user_message: "Lot de tickets créé."
    });

    expect(log).toMatchObject({ account_id: accountId, internal_profile_id: profileId });
  });

  it("5. filtre le rapport par profil interne", () => {
    const filtered = filterReportTickets(createDemoReportTickets(), {
      ...emptyReportFilters,
      dateFrom: "",
      dateTo: "",
      internalProfileId: profileId
    });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((ticket) => ticket.createdByProfileId === profileId)).toBe(true);
  });
});
