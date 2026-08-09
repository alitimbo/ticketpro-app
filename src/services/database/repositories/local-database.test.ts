import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { GeneratedFileRepository } from "./GeneratedFileRepository";
import { HotspotPlanRepository } from "./HotspotPlanRepository";
import { RouterRepository } from "./RouterRepository";
import { TicketBatchRepository } from "./TicketBatchRepository";
import { TicketRepository } from "./TicketRepository";
import { createTableRepository } from "./TableRepository";

describe("repositories SQLite locaux", () => {
  it("créent et relisent un routeur, un plan, un lot, des tickets et un fichier", async () => {
    const database = new InMemoryDatabaseClient();
    const routers = new RouterRepository(database);
    const plans = new HotspotPlanRepository(database);
    const batches = new TicketBatchRepository(database);
    const tickets = new TicketRepository(database);
    const files = new GeneratedFileRepository(database);

    await database.initialize();

    const router = await routers.create({
      account_id: "account-douma-demo",
      api_port: 8728,
      api_ssl_port: 8729,
      board_name: "RB750Gr3",
      connection_mode: "local",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      encrypted_password: "secret://router-test/password",
      id: "router-test",
      label: "Routeur test",
      last_seen_at: null,
      local_ip: "192.168.88.1",
      model: "hEX",
      name: "routeur-test",
      routeros_version: "7.x",
      serial_number: "TEST",
      status: "active",
      username: "admin",
      zone_id: "zone-test"
    });
    await routers.create({
      account_id: "account-autre-demo",
      api_port: 8728,
      api_ssl_port: 8729,
      board_name: "RB750Gr3",
      connection_mode: "local",
      created_by_profile_id: "account-autre-demo:internal-profile-admin",
      encrypted_password: "secret://router-other/password",
      id: "router-other",
      label: "Autre routeur",
      last_seen_at: null,
      local_ip: "192.168.99.1",
      model: "hEX",
      name: "router-other",
      routeros_version: "7.x",
      serial_number: "OTHER",
      status: "active",
      subscription_counted: 1,
      username: "admin",
      zone_id: "zone-other"
    });

    const plan = await plans.create({
      data_limit_mb: null,
      download_limit: "5M",
      duration_minutes: 1440,
      id: "plan-test",
      mikrotik_profile_name: "plan-test",
      name: "Journée",
      price_hint: 500,
      router_id: router.id,
      shared_users: 1,
      status: "active",
      upload_limit: "2M",
      validity_minutes: 1440
    });

    const batch = await batches.create({
      account_id: "account-douma-demo",
      code_length: 6,
      created_by_profile: "operator",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      generated_file_id: null,
      id: "batch-test",
      operator_profile: "operator",
      plan_id: plan.id,
      prefix: "J",
      quantity: 2,
      router_id: router.id,
      status: "generated"
    });

    await tickets.create({
      account_id: "account-douma-demo",
      activated_at: null,
      batch_id: batch.id,
      completed_at: null,
      created_by_profile: "operator",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      deleted_at: null,
      downloaded_bytes: 0,
      expires_at: null,
      id: "ticket-test-001",
      ip_address: null,
      mac_address: null,
      mikrotik_id: null,
      password_encrypted: "secret://ticket-test-001/password",
      plan_id: plan.id,
      printed_count: 0,
      router_id: router.id,
      status: "available",
      uploaded_bytes: 0,
      username: "J001"
    });
    await tickets.create({
      account_id: "account-douma-demo",
      activated_at: null,
      batch_id: batch.id,
      completed_at: null,
      created_by_profile: "operator",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      deleted_at: null,
      downloaded_bytes: 0,
      expires_at: null,
      id: "ticket-test-002",
      ip_address: null,
      mac_address: null,
      mikrotik_id: null,
      password_encrypted: "secret://ticket-test-002/password",
      plan_id: plan.id,
      printed_count: 0,
      router_id: router.id,
      status: "available",
      uploaded_bytes: 0,
      username: "J002"
    });

    const file = await files.create({
      account_id: "account-douma-demo",
      batch_id: batch.id,
      created_by_profile: "operator",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      file_name: "tickets-test.pdf",
      file_path: "files/tickets-test.pdf",
      format: "pdf",
      id: "file-test",
      router_id: router.id,
      type: "tickets_pdf"
    });
    await files.upsert({
      account_id: "account-douma-demo",
      batch_id: batch.id,
      created_by_profile: "operator",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      file_name: "tickets-test-thermal58.pdf",
      file_path: "files/tickets-test-thermal58.pdf",
      format: "thermal58",
      id: file.id,
      metadata_json: '{"format":"thermal58"}',
      router_id: router.id,
      type: "tickets_pdf"
    });

    await expect(routers.findById("router-test")).resolves.toMatchObject({ label: "Routeur test" });
    await expect(plans.listByRouter(router.id)).resolves.toHaveLength(1);
    await expect(batches.listByRouter(router.id)).resolves.toHaveLength(1);
    await expect(tickets.listByBatch(batch.id)).resolves.toHaveLength(2);
    await expect(batches.findById(batch.id)).resolves.toMatchObject({
      created_by_profile_id: "account-douma-demo:internal-profile-operator"
    });
    await expect(files.findById(file.id)).resolves.toMatchObject({
      file_name: "tickets-test-thermal58.pdf",
      format: "thermal58",
      metadata_json: '{"format":"thermal58"}'
    });
    await expect(routers.findById("router-test")).resolves.toMatchObject({
      account_id: "account-douma-demo",
      created_by_profile_id: "account-douma-demo:internal-profile-operator",
      subscription_counted: 1
    });
    await expect(routers.listByAccount("account-douma-demo")).resolves.toHaveLength(1);
    await expect(routers.countSubscriptionRoutersByAccount("account-douma-demo")).resolves.toBe(1);
  });

  it("crée et relit un compte principal avec profil interne et abonnement", async () => {
    const database = new InMemoryDatabaseClient();
    const accounts = createTableRepository(database, "accounts");
    const profiles = createTableRepository(database, "internal_profiles");
    const plans = createTableRepository(database, "subscription_plans");
    const subscriptions = createTableRepository(database, "account_subscriptions");

    await database.initialize();

    await accounts.create({
      company_name: "Douma Corporation",
      display_name: "Douma Corporation",
      email: "doumacorporation@gmail.com",
      id: "account-douma-demo",
      last_login_at: null,
      password_hash: "hash-only",
      phone: null,
      status: "active"
    });
    await profiles.create({
      account_id: "account-douma-demo",
      display_name: "Admin",
      id: "account-douma-demo:internal-profile-admin",
      is_enabled: 1,
      last_used_at: null,
      password_hash: "hash-only",
      permissions_json: "[\"global.home\"]",
      role: "admin"
    });
    await plans.create({
      billing_period: "monthly",
      description: "Idéal pour un seul site WiFi ou une petite zone.",
      id: "subscription-plan-1-router",
      is_active: 1,
      is_recommended: 0,
      name: "Pack 1 routeur",
      price_cfa: 1500,
      price_per_router_cfa: 1500,
      router_limit: 1
    });
    await subscriptions.create({
      account_id: "account-douma-demo",
      current_period_end: "2026-08-09T00:00:00.000Z",
      current_period_start: "2026-07-09T00:00:00.000Z",
      id: "subscription-douma-demo-current",
      payment_status: "manual",
      price_cfa_snapshot: 1500,
      price_per_router_cfa_snapshot: 1500,
      router_limit_snapshot: 1,
      status: "active",
      subscription_plan_id: "subscription-plan-1-router"
    });

    await expect(accounts.findById("account-douma-demo")).resolves.toMatchObject({
      email: "doumacorporation@gmail.com",
      password_hash: "hash-only"
    });
    await expect(profiles.findById("account-douma-demo:internal-profile-admin")).resolves.toMatchObject({
      account_id: "account-douma-demo",
      role: "admin"
    });
    await expect(plans.findById("subscription-plan-1-router")).resolves.toMatchObject({
      description: "Idéal pour un seul site WiFi ou une petite zone.",
      is_recommended: 0,
      router_limit: 1,
      price_cfa: 1500,
      price_per_router_cfa: 1500
    });
    await expect(subscriptions.findById("subscription-douma-demo-current")).resolves.toMatchObject({
      price_cfa_snapshot: 1500,
      price_per_router_cfa_snapshot: 1500,
      router_limit_snapshot: 1,
      payment_status: "manual"
    });
  });
});
