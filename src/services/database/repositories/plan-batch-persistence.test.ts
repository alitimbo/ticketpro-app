import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { HotspotPlanRepository } from "./HotspotPlanRepository";
import { TicketBatchRepository } from "./TicketBatchRepository";

describe("persistance plans et lots", () => {
  it("modifie un plan et crée un lot avec ses tickets atomiquement", async () => {
    const database = new InMemoryDatabaseClient();
    const plans = new HotspotPlanRepository(database);
    const batches = new TicketBatchRepository(database);
    await database.initialize();

    await plans.create({
      data_limit_mb: 1024,
      download_limit: "5M",
      duration_minutes: 60,
      id: "plan-test",
      mikrotik_profile_name: "plan-test",
      name: "1 heure",
      price_hint: 500,
      router_id: "router-test",
      shared_users: 1,
      status: "active",
      upload_limit: "2M",
      validity_minutes: 180
    });
    const updated = await plans.update({
      data_limit_mb: 2048,
      download_limit: "8M",
      duration_minutes: 120,
      id: "plan-test",
      mikrotik_profile_name: "plan-test",
      name: "2 heures",
      price_hint: 800,
      router_id: "router-test",
      shared_users: 1,
      status: "active",
      upload_limit: "3M",
      validity_minutes: 300
    });

    expect(updated.name).toBe("2 heures");

    await batches.createWithTickets(
      {
        account_id: "account-test",
        code_length: 6,
        created_by_profile: "operator",
        created_by_profile_id: "account-test:internal-profile-operator",
        generated_file_id: null,
        id: "batch-test",
        operator_profile: "operator",
        plan_id: "plan-test",
        prefix: null,
        quantity: 1,
        router_id: "router-test",
        status: "terminé",
        sync_status: "synced"
      },
      [
        {
          account_id: "account-test",
          activated_at: null,
          batch_id: "batch-test",
          completed_at: null,
          created_by_profile: "operator",
          created_by_profile_id: "account-test:internal-profile-operator",
          deleted_at: null,
          downloaded_bytes: 0,
          expires_at: null,
          id: "ticket-test",
          ip_address: null,
          mac_address: null,
          mikrotik_id: "*1",
          password_encrypted: "secret://ticket-test/password",
          plan_id: "plan-test",
          printed_count: 0,
          router_id: "router-test",
          status: "disponible",
          sync_status: "synced",
          uploaded_bytes: 0,
          username: "ABC123"
        }
      ]
    );

    await expect(database.query("SELECT * FROM tickets WHERE batch_id = ?1", ["batch-test"])).resolves.toHaveLength(1);
    await expect(
      batches.updateState("batch-test", "account-test", "partiel", "pending")
    ).resolves.toMatchObject({ status: "partiel", sync_status: "pending" });
    await plans.remove("plan-test");
    await expect(plans.findById("plan-test")).resolves.toBeNull();
  });
});
