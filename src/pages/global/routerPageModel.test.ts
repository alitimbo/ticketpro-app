import { afterEach, describe, expect, it } from "vitest";
import type { RouterConnectionRecord, RouterRecord } from "../../domain/database";
import {
  createRouterFromForm,
  demoRouters,
  emptyRouterFormValues,
  filterRouters,
  getRouterLimitMessage,
  isValidHotspotDnsName,
  listRoutersForAccount,
  normalizeHotspotDnsName,
  routerPageScopeKey,
  routerCardFromRecord,
  routerConnectionInputsFromCard,
  routerRecordFromCard,
  shouldPauseRouterStatusRefresh
} from "./routerPageModel";
import { countRoutersForSubscription, getSubscriptionOverview } from "./subscriptionPageModel";

describe("routerPageModel", () => {
  afterEach(() => {
    localStorage.removeItem("hotspot:account_subscription");
    localStorage.removeItem("hotspot:billing_invoices");
  });

  it("filtre les routeurs par nom, IP ou modèle", () => {
    expect(filterRouters(demoRouters, "192.168.88.1", "all")).toHaveLength(1);
    expect(filterRouters(demoRouters, "hAP", "all")).toHaveLength(2);
    expect(filterRouters(demoRouters, "nord", "all")[0]).toMatchObject({
      id: "point-nord"
    });
  });

  it("filtre les routeurs par statut", () => {
    expect(filterRouters(demoRouters, "", "active").map((router) => router.id)).toEqual([
      "routeur-demo"
    ]);
    expect(filterRouters(demoRouters, "", "offline").map((router) => router.id)).toEqual([
      "point-nord"
    ]);
  });

  it("liste uniquement les routeurs du compte principal connectÃ©", () => {
    const accountRouters = listRoutersForAccount(demoRouters, "account-douma-demo");
    const overview = getSubscriptionOverview(countRoutersForSubscription(accountRouters));

    expect(accountRouters.map((router) => router.id)).toEqual(["routeur-demo"]);
    expect(overview.routersUsed).toBe(1);
    expect(overview.subscription.routerLimitSnapshot).toBe(1);
    expect(overview.canAddRouter).toBe(false);
    expect(getRouterLimitMessage(overview.canAddRouter)).toBe("Limite de routeurs atteinte pour votre abonnement.");
  });

  it("rattache un nouveau routeur au compte et au profil interne", () => {
    const router = createRouterFromForm(
      {
        ...emptyRouterFormValues,
        hotspotAddress: " WIFI.ZONE-TEST.NE. ",
        ipAddress: "192.168.99.1",
        name: "Zone test",
        password: "secret"
      },
      "secret://router-test/password",
      null,
      "router-test",
      {
        accountId: "account-douma-demo",
        createdByProfileId: "account-douma-demo:internal-profile-operator",
        organizationId: "organization-test"
      }
    );

    expect(router).toMatchObject({
      accountId: "account-douma-demo",
      createdByProfileId: "account-douma-demo:internal-profile-operator",
      hotspotAddress: "wifi.zone-test.ne",
      id: "router-test",
      organizationId: "organization-test",
      subscriptionCounted: true
    });
  });

  it("normalise et valide le DNS Hotspot", () => {
    expect(normalizeHotspotDnsName(" WIFI.EXEMPLE.NE. ")).toBe("wifi.exemple.ne");
    expect(isValidHotspotDnsName("wifi.exemple.ne")).toBe(true);
    expect(isValidHotspotDnsName("https://wifi.exemple.ne/login")).toBe(false);
    expect(isValidHotspotDnsName("wifi invalide")).toBe(false);
  });

  it("reconstruit une carte depuis SQLite et ses connexions", () => {
    const record: RouterRecord = {
      account_id: "account-douma-demo",
      api_port: 8728,
      api_ssl_port: 8729,
      board_name: "RB5009",
      connection_mode: "vpn",
      created_at: "2026-07-13T10:00:00.000Z",
      created_by_profile_id: "account-douma-demo:internal-profile-admin",
      deleted_at: null,
      encrypted_password: "encrypted:router",
      id: "router-persisted",
      label: "Zone persistée",
      last_seen_at: "2026-07-13T10:00:00.000Z",
      hotspot_address: "wifi.ticketpro.local",
      local_ip: "192.168.10.1",
      model: "RB5009",
      name: "Zone persistée",
      notes: "Test SQLite",
      organization_id: "organization-test",
      routeros_version: "7.15",
      serial_number: "SERIAL-1",
      status: "active",
      subscription_counted: 1,
      sync_status: "synced",
      updated_at: "2026-07-13T10:00:00.000Z",
      username: "admin",
      zone_id: null
    };
    const connections: RouterConnectionRecord[] = [
      {
        created_at: "2026-07-13T10:00:00.000Z",
        deleted_at: null,
        id: "router-persisted:local",
        last_connected_at: null,
        last_error: null,
        mode: "local",
        port: 8728,
        router_id: "router-persisted",
        status: "inactive",
        sync_status: "local",
        updated_at: "2026-07-13T10:00:00.000Z",
        use_ssl: 0,
        host: "192.168.10.1"
      },
      {
        created_at: "2026-07-13T10:00:00.000Z",
        deleted_at: null,
        id: "router-persisted:vpn",
        last_connected_at: "2026-07-13T10:00:00.000Z",
        last_error: null,
        mode: "vpn",
        port: 8729,
        router_id: "router-persisted",
        status: "active",
        sync_status: "synced",
        updated_at: "2026-07-13T10:00:00.000Z",
        use_ssl: 1,
        host: "router.vpn.local"
      }
    ];

    const card = routerCardFromRecord(record, connections);

    expect(card).toMatchObject({
      hotspotAddress: "wifi.ticketpro.local",
      id: "router-persisted",
      notes: "Test SQLite",
      organizationId: "organization-test",
      preferredMode: "vpn",
      remoteHost: "router.vpn.local",
      remoteUseSsl: true,
      status: "active"
    });
    expect(routerConnectionInputsFromCard(card).map((connection) => connection.mode)).toEqual(["local", "vpn"]);
    expect(routerRecordFromCard(card).hotspot_address).toBe("wifi.ticketpro.local");

    const localCard = { ...card, preferredMode: "local" as const };
    expect(localCard.remoteMode).toBe("vpn");
    expect(routerConnectionInputsFromCard(localCard).map((connection) => connection.mode)).toEqual(["local", "vpn"]);
  });

  it("conserve le même périmètre pendant un simple rafraîchissement de session", () => {
    expect(routerPageScopeKey("account-1", "organization-1")).toBe(
      routerPageScopeKey("account-1", "organization-1")
    );
    expect(routerPageScopeKey("account-1", "organization-1")).not.toBe(
      routerPageScopeKey("account-1", "organization-2")
    );
  });

  it("suspend le rafraîchissement des statuts pendant un formulaire routeur", () => {
    expect(shouldPauseRouterStatusRefresh({
      connectionDialogOpen: false,
      deleteDialogOpen: false,
      formDialogOpen: true
    })).toBe(true);
    expect(shouldPauseRouterStatusRefresh({
      connectionDialogOpen: false,
      deleteDialogOpen: false,
      formDialogOpen: false
    })).toBe(false);
  });
});
