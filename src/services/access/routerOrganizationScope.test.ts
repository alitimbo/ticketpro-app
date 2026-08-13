import { describe, expect, it } from "vitest";
import type { RouterRecord } from "../../domain/database";
import { canAccessRouterInOrganization } from "./routerOrganizationScope";

describe("canAccessRouterInOrganization", () => {
  it("refuse un routeur local provenant d'une autre organisation", () => {
    expect(canAccessRouterInOrganization({
      accountId: "account-user",
      accessMode: "all",
      organizationId: "organization-b",
      router: router({ organization_id: "organization-a" }),
      selectedRouterIds: []
    })).toBe(false);
  });

  it("autorise uniquement les routeurs attribués au collaborateur", () => {
    const record = router({ cloud_router_id: "cloud-router-1" });
    expect(canAccessRouterInOrganization({
      accountId: "account-user",
      accessMode: "selected",
      organizationId: "organization-a",
      router: record,
      selectedRouterIds: ["cloud-router-1"]
    })).toBe(true);
    expect(canAccessRouterInOrganization({
      accountId: "account-user",
      accessMode: "selected",
      organizationId: "organization-a",
      router: record,
      selectedRouterIds: ["cloud-router-2"]
    })).toBe(false);
  });
});

function router(overrides: Partial<RouterRecord> = {}): RouterRecord {
  return {
    account_id: "account-user",
    api_port: 8728,
    api_ssl_port: 8729,
    board_name: null,
    cloud_router_id: "cloud-router-1",
    connection_mode: "vpn",
    created_at: "2026-08-13T00:00:00.000Z",
    created_by_profile_id: "account-user:admin",
    deleted_at: null,
    encrypted_password: "encrypted",
    hotspot_address: null,
    id: "local-router-1",
    label: "Routeur",
    last_seen_at: null,
    local_ip: "192.168.88.1",
    model: null,
    name: "Routeur",
    notes: null,
    organization_id: "organization-a",
    routeros_version: null,
    serial_number: null,
    status: "warning",
    subscription_counted: 1,
    sync_status: "synced",
    updated_at: "2026-08-13T00:00:00.000Z",
    username: "admin",
    zone_id: null,
    ...overrides
  };
}
