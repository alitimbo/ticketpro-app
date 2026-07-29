import { describe, expect, it } from "vitest";
import type {
  RouterConnectionRecord,
  RouterRecord
} from "../../domain/database";
import { routerAccessPolicyCloudId } from "./routerAccessPolicyIdentity";

describe("routerAccessPolicyCloudId", () => {
  it("utilise le numéro de série pour retrouver un routeur réel sur un autre PC", () => {
    expect(routerAccessPolicyCloudId(router({ serial_number: " ABC-123 " }), []))
      .toBe("serial:ABC-123");
  });

  it("utilise l'adresse WireGuard stable pour un CHR sans numéro de série", () => {
    expect(routerAccessPolicyCloudId(
      router({ serial_number: "non disponible" }),
      [connection({ host: "10.250.0.2", mode: "vpn" })]
    )).toBe("vpn:10.250.0.2");
  });

  it("retombe sur l'adresse Hotspot puis l'identifiant local", () => {
    expect(routerAccessPolicyCloudId(
      router({ hotspot_address: "WiFi.Exemple.NE", serial_number: null }),
      []
    )).toBe("hotspot:wifi.exemple.ne");
    expect(routerAccessPolicyCloudId(router(), [])).toBe("local:router-1");
  });
});

function router(overrides: Partial<RouterRecord> = {}): RouterRecord {
  return {
    account_id: "account-1",
    api_port: 8728,
    api_ssl_port: 8729,
    board_name: null,
    connection_mode: "local",
    created_at: "",
    created_by_profile_id: "account-1:internal-profile-admin",
    deleted_at: null,
    encrypted_password: "",
    hotspot_address: null,
    id: "router-1",
    label: "Routeur",
    last_seen_at: null,
    local_ip: "192.168.88.1",
    model: null,
    name: "Routeur",
    notes: null,
    routeros_version: null,
    serial_number: null,
    status: "active",
    subscription_counted: 1,
    sync_status: "synced",
    updated_at: "",
    username: "admin",
    zone_id: null,
    ...overrides
  };
}

function connection(
  overrides: Partial<RouterConnectionRecord> = {}
): RouterConnectionRecord {
  return {
    created_at: "",
    deleted_at: null,
    host: "192.168.88.1",
    id: "connection-1",
    last_connected_at: null,
    last_error: null,
    mode: "local",
    port: 8728,
    router_id: "router-1",
    status: "active",
    sync_status: "synced",
    updated_at: "",
    use_ssl: 0,
    ...overrides
  };
}
