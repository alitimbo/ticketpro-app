import { describe, expect, it } from "vitest";
import type { RouterManagedResourceManifest } from "../../domain/router";
import {
  InMemoryDatabaseClient,
  RouterManagedResourceManifestRepository,
  RouterRepository,
  SyncOutboxRepository,
  VpnPeerRepository
} from "../database";
import { SyncObservabilityService } from "./SyncObservabilityService";

const now = "2026-08-28T12:00:00.000Z";

describe("SyncObservabilityService", () => {
  it("confirme un état sain uniquement après une lecture RouterOS réelle", async () => {
    const database = await context("local");
    const report = await new SyncObservabilityService(database).inspect({
      accountId: "account-1",
      liveRouterObservedAt: now,
      liveTicketsObservedAt: now,
      now,
      routerId: "router-1"
    });

    expect(report.status).toBe("success");
    expect(report.alerts).toEqual([]);
    expect(report.freshness.find((item) => item.id === "router")).toMatchObject({
      checkedAt: now,
      status: "success"
    });
  });

  it("n'invente pas une fraîcheur quand le routeur n'a jamais été observé", async () => {
    const database = await context("local", { lastSeenAt: null });
    const report = await new SyncObservabilityService(database).inspect({
      accountId: "account-1",
      now,
      routerId: "router-1"
    });

    expect(report.status).toBe("warning");
    expect(report.alerts).toContainEqual(expect.objectContaining({ code: "ROUTER_DATA_MISSING" }));
  });

  it("confirme l'accès VPN par une lecture RouterOS réelle même si le pair local est encore en brouillon", async () => {
    const database = await context("vpn");
    await new VpnPeerRepository(database).create({
      ...peer("peer-router", "router-1", "router-1"),
      status: "draft"
    });

    const report = await new SyncObservabilityService(database).inspect({
      accountId: "account-1",
      liveRouterObservedAt: now,
      now,
      routerId: "router-1"
    });

    expect(report.alerts.map((alert) => alert.code)).not.toContain("VPN_PEER_DRAFT");
    expect(report.freshness.find((item) => item.id === "vpn")).toMatchObject({
      checkedAt: now,
      message: "Accès distant confirmé par une lecture RouterOS réelle.",
      status: "success"
    });
  });

  it("remonte les opérations échouées, les doublons et les anciennes données mal encodées", async () => {
    const database = await context("local");
    await insertTicket(database, "ticket-1", "voucher-1", "Ã‰puisÃ©");
    await insertTicket(database, "ticket-2", "VOUCHER-1", "available");
    const outbox = new SyncOutboxRepository(database);
    const operation = await outbox.enqueue({
      account_id: "account-1",
      aggregate_id: "ticket-1",
      aggregate_type: "ticket",
      correlation_id: "batch-1",
      idempotency_key: "test:failed",
      max_attempts: 8,
      operation_type: "routeros.voucher.create",
      payload: { ticketId: "ticket-1" },
      priority: 100,
      router_id: "router-1"
    });
    await outbox.markFailed(operation.id, "account-1", "TEST_FAILURE", "Panne injectée", now);

    const report = await new SyncObservabilityService(database).inspect({
      accountId: "account-1",
      liveRouterObservedAt: now,
      liveTicketsObservedAt: now,
      now,
      routerId: "router-1"
    });

    expect(report.status).toBe("error");
    expect(report.alerts.map((alert) => alert.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_LOCAL_VOUCHER",
      "LEGACY_STATUS_ENCODING",
      "OUTBOX_FAILED"
    ]));
    expect(report.incidents[0]).toMatchObject({
      code: "TEST_FAILURE",
      correlationId: "batch-1",
      status: "failed"
    });
  });

  it("détecte un routeur VPN sans pair et les affectations VPN dupliquées", async () => {
    const database = await context("vpn");
    const peers = new VpnPeerRepository(database);
    await peers.create(peer("peer-a", "resource-a", null));
    await database.execute(
      `INSERT INTO vpn_peers (
        id, account_id, network_id, router_id, resource_id, peer_type, name, public_key,
        private_key_encrypted, assigned_address, allowed_ips, endpoint_address,
        endpoint_port, status, last_handshake_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      [
        "peer-b", "account-1", "network-1", null, "resource-b", "operator", "PC B",
        "public-b", null, "10.250.0.20/32", "10.250.0.20/32", "vpn.ticketpro-ne.com",
        51820, "active", null
      ]
    );

    const report = await new SyncObservabilityService(database).inspect({
      accountId: "account-1",
      now,
      routerId: "router-1"
    });

    expect(report.status).toBe("error");
    expect(report.alerts.map((alert) => alert.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_VPN_ASSIGNMENT",
      "VPN_PEER_MISSING"
    ]));
  });
});

async function context(
  connectionMode: "local" | "vpn",
  options: { lastSeenAt?: string | null } = {}
): Promise<InMemoryDatabaseClient> {
  const database = new InMemoryDatabaseClient();
  await database.initialize();
  await new RouterRepository(database).create({
    account_id: "account-1",
    api_port: 8728,
    api_ssl_port: 8729,
    board_name: "CHR",
    connection_mode: connectionMode,
    created_by_profile_id: "account-1:profile-1",
    encrypted_password: "secret-ref://router-1",
    id: "router-1",
    label: "TicketPro Lab",
    last_seen_at: options.lastSeenAt === undefined ? now : options.lastSeenAt,
    local_ip: "192.168.88.1",
    model: "CHR",
    name: "TicketPro Lab",
    notes: "",
    routeros_version: "7.21.5",
    serial_number: "LAB-1",
    status: "active",
    username: "ticketpro-api",
    zone_id: null
  });
  await new RouterManagedResourceManifestRepository(database).save(
    "account-1",
    "router-1",
    manifest()
  );
  return database;
}

async function insertTicket(
  database: InMemoryDatabaseClient,
  id: string,
  username: string,
  status: string
): Promise<void> {
  await database.execute(
    `INSERT INTO tickets (
      id, account_id, router_id, username, status, last_router_sync_at, deleted_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    [id, "account-1", "router-1", username, status, now, null]
  );
}

function manifest(): RouterManagedResourceManifest {
  return {
    capturedAt: now,
    desired: {
      authorizedManagementCidrs: ["192.168.88.0/24", "10.250.0.0/16"],
      managementUsername: "ticketpro-api",
      managedHotspotProfileNames: ["6h"],
      wireguardInterfaceName: "ticketpro-vpn"
    },
    resources: [{
      attributes: { engineVersion: 5 },
      key: "system-script:voucher-lifecycle",
      kind: "voucher_script",
      matchCount: 1,
      ownership: "ticketpro",
      state: "present"
    }],
    routerOsVersion: "7.21.5",
    schemaVersion: 1,
    warnings: []
  };
}

function peer(id: string, resourceId: string, routerId: string | null) {
  return {
    account_id: "account-1",
    allowed_ips: "10.250.0.20/32",
    assigned_address: "10.250.0.20/32",
    endpoint_address: "vpn.ticketpro-ne.com",
    endpoint_port: 51820,
    id,
    last_handshake_at: null,
    name: "PC A",
    network_id: "network-1",
    peer_type: "operator" as const,
    private_key_encrypted: null,
    public_key: "public-a",
    resource_id: resourceId,
    router_id: routerId,
    status: "active" as const
  };
}
