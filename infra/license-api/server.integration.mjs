import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const port = 20_000 + Math.floor(Math.random() * 10_000);
const ipayPort = 30_000 + Math.floor(Math.random() * 10_000);
const hubPort = 40_000 + Math.floor(Math.random() * 10_000);
const baseUrl = `http://127.0.0.1:${port}`;
const masterToken = "ticketpro-integration-master-token";
const hubMasterToken = "ticketpro-integration-hub-master-token";
const databasePath = path.join(process.cwd(), `license-integration-${process.pid}.sqlite`);
const updateManifestPath = path.join(
  process.cwd(),
  `app-update-integration-${process.pid}.json`
);
let server;
let serverStderr = "";
let ipayServer;
let hubServer;
const ipayPayments = new Map();
const hubRequests = [];
const hubPeerAddresses = new Map();
let nextHubOperatorAddress = 3;

async function api(pathname, { method = "POST", token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const responseText = await response.text();
  const payload = responseText ? JSON.parse(responseText) : null;
  return { status: response.status, payload };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (server?.exitCode !== null) {
      throw new Error(`Le serveur de licences s'est arrêté au démarrage.\n${serverStderr}`.trim());
    }
    try {
      const result = await api("/health", { method: "GET" });
      if (result.status === 200) return;
    } catch {
      // Le serveur est encore en cours de démarrage.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Le serveur de licences ne démarre pas.");
}

before(async () => {
  ipayServer = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/sdk/v1/payments") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const reference = `IPAY-${body.transaction_id}`;
      ipayPayments.set(reference, { ...body, reference, status: "succeeded" });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        reference,
        public_reference: `PUBLIC-${body.transaction_id}`,
        meta_data: { code: "123456" }
      }));
      return;
    }
    if (request.method === "GET" && request.url.startsWith("/api/v1/payments/")) {
      const reference = decodeURIComponent(request.url.split("/").at(-1));
      const payment = ipayPayments.get(reference);
      if (!payment) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not found" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        public_reference: `PUBLIC-${payment.transaction_id}`,
        external_reference: payment.transaction_id,
        reference: payment.reference,
        status: payment.status,
        msisdn: payment.msisdn,
        amount: payment.amount
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => ipayServer.listen(ipayPort, "127.0.0.1", resolve));

  hubServer = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (request.headers.authorization !== `Bearer ${hubMasterToken}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    hubRequests.push({ body, url: request.url });
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/v1/tenants") {
      response.end(JSON.stringify({
        account_id: body.account_id,
        address_pool: "10.250.7.0/24",
        server_endpoint: "vpn.integration.test",
        server_port: 51820,
        server_public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
      }));
      return;
    }
    if (request.url === "/v1/peers/list") {
      response.end(JSON.stringify({
        account_id: body.account_id,
        peers: [{
          assigned_address: "10.250.7.3/32",
          connection_status: "connected",
          last_handshake_at: new Date().toISOString(),
          name: "PC récupéré",
          peer_type: "operator",
          public_key: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=",
          resource_id: "operator:pc-recupere",
          revoked_at: null,
          status: "active"
        }, {
          assigned_address: "10.250.7.2/32",
          connection_status: "disconnected",
          last_handshake_at: null,
          name: "Routeur masqué",
          peer_type: "router",
          public_key: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
          resource_id: "router-niger-1",
          revoked_at: null,
          status: "active"
        }]
      }));
      return;
    }
    const resourceId = String(body.resource_id ?? "");
    let assignedAddress = null;
    if (!["disable", "revoke"].includes(body.action)) {
      if (resourceId.startsWith("device:")) {
        const physicalDeviceKey = `operator:${body.public_key}`;
        if (!hubPeerAddresses.has(physicalDeviceKey)) {
          hubPeerAddresses.set(physicalDeviceKey, `10.250.7.${nextHubOperatorAddress}/32`);
          nextHubOperatorAddress += 1;
        }
        assignedAddress = hubPeerAddresses.get(physicalDeviceKey);
      } else {
        assignedAddress = "10.250.7.2/32";
      }
    }
    response.end(JSON.stringify({
      account_id: body.account_id,
      address_pool: "10.250.7.0/24",
      assigned_address: assignedAddress,
      public_key: body.public_key,
      status: body.action === "revoke" ? "revoked" : body.action === "disable" ? "disabled" : "active"
    }));
  });
  await new Promise((resolve) => hubServer.listen(hubPort, "127.0.0.1", resolve));

  server = spawn(process.execPath, ["infra/license-api/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LICENSE_BIND: "127.0.0.1",
      LICENSE_PORT: String(port),
      LICENSE_DB: databasePath,
      APP_UPDATE_MANIFEST_PATH: updateManifestPath,
      LICENSE_MASTER_TOKEN: masterToken,
      LICENSE_RATE_LIMIT_MAX: "500",
      LICENSE_HASH_SECRET: "integration-hash-secret-at-least-32-characters",
      ROUTER_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
      IPAY_BASE_URL: `http://127.0.0.1:${ipayPort}`,
      IPAY_ENV: "test",
      IPAY_PUBLIC_KEY: "ipay-public-test",
      IPAY_PRIVATE_KEY: "ipay-private-test",
      IPAY_SECRET_HASH: "ipay-webhook-secret-test",
      VPN_HUB_URL: `http://127.0.0.1:${hubPort}`,
      VPN_HUB_MASTER_TOKEN: hubMasterToken,
      SAAS_EXPOSE_RESET_TOKEN: "true"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  server.stderr.on("data", (chunk) => {
    serverStderr += chunk.toString("utf8");
  });
  await waitForServer();
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  await new Promise((resolve) => ipayServer?.close(resolve));
  await new Promise((resolve) => hubServer?.close(resolve));
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      fs.unlinkSync(`${databasePath}${suffix}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    fs.unlinkSync(updateManifestPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
});

test("l'Updater public retourne 204 sans version puis un manifeste signé par plateforme", async () => {
  const unavailable = await api(
    "/v1/app-updates/check?target=windows&arch=x86_64&current_version=0.1.9",
    { method: "GET" }
  );
  assert.equal(unavailable.status, 204);
  assert.equal(unavailable.payload, null);

  fs.writeFileSync(updateManifestPath, JSON.stringify({
    version: "0.2.0",
    notes: "Stabilisation des mises à jour.",
    pub_date: "2026-07-29T12:00:00.000Z",
    platforms: {
      "windows-x86_64": {
        url: "https://api.ticketpro-ne.com/releases/TicketPro-Setup-0.2.0-x64.exe",
        signature: "dGVzdC1zaWduYXR1cmUtbG9uZy1lbm91Z2gtZm9yLXVwZGF0ZXItdGVzdHM="
      }
    }
  }));

  const available = await api(
    "/v1/app-updates/check?target=windows&arch=x86_64&current_version=0.1.9",
    { method: "GET" }
  );
  assert.equal(available.status, 200);
  assert.equal(available.payload.version, "0.2.0");
  assert.equal(available.payload.notes, "Stabilisation des mises à jour.");
  assert.match(available.payload.url, /^https:\/\//);

  const alreadyCurrent = await api(
    "/v1/app-updates/check?target=windows&arch=x86_64&current_version=0.2.0",
    { method: "GET" }
  );
  assert.equal(alreadyCurrent.status, 204);
});

test("l'essai SaaS dure 7 jours, limite à un routeur et un forfait payant le remplace immédiatement", async () => {
  const trial = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Essai WiFi Niger",
      name: "Client Essai",
      email: "trial.saas@example.com",
      password: "EssaiSimple123",
      confirm_password: "EssaiSimple123"
    }
  });
  assert.equal(trial.status, 200);
  assert.equal(trial.payload.organization.status, "active");
  assert.equal(trial.payload.subscription.status, "trial");
  assert.equal(trial.payload.subscription.is_trial, true);
  assert.equal(trial.payload.subscription.grace_period_end, null);
  assert.equal(trial.payload.subscription.router_limit, 1);
  assert.equal(trial.payload.subscription.plan.code, "TRIAL-7D");
  assert.equal(trial.payload.access.can_manage_routers, true);
  const trialDurationDays = (
    Date.parse(trial.payload.subscription.current_period_end)
    - Date.parse(trial.payload.subscription.current_period_start)
  ) / 86_400_000;
  assert.ok(trialDurationDays > 6.99 && trialDurationDays <= 7.01);

  const services = await api("/v1/saas/services/access", {
    method: "GET",
    token: trial.payload.session.token
  });
  assert.equal(services.status, 200);
  assert.equal(services.payload.router_limit, 1);

  const plans = await api("/v1/plans", { method: "GET" });
  const paidPlan = plans.payload.plans[0];
  const purchase = await api("/v1/saas/subscriptions/purchase", {
    token: trial.payload.session.token,
    body: {
      plan_id: paidPlan.id,
      msisdn: "90909090",
      payment_type: "mobile"
    }
  });
  assert.equal(purchase.status, 200);
  const paid = await api("/v1/payments/orders/status", {
    body: {
      order_id: purchase.payload.order.order_id,
      order_token: purchase.payload.order_token
    }
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.payload.order.fulfillment_status, "fulfilled");

  const upgraded = await api("/v1/saas/auth/me", {
    method: "GET",
    token: trial.payload.session.token
  });
  assert.equal(upgraded.status, 200);
  assert.equal(upgraded.payload.subscription.plan.code, paidPlan.code);
  assert.equal(upgraded.payload.subscription.router_limit, paidPlan.router_limit);
  assert.ok(Date.parse(upgraded.payload.subscription.current_period_start) <= Date.now() + 5_000);

  const secondTrial = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Essai WiFi Niger",
      name: "Client Essai",
      email: "trial.saas@example.com",
      password: "EssaiSimple123",
      confirm_password: "EssaiSimple123"
    }
  });
  assert.equal(secondTrial.status, 409);

  const expiringTrial = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Essai Sans Grâce",
      name: "Client Sans Grâce",
      email: "trial.expired@example.com",
      password: "EssaiExpire123",
      confirm_password: "EssaiExpire123"
    }
  });
  assert.equal(expiringTrial.status, 200);
  const trialDb = new DatabaseSync(databasePath);
  trialDb.prepare(`
    UPDATE organization_subscriptions
    SET current_period_end = ?, updated_at = ?
    WHERE organization_id = ?
  `).run(
    new Date(Date.now() - 60_000).toISOString(),
    new Date().toISOString(),
    expiringTrial.payload.organization.id
  );
  trialDb.close();
  const expiredTrialServices = await api("/v1/saas/services/access", {
    method: "GET",
    token: expiringTrial.payload.session.token
  });
  assert.equal(expiredTrialServices.status, 402);
  assert.equal(expiredTrialServices.payload.details.subscription.is_trial, true);
});

test("les politiques réseau sont versionnées, isolées par organisation et protégées contre les conflits", async () => {
  const owner = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Politique Réseau A",
      name: "Propriétaire A",
      email: "policy.owner.a@example.com",
      password: "PolitiqueSimple123",
      confirm_password: "PolitiqueSimple123"
    }
  });
  assert.equal(owner.status, 200);
  const policy = {
    antiSharingMode: "strict",
    blockedDevices: [{
      id: "blocked-phone",
      ipAddress: "192.168.88.120",
      macAddress: "",
      name: "Téléphone bloqué"
    }],
    infrastructureDevices: [{
      id: "antenna-north",
      internetBypass: true,
      ipAddress: "192.168.88.10",
      macAddress: "aa-bb-cc-dd-ee-10",
      mode: "bridge",
      name: "Antenne nord",
      type: "antenna"
    }],
    lockVoucherToFirstMac: true,
    monitorIpv4Ttl: true,
    monitorIpv6HopLimit: false
  };
  const created = await api("/v1/saas/router-access-policy", {
    token: owner.payload.session.token,
    body: {
      base_revision: 0,
      policy,
      router_id: "router-shared-name"
    }
  });
  assert.equal(created.status, 200);
  assert.equal(created.payload.policy.revision, 1);
  assert.equal(
    created.payload.policy.policy.infrastructureDevices[0].macAddress,
    "AA:BB:CC:DD:EE:10"
  );

  const fetched = await api(
    "/v1/saas/router-access-policy?router_id=router-shared-name",
    { method: "GET", token: owner.payload.session.token }
  );
  assert.equal(fetched.status, 200);
  assert.equal(fetched.payload.policy.policy.lockVoucherToFirstMac, true);
  assert.equal(fetched.payload.policy.policy.blockedDevices[0].ipAddress, "192.168.88.120");

  const ttlDisabledPolicy = {
    ...policy,
    monitorIpv4Ttl: false
  };
  const updated = await api("/v1/saas/router-access-policy", {
    token: owner.payload.session.token,
    body: {
      base_revision: 1,
      policy: ttlDisabledPolicy,
      router_id: "router-shared-name"
    }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.policy.revision, 2);
  assert.equal(updated.payload.policy.policy.monitorIpv4Ttl, false);

  const history = await api(
    "/v1/saas/router-access-policy/history?router_id=router-shared-name",
    { method: "GET", token: owner.payload.session.token }
  );
  assert.equal(history.status, 200);
  assert.deepEqual(
    history.payload.history.map((entry) => ({
      revision: entry.revision,
      monitorIpv4Ttl: entry.policy.monitorIpv4Ttl
    })),
    [
      { revision: 2, monitorIpv4Ttl: false },
      { revision: 1, monitorIpv4Ttl: true }
    ]
  );

  const conflict = await api("/v1/saas/router-access-policy", {
    token: owner.payload.session.token,
    body: {
      base_revision: 0,
      policy,
      router_id: "router-shared-name"
    }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.payload.details.code, "ROUTER_ACCESS_POLICY_CONFLICT");
  assert.equal(conflict.payload.details.remote_policy.revision, 2);

  const invalidNatBypass = await api("/v1/saas/router-access-policy", {
    token: owner.payload.session.token,
    body: {
      base_revision: 2,
      policy: {
        ...policy,
        infrastructureDevices: [{
          ...policy.infrastructureDevices[0],
          mode: "router_nat"
        }]
      },
      router_id: "router-shared-name"
    }
  });
  assert.equal(invalidNatBypass.status, 400);

  const otherOrganization = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Politique Réseau B",
      name: "Propriétaire B",
      email: "policy.owner.b@example.com",
      password: "PolitiqueSimple123",
      confirm_password: "PolitiqueSimple123"
    }
  });
  const isolatedRead = await api(
    "/v1/saas/router-access-policy?router_id=router-shared-name",
    { method: "GET", token: otherOrganization.payload.session.token }
  );
  assert.equal(isolatedRead.status, 200);
  assert.equal(isolatedRead.payload.policy, null);
});

test("le coffre cloud restaure le parc, les plans et le VPN sans exposer les secrets dans SQLite", async () => {
  const owner = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Reprise Parc A",
      name: "Propriétaire Reprise",
      email: "recovery.owner@example.com",
      password: "RepriseSimple123",
      confirm_password: "RepriseSimple123"
    }
  });
  assert.equal(owner.status, 200);
  const routerSnapshot = {
    id: "router-original",
    stable_identity: "serial:CHR-RECOVERY-001",
    name: "Site central",
    label: "Site central",
    model: "CCR2004",
    board_name: "CCR2004-1G-12S+2XS",
    serial_number: "CHR-RECOVERY-001",
    routeros_version: "7.20",
    local_ip: "192.168.88.1",
    hotspot_address: "wifi.central.test",
    notes: "Routeur principal",
    api_port: 8728,
    api_ssl_port: 8729,
    username: "ticketpro",
    credential: "SecretRouterOS-123",
    connection_mode: "vpn",
    status: "active",
    last_seen_at: "2026-07-29T12:00:00.000Z",
    connections: [
      { mode: "local", host: "192.168.88.1", port: 8728, use_ssl: false, status: "inactive" },
      { mode: "vpn", host: "10.250.7.2", port: 8728, use_ssl: false, status: "active" }
    ],
    plans: [{
      id: "plan-6h",
      name: "6 heures",
      duration_minutes: 360,
      validity_minutes: 1440,
      data_limit_mb: null,
      download_limit: "5M",
      upload_limit: "2M",
      shared_users: 1,
      price_hint: 500,
      mikrotik_profile_name: "6h",
      status: "active"
    }],
    vpn: {
      assigned_address: "10.250.7.2/32",
      public_key: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
      status: "active"
    }
  };
  const saved = await api("/v1/saas/routers/snapshot", {
    token: owner.payload.session.token,
    body: { router: routerSnapshot }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.router.id, "router-original");
  assert.equal(saved.payload.router.credential, "SecretRouterOS-123");

  const recovered = await api("/v1/saas/routers/recovery", {
    method: "GET",
    token: owner.payload.session.token
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.payload.routers.length, 1);
  assert.equal(recovered.payload.routers[0].plans[0].mikrotik_profile_name, "6h");
  assert.equal(recovered.payload.routers[0].vpn.assigned_address, "10.250.7.2/32");
  assert.equal(recovered.payload.routers[0].credential, "SecretRouterOS-123");

  const database = new DatabaseSync(databasePath);
  const stored = database.prepare(
    "SELECT credential_ciphertext FROM organization_routers WHERE id = ?"
  ).get("router-original");
  database.close();
  assert.ok(stored.credential_ciphertext.startsWith("v1."));
  assert.equal(stored.credential_ciphertext.includes("SecretRouterOS-123"), false);

  const deduplicated = await api("/v1/saas/routers/snapshot", {
    token: owner.payload.session.token,
    body: {
      router: {
        ...routerSnapshot,
        id: "router-after-reinstall",
        name: "Site central restauré"
      }
    }
  });
  assert.equal(deduplicated.status, 200);
  assert.equal(deduplicated.payload.router.id, "router-original");
  assert.equal(deduplicated.payload.router.name, "Site central restauré");

  const removed = await api("/v1/saas/routers/remove", {
    token: owner.payload.session.token,
    body: { router_id: "router-original" }
  });
  assert.equal(removed.status, 200);
  const emptyRecovery = await api("/v1/saas/routers/recovery", {
    method: "GET",
    token: owner.payload.session.token
  });
  assert.equal(emptyRecovery.payload.routers.length, 0);

  const reactivated = await api("/v1/saas/routers/snapshot", {
    token: owner.payload.session.token,
    body: {
      router: {
        ...routerSnapshot,
        id: "router-after-second-install",
        credential: "SecretRouterOS-456"
      }
    }
  });
  assert.equal(reactivated.status, 200);
  assert.equal(reactivated.payload.router.id, "router-original");
  assert.equal(reactivated.payload.router.credential, "SecretRouterOS-456");
});

test("une inscription abandonnée sans essai ni paiement ne peut pas ouvrir de session", async () => {
  const plans = await api("/v1/plans", { method: "GET" });
  const registration = await api("/v1/saas/register-and-pay", {
    body: {
      organization_name: "Paiement Abandonné",
      name: "Client Pending",
      email: "pending.saas@example.com",
      password: "PendingSimple123",
      confirm_password: "PendingSimple123",
      plan_id: plans.payload.plans[0].id,
      msisdn: "91919191",
      payment_type: "mobile"
    }
  });
  assert.equal(registration.status, 200);

  const login = await api("/v1/saas/auth/login", {
    body: {
      email: "pending.saas@example.com",
      password: "PendingSimple123"
    }
  });
  assert.equal(login.status, 403);

  const recoveredWithTrial = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Paiement Abandonné",
      name: "Client Pending",
      email: "pending.saas@example.com",
      password: "PendingSimple123",
      confirm_password: "PendingSimple123"
    }
  });
  assert.equal(recoveredWithTrial.status, 200);
  assert.equal(recoveredWithTrial.payload.subscription.plan.code, "TRIAL-7D");
});

test("un collaborateur invité accède au VPN sans consommer le quota de postes du propriétaire", async () => {
  const owner = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Organisation collaborateur VPN",
      name: "Propriétaire limité",
      email: "owner.collaborateur@example.com",
      password: "OwnerCollaborateur123",
      confirm_password: "OwnerCollaborateur123"
    }
  });
  assert.equal(owner.status, 200);
  const ownerToken = owner.payload.session.token;

  const ownerDevice = await api("/v1/saas/devices/register", {
    token: ownerToken,
    body: {
      installation_id: "723e4567-e89b-42d3-a456-426614174001",
      public_key: "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO=",
      name: "PC propriétaire",
      platform: "windows",
      app_version: "0.2.7"
    }
  });
  assert.equal(ownerDevice.status, 200, JSON.stringify(ownerDevice.payload));
  assert.equal(ownerDevice.payload.max_devices, 1);
  assert.equal(ownerDevice.payload.device_access_scope, "owner");

  const invitation = await api("/v1/saas/team/members", {
    token: ownerToken,
    body: {
      name: "Technicien invité",
      email: "technicien.collaborateur@example.com",
      app_role: "operator",
      router_access_mode: "selected",
      router_ids: ["router-collaborateur"]
    }
  });
  assert.equal(invitation.status, 200);

  const accepted = await api("/v1/saas/invitations/accept", {
    body: {
      invitation_token: invitation.payload.invitation_token,
      new_password: "TechnicienCollaborateur123",
      confirm_password: "TechnicienCollaborateur123"
    }
  });
  assert.equal(accepted.status, 200);

  const collaborator = await api("/v1/saas/auth/login", {
    body: {
      email: "technicien.collaborateur@example.com",
      password: "TechnicienCollaborateur123"
    }
  });
  assert.equal(collaborator.status, 200);
  const collaboratorDevice = await api("/v1/saas/devices/register", {
    token: collaborator.payload.session.token,
    body: {
      installation_id: ownerDevice.payload.device.installation_id,
      public_key: "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO=",
      name: "PC technicien",
      platform: "windows",
      app_version: "0.2.7"
    }
  });
  assert.equal(collaboratorDevice.status, 200, JSON.stringify(collaboratorDevice.payload));
  assert.equal(collaboratorDevice.payload.device.id, ownerDevice.payload.device.id);
  assert.equal(collaboratorDevice.payload.device_access_scope, "collaborator");
  assert.equal(collaboratorDevice.payload.device_limit_mode, "unlimited");
  assert.equal(collaboratorDevice.payload.max_devices, null);

  const ownerInventory = await api("/v1/saas/devices", {
    method: "GET",
    token: ownerToken
  });
  assert.equal(ownerInventory.status, 200);
  assert.equal(ownerInventory.payload.devices.length, 1);
  assert.equal(ownerInventory.payload.active_count, 0);
  assert.equal(ownerInventory.payload.collaborator_device_count, 1);

  const secondOwnerDevice = await api("/v1/saas/devices/register", {
    token: ownerToken,
    body: {
      installation_id: "923e4567-e89b-42d3-a456-426614174003",
      public_key: "QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ=",
      name: "Deuxième PC propriétaire",
      platform: "windows",
      app_version: "0.2.7"
    }
  });
  assert.equal(secondOwnerDevice.status, 200, JSON.stringify(secondOwnerDevice.payload));
  assert.equal(secondOwnerDevice.payload.device_access_scope, "owner");

  const thirdOwnerDevice = await api("/v1/saas/devices/register", {
    token: ownerToken,
    body: {
      installation_id: "a23e4567-e89b-42d3-a456-426614174004",
      public_key: "RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR=",
      name: "Troisième PC propriétaire",
      platform: "windows",
      app_version: "0.2.7"
    }
  });
  assert.equal(thirdOwnerDevice.status, 409);
  assert.equal(thirdOwnerDevice.payload.details.code, "DEVICE_LIMIT_REACHED");

  const disabled = await api("/v1/saas/team/members/update", {
    token: ownerToken,
    body: {
      user_id: invitation.payload.member.id,
      app_role: "operator",
      status: "disabled",
      router_access_mode: "selected",
      router_ids: ["router-collaborateur"]
    }
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.payload.vpn_access_revoked, true);
  assert.equal(disabled.payload.affected_device_count, 1);
  assert.ok(hubRequests.some((entry) =>
    entry.url === "/v1/peers"
    && entry.body.action === "disable"
    && entry.body.resource_id === `device:${collaboratorDevice.payload.device.id}`
  ));
});

test("le parcours SaaS simple crée le compte, active l'abonnement et ouvre une session", async () => {
  const plans = await api("/v1/plans", { method: "GET" });
  assert.equal(plans.status, 200);
  assert.ok(plans.payload.plans.length >= 1);
  assert.equal(plans.payload.plans.some((plan) => plan.is_reseller), false);
  const plan = plans.payload.plans[0];

  const registration = await api("/v1/saas/register-and-pay", {
    body: {
      organization_name: "WiFi Sahel",
      name: "Amina Test",
      email: "amina.saas@example.com",
      password: "SaaSsimple123",
      confirm_password: "SaaSsimple123",
      plan_id: plan.id,
      msisdn: "90909090",
      payment_type: "mobile"
    }
  });
  assert.equal(registration.status, 200);
  assert.equal(registration.payload.registration.next_step, "confirm_payment");

  const paid = await api("/v1/payments/orders/status", {
    body: {
      order_id: registration.payload.order.order_id,
      order_token: registration.payload.order_token
    }
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.payload.order.fulfillment_status, "fulfilled");
  assert.equal("license_key" in paid.payload.order, false);

  const completion = await api("/v1/saas/registration/complete", {
    body: {
      order_id: registration.payload.order.order_id,
      order_token: registration.payload.order_token
    }
  });
  assert.equal(completion.status, 200);
  assert.equal(completion.payload.organization.name, "WiFi Sahel");
  assert.equal(completion.payload.subscription.status, "active");
  assert.equal(completion.payload.subscription.router_limit, plan.router_limit);
  assert.equal(completion.payload.access.can_manage_routers, true);
  const sessionToken = completion.payload.session.token;

  const invitation = await api("/v1/saas/team/members", {
    token: sessionToken,
    body: {
      name: "Moussa Opérateur",
      email: "moussa.operator@example.com",
      app_role: "operator",
      router_access_mode: "selected",
      router_ids: ["router-niger-1"]
    }
  });
  assert.equal(invitation.status, 200);
  assert.equal(invitation.payload.member.app_role, "operator");
  assert.deepEqual(invitation.payload.member.router_access.router_ids, ["router-niger-1"]);
  assert.equal(invitation.payload.member.invitation_pending, true);
  assert.ok(invitation.payload.invitation_token);

  const resentInvitation = await api("/v1/saas/team/members/resend-invitation", {
    token: sessionToken,
    body: { user_id: invitation.payload.member.id }
  });
  assert.equal(resentInvitation.status, 200);
  assert.equal(resentInvitation.payload.invitation_delivery, "not_sent");
  assert.ok(resentInvitation.payload.invitation_token);
  assert.notEqual(
    resentInvitation.payload.invitation_token,
    invitation.payload.invitation_token
  );

  const obsoleteInvitationInspection = await api("/v1/saas/invitations/inspect", {
    body: { invitation_token: invitation.payload.invitation_token }
  });
  assert.equal(obsoleteInvitationInspection.status, 400);

  const invitationInspection = await api("/v1/saas/invitations/inspect", {
    body: { invitation_token: resentInvitation.payload.invitation_token }
  });
  assert.equal(invitationInspection.status, 200);
  assert.equal(invitationInspection.payload.requires_password, true);

  const employeePassword = await api("/v1/saas/invitations/accept", {
    body: {
      invitation_token: resentInvitation.payload.invitation_token,
      new_password: "EmployeSimple123",
      confirm_password: "EmployeSimple123"
    }
  });
  assert.equal(employeePassword.status, 200);

  const employeeLogin = await api("/v1/saas/auth/login", {
    body: {
      email: "moussa.operator@example.com",
      password: "EmployeSimple123"
    }
  });
  assert.equal(employeeLogin.status, 200);
  assert.equal(employeeLogin.payload.user.app_role, "operator");
  assert.equal(employeeLogin.payload.user.permissions.includes("global.subscription"), false);
  assert.deepEqual(employeeLogin.payload.user.router_access.router_ids, ["router-niger-1"]);

  const employeeTeamAccess = await api("/v1/saas/team", {
    method: "GET",
    token: employeeLogin.payload.session.token
  });
  assert.equal(employeeTeamAccess.status, 403);

  const employeeVpnAccess = await api("/v1/saas/vpn/bootstrap", {
    token: employeeLogin.payload.session.token,
    body: {}
  });
  assert.equal(employeeVpnAccess.status, 200);
  assert.equal(employeeVpnAccess.payload.server_endpoint, "vpn.integration.test");

  const operatorDesktop = await api("/v1/saas/devices/register", {
    headers: { "x-forwarded-for": "10.10.0.10" },
    token: employeeLogin.payload.session.token,
    body: {
      installation_id: "423e4567-e89b-42d3-a456-426614174333",
      public_key: "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK=",
      name: "PC operateur distant",
      platform: "windows",
      os_version: "Windows 11",
      app_version: "0.2.4"
    }
  });
  assert.equal(operatorDesktop.status, 200, JSON.stringify(operatorDesktop.payload));
  assert.match(operatorDesktop.payload.vpn.address, /^10\.250\.7\.\d+\/32$/);

  const operatorHeartbeat = await api("/v1/saas/devices/heartbeat", {
    token: employeeLogin.payload.session.token,
    body: {
      installation_id: "423e4567-e89b-42d3-a456-426614174333",
      app_version: "0.2.4"
    }
  });
  assert.equal(operatorHeartbeat.status, 200);
  assert.equal(operatorHeartbeat.payload.vpn_access, true);

  const operatorDeviceAdministration = await api("/v1/saas/devices", {
    method: "GET",
    token: employeeLogin.payload.session.token
  });
  assert.equal(operatorDeviceAdministration.status, 403);

  const removedOperatorDesktop = await api("/v1/saas/devices/revoke", {
    headers: { "x-forwarded-for": "10.10.0.11" },
    token: sessionToken,
    body: { device_id: operatorDesktop.payload.device.id }
  });
  assert.equal(removedOperatorDesktop.status, 200);

  const updatedEmployeeAccess = await api("/v1/saas/team/members/update", {
    token: sessionToken,
    body: {
      user_id: invitation.payload.member.id,
      app_role: "guest",
      status: "active",
      router_access_mode: "selected",
      router_ids: ["router-niger-2"]
    }
  });
  assert.equal(updatedEmployeeAccess.status, 200);
  assert.equal(updatedEmployeeAccess.payload.member.app_role, "guest");
  assert.deepEqual(
    updatedEmployeeAccess.payload.member.router_access.router_ids,
    ["router-niger-2"]
  );
  assert.equal(updatedEmployeeAccess.payload.sessions_revoked, true);

  const revokedEmployeeSession = await api("/v1/saas/auth/me", {
    method: "GET",
    token: employeeLogin.payload.session.token
  });
  assert.equal(revokedEmployeeSession.status, 401);

  const employeeRelogin = await api("/v1/saas/auth/login", {
    body: {
      email: "moussa.operator@example.com",
      password: "EmployeSimple123"
    }
  });
  assert.equal(employeeRelogin.status, 200);
  assert.equal(employeeRelogin.payload.user.app_role, "guest");

  const suspendedEmployee = await api("/v1/saas/team/members/update", {
    token: sessionToken,
    body: {
      user_id: invitation.payload.member.id,
      app_role: "guest",
      status: "disabled",
      router_access_mode: "selected",
      router_ids: ["router-niger-2"]
    }
  });
  assert.equal(suspendedEmployee.status, 200);
  assert.equal(suspendedEmployee.payload.member.status, "disabled");

  const suspendedSession = await api("/v1/saas/auth/me", {
    method: "GET",
    token: employeeRelogin.payload.session.token
  });
  assert.equal(suspendedSession.status, 401);

  const disabledEmployeeLogin = await api("/v1/saas/auth/login", {
    body: {
      email: "moussa.operator@example.com",
      password: "EmployeSimple123"
    }
  });
  assert.equal(disabledEmployeeLogin.status, 403);

  const reactivatedEmployee = await api("/v1/saas/team/members/update", {
    token: sessionToken,
    body: {
      user_id: invitation.payload.member.id,
      app_role: "operator",
      status: "active",
      router_access_mode: "selected",
      router_ids: ["router-niger-1"]
    }
  });
  assert.equal(reactivatedEmployee.status, 200);
  assert.equal(reactivatedEmployee.payload.member.status, "active");

  const activeOperatorLogin = await api("/v1/saas/auth/login", {
    headers: { "x-forwarded-for": "10.10.0.12" },
    body: {
      email: "moussa.operator@example.com",
      password: "EmployeSimple123"
    }
  });
  assert.equal(activeOperatorLogin.status, 200);
  assert.equal(activeOperatorLogin.payload.user.app_role, "operator");

  const disposableInvitation = await api("/v1/saas/team/members", {
    token: sessionToken,
    body: {
      name: "Invitation Supprimée",
      email: "invitation.removed@example.com",
      app_role: "agent",
      router_access_mode: "selected",
      router_ids: ["router-niger-1"]
    }
  });
  assert.equal(disposableInvitation.status, 200);
  const removedPendingMember = await api("/v1/saas/team/members/remove", {
    token: sessionToken,
    body: { user_id: disposableInvitation.payload.member.id }
  });
  assert.equal(removedPendingMember.status, 200);
  const removedInvitationInspection = await api("/v1/saas/invitations/inspect", {
    body: { invitation_token: disposableInvitation.payload.invitation_token }
  });
  assert.equal(removedInvitationInspection.status, 400);

  const reinvitedIdentityWithoutPassword = await api("/v1/saas/team/members", {
    token: sessionToken,
    body: {
      name: "Invitation Supprimée",
      email: "invitation.removed@example.com",
      app_role: "agent",
      router_access_mode: "selected",
      router_ids: ["router-niger-1"]
    }
  });
  assert.equal(reinvitedIdentityWithoutPassword.status, 200);
  const reinvitedIdentityInspection = await api("/v1/saas/invitations/inspect", {
    body: { invitation_token: reinvitedIdentityWithoutPassword.payload.invitation_token }
  });
  assert.equal(reinvitedIdentityInspection.status, 200);
  assert.equal(reinvitedIdentityInspection.payload.requires_password, true);

  const secondOrganization = await api("/v1/saas/register-trial", {
    body: {
      organization_name: "Deuxième Organisation",
      name: "Deuxième Propriétaire",
      email: "second.owner@example.com",
      password: "SecondOwner123",
      confirm_password: "SecondOwner123"
    }
  });
  assert.equal(secondOrganization.status, 200);

  const existingIdentityInvitation = await api("/v1/saas/team/members", {
    token: secondOrganization.payload.session.token,
    body: {
      name: "Moussa Opérateur",
      email: "moussa.operator@example.com",
      app_role: "agent",
      router_access_mode: "selected",
      router_ids: ["router-niger-2"]
    }
  });
  assert.equal(existingIdentityInvitation.status, 200);
  assert.ok(existingIdentityInvitation.payload.invitation_token);

  const existingInspection = await api("/v1/saas/invitations/inspect", {
    body: { invitation_token: existingIdentityInvitation.payload.invitation_token }
  });
  assert.equal(existingInspection.status, 200);
  assert.equal(existingInspection.payload.requires_password, false);

  const acceptedSecondOrganization = await api("/v1/saas/invitations/accept", {
    body: { invitation_token: existingIdentityInvitation.payload.invitation_token }
  });
  assert.equal(acceptedSecondOrganization.status, 200);

  const multiOrganizationLogin = await api("/v1/saas/auth/login", {
    body: {
      email: "moussa.operator@example.com",
      password: "EmployeSimple123"
    }
  });
  assert.equal(multiOrganizationLogin.status, 200);
  assert.equal(multiOrganizationLogin.payload.requires_organization_selection, true);
  assert.equal(multiOrganizationLogin.payload.organizations.length, 2);
  const secondMembership = multiOrganizationLogin.payload.organizations.find(
    (organization) => organization.organization_name === "Deuxième Organisation"
  );
  assert.ok(secondMembership);

  const switchedOrganization = await api("/v1/saas/auth/switch-organization", {
    token: multiOrganizationLogin.payload.session.token,
    body: { membership_id: secondMembership.membership_id }
  });
  assert.equal(switchedOrganization.status, 200);
  assert.equal(switchedOrganization.payload.organization.name, "Deuxième Organisation");
  assert.equal(switchedOrganization.payload.user.app_role, "agent");
  assert.deepEqual(switchedOrganization.payload.user.router_access.router_ids, ["router-niger-2"]);
  assert.equal(switchedOrganization.payload.requires_organization_selection, false);

  const sharedInstallationId = "623e4567-e89b-42d3-a456-426614174555";
  const sharedPublicKey = "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS=";
  const firstOrganizationDevice = await api("/v1/saas/devices/register", {
    token: activeOperatorLogin.payload.session.token,
    body: {
      installation_id: sharedInstallationId,
      public_key: sharedPublicKey,
      name: "PC multi-organisation",
      platform: "windows",
      app_version: "0.2.7"
    }
  });
  assert.equal(firstOrganizationDevice.status, 200, JSON.stringify(firstOrganizationDevice.payload));

  const secondOrganizationDevice = await api("/v1/saas/devices/register", {
    token: switchedOrganization.payload.session.token,
    body: {
      installation_id: sharedInstallationId,
      public_key: sharedPublicKey,
      name: "PC multi-organisation",
      platform: "windows",
      app_version: "0.2.7"
    }
  });
  assert.equal(secondOrganizationDevice.status, 200, JSON.stringify(secondOrganizationDevice.payload));
  assert.equal(secondOrganizationDevice.payload.vpn.address, firstOrganizationDevice.payload.vpn.address);
  assert.notEqual(secondOrganizationDevice.payload.device.id, firstOrganizationDevice.payload.device.id);

  const firstMembership = multiOrganizationLogin.payload.organizations.find(
    (organization) => organization.organization_name !== "DeuxiÃ¨me Organisation"
  );
  assert.ok(firstMembership);
  const firstMembershipById = multiOrganizationLogin.payload.organizations.find(
    (organization) => organization.organization_id !== secondMembership.organization_id
  );
  assert.ok(firstMembershipById);
  const switchedBack = await api("/v1/saas/auth/switch-organization", {
    token: switchedOrganization.payload.session.token,
    body: { membership_id: firstMembershipById.membership_id }
  });
  assert.equal(switchedBack.status, 200);
  const firstOrganizationDeviceAgain = await api("/v1/saas/devices/register", {
    token: switchedBack.payload.session.token,
    body: {
      installation_id: sharedInstallationId,
      public_key: sharedPublicKey,
      name: "PC multi-organisation",
      platform: "windows",
      app_version: "0.2.7"
    }
  });
  assert.equal(firstOrganizationDeviceAgain.status, 200);
  assert.equal(firstOrganizationDeviceAgain.payload.device.id, firstOrganizationDevice.payload.device.id);

  const me = await api("/v1/saas/auth/me", {
    method: "GET",
    token: sessionToken
  });
  assert.equal(me.status, 200);
  assert.equal(me.payload.user.email, "amina.saas@example.com");

  const localNigerProfile = await api("/v1/saas/account/profile", {
    token: sessionToken,
    body: { name: "Amina Profil", phone: "88 99 99 00" }
  });
  assert.equal(localNigerProfile.status, 200, JSON.stringify(localNigerProfile.payload));
  assert.equal(localNigerProfile.payload.user.phone, "+22788999900");

  const internationalProfile = await api("/v1/saas/account/profile", {
    token: sessionToken,
    body: { name: "Amina Profil", phone: "+33 6 12 34 56 78" }
  });
  assert.equal(internationalProfile.status, 200, JSON.stringify(internationalProfile.payload));
  assert.equal(internationalProfile.payload.user.phone, "+33612345678");

  const invalidInternationalProfile = await api("/v1/saas/account/profile", {
    token: sessionToken,
    body: { name: "Amina Profil", phone: "33612345678" }
  });
  assert.equal(invalidInternationalProfile.status, 400);

  const updatedMe = await api("/v1/saas/auth/me", {
    method: "GET",
    token: sessionToken
  });
  assert.equal(updatedMe.payload.user.name, "Amina Profil");
  assert.equal(updatedMe.payload.user.phone, "+33612345678");

  const services = await api("/v1/saas/services/access", {
    method: "GET",
    token: sessionToken
  });
  assert.equal(services.status, 200);
  assert.equal(services.payload.allowed, true);

  const saasVpn = await api("/v1/saas/vpn/bootstrap", {
    token: sessionToken,
    body: {}
  });
  assert.equal(saasVpn.status, 200);
  assert.equal(saasVpn.payload.server_endpoint, "vpn.integration.test");
  assert.equal(hubRequests.at(-1).body.account_id, completion.payload.organization.id);
  assert.equal(hubRequests.at(-1).body.router_limit, plan.router_limit);

  const desktopInstallationId = "123e4567-e89b-42d3-a456-426614174000";
  const desktopPublicKey = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE=";
  const registeredDesktop = await api("/v1/saas/devices/register", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      public_key: desktopPublicKey,
      name: "HP EliteBook Integration",
      platform: "windows",
      os_version: "Windows 11",
      app_version: "0.2.3"
    }
  });
  assert.equal(registeredDesktop.status, 200);
  assert.match(registeredDesktop.payload.vpn.address, /^10\.250\.7\.\d+\/32$/);
  assert.equal(registeredDesktop.payload.vpn.endpoint, "vpn.integration.test");
  assert.deepEqual(registeredDesktop.payload.vpn.allowed_ips, ["10.250.7.0/24"]);
  assert.equal(hubRequests.at(-1).body.peer_type, "operator");
  assert.match(hubRequests.at(-1).body.resource_id, /^device:/);
  assert.ok(hubRequests.some((entry) =>
    entry.url === "/v1/peers"
    && entry.body.action === "revoke"
    && entry.body.resource_id === "operator:pc-recupere"
  ));

  const forbiddenOperatorReplacement = await api("/v1/saas/devices/register", {
    headers: { "x-forwarded-for": "10.10.0.13" },
    token: activeOperatorLogin.payload.session.token,
    body: {
      installation_id: "523e4567-e89b-42d3-a456-426614174444",
      public_key: "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ=",
      replacement_device_id: registeredDesktop.payload.device.id,
      name: "Tentative remplacement admin",
      platform: "windows",
      app_version: "0.2.4"
    }
  });
  assert.equal(forbiddenOperatorReplacement.status, 403);
  assert.equal(
    forbiddenOperatorReplacement.payload.details.code,
    "DEVICE_REPLACEMENT_FORBIDDEN"
  );

  const registeredDesktopAgain = await api("/v1/saas/devices/register", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      public_key: desktopPublicKey,
      name: "HP EliteBook Integration",
      platform: "windows",
      os_version: "Windows 11",
      app_version: "0.2.3"
    }
  });
  assert.equal(registeredDesktopAgain.status, 200);
  assert.equal(registeredDesktopAgain.payload.device.id, registeredDesktop.payload.device.id);

  const deviceLimitReached = await api("/v1/saas/devices/register", {
    token: sessionToken,
    body: {
      installation_id: "223e4567-e89b-42d3-a456-426614174111",
      public_key: "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG=",
      name: "Deuxième PC refusé",
      platform: "windows",
      app_version: "0.2.4"
    }
  });
  assert.equal(deviceLimitReached.status, 200);
  assert.equal(deviceLimitReached.payload.active_device_count, 2);
  assert.equal(deviceLimitReached.payload.max_devices, 2);

  const thirdDeviceLimitReached = await api("/v1/saas/devices/register", {
    token: sessionToken,
    body: {
      installation_id: "323e4567-e89b-42d3-a456-426614174222",
      public_key: "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK=",
      name: "Troisième PC refusé",
      platform: "windows",
      app_version: "0.2.4"
    }
  });
  assert.equal(thirdDeviceLimitReached.status, 409);
  assert.equal(thirdDeviceLimitReached.payload.details.code, "DEVICE_LIMIT_REACHED");
  assert.equal(thirdDeviceLimitReached.payload.details.max_devices, 2);

  const revokedSecondDesktop = await api("/v1/saas/devices/revoke", {
    token: sessionToken,
    body: { device_id: deviceLimitReached.payload.device.id }
  });
  assert.equal(revokedSecondDesktop.status, 200);

  const changedDesktopKey = await api("/v1/saas/devices/register", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      public_key: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF=",
      name: "HP EliteBook Integration",
      platform: "windows",
      app_version: "0.2.3"
    }
  });
  assert.equal(changedDesktopKey.status, 409);
  assert.equal(changedDesktopKey.payload.details.code, "DEVICE_KEY_ROTATION_REQUIRED");

  const rotatedDesktopKey = await api("/v1/saas/devices/rotate-key", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      previous_public_key: desktopPublicKey,
      public_key: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF="
    }
  });
  assert.equal(rotatedDesktopKey.status, 200);
  assert.equal(rotatedDesktopKey.payload.device.vpn.key_version, 2);
  assert.equal(rotatedDesktopKey.payload.device.vpn.config_version, 2);
  assert.equal(hubRequests.at(-1).body.action, "rotate");

  const retriedDesktopRotation = await api("/v1/saas/devices/rotate-key", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      previous_public_key: desktopPublicKey,
      public_key: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF="
    }
  });
  assert.equal(retriedDesktopRotation.status, 200);
  assert.equal(retriedDesktopRotation.payload.device.vpn.key_version, 2);

  const deviceHeartbeat = await api("/v1/saas/devices/heartbeat", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      app_version: "0.2.3"
    }
  });
  assert.equal(deviceHeartbeat.status, 200);

  const devicesBeforeRevocation = await api("/v1/saas/devices", {
    method: "GET",
    token: sessionToken
  });
  assert.equal(devicesBeforeRevocation.status, 200);
  assert.equal(devicesBeforeRevocation.payload.devices.length, 4);
  assert.equal(devicesBeforeRevocation.payload.active_count, 1);
  assert.equal(devicesBeforeRevocation.payload.max_devices, 2);
  const activeOwnerDevice = devicesBeforeRevocation.payload.devices.find(
    (device) => device.id === registeredDesktop.payload.device.id
  );
  const revokedOperatorDevice = devicesBeforeRevocation.payload.devices.find(
    (device) => device.id === operatorDesktop.payload.device.id
  );
  assert.equal(activeOwnerDevice.vpn.key_version, 2);
  assert.equal(activeOwnerDevice.vpn.applied_state, "enabled");
  assert.equal("public_key" in activeOwnerDevice.vpn, false);
  assert.equal(revokedOperatorDevice.status, "revoked");

  const replacementDesktop = await api("/v1/saas/devices/register", {
    token: sessionToken,
    body: {
      installation_id: "623e4567-e89b-42d3-a456-426614174333",
      public_key: "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM=",
      replacement_device_id: registeredDesktop.payload.device.id,
      name: "PC de remplacement",
      platform: "windows",
      os_version: "Windows 11",
      app_version: "0.2.4"
    }
  });
  assert.equal(replacementDesktop.status, 200, JSON.stringify(replacementDesktop.payload));
  assert.equal(replacementDesktop.payload.active_device_count, 2);
  assert.equal(replacementDesktop.payload.max_devices, 2);

  const revokedDesktop = await api("/v1/saas/devices/revoke", {
    token: sessionToken,
    body: { device_id: replacementDesktop.payload.device.id }
  });
  assert.equal(revokedDesktop.status, 200);
  assert.equal(hubRequests.at(-1).body.action, "revoke");

  const devicesAfterRevocation = await api("/v1/saas/devices", {
    method: "GET",
    token: sessionToken
  });
  assert.equal(devicesAfterRevocation.status, 200);
  assert.equal(devicesAfterRevocation.payload.active_count, 1);
  assert.equal(
    devicesAfterRevocation.payload.devices.filter((device) => device.status === "active").length,
    2
  );
  assert.equal(
    devicesAfterRevocation.payload.devices.filter((device) => device.status === "revoked").length,
    devicesAfterRevocation.payload.devices.length - 2
  );

  const revokedLastOwnerDevice = await api("/v1/saas/devices/revoke", {
    token: sessionToken,
    body: { device_id: registeredDesktop.payload.device.id }
  });
  assert.equal(revokedLastOwnerDevice.status, 200);

  const rejectedRecoveryPassword = await api("/v1/saas/devices/recover", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      previous_public_key: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF=",
      public_key: "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN=",
      password: "mot-de-passe-incorrect"
    }
  });
  assert.equal(rejectedRecoveryPassword.status, 401);
  assert.equal(
    rejectedRecoveryPassword.payload.details.code,
    "DEVICE_RECOVERY_PASSWORD_INVALID"
  );

  const recoveredLastOwnerDevice = await api("/v1/saas/devices/recover", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      previous_public_key: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF=",
      public_key: "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN=",
      password: "SaaSsimple123"
    }
  });
  assert.equal(recoveredLastOwnerDevice.status, 200, JSON.stringify(recoveredLastOwnerDevice.payload));
  assert.equal(recoveredLastOwnerDevice.payload.device.status, "active");
  assert.equal(recoveredLastOwnerDevice.payload.device.vpn.key_version, 3);
  assert.equal(recoveredLastOwnerDevice.payload.active_device_count, 1);
  assert.equal(hubRequests.at(-1).body.action, "rotate");

  const retriedOwnerDeviceRecovery = await api("/v1/saas/devices/recover", {
    token: sessionToken,
    body: {
      installation_id: desktopInstallationId,
      previous_public_key: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF=",
      public_key: "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN=",
      password: "SaaSsimple123"
    }
  });
  assert.equal(retriedOwnerDeviceRecovery.status, 200);
  assert.equal(retriedOwnerDeviceRecovery.payload.device.vpn.key_version, 3);
  assert.equal(hubRequests.at(-1).body.action, "upsert");

  const saasPeer = await api("/v1/saas/vpn/peers", {
    token: sessionToken,
    body: {
      action: "upsert",
      name: "Routeur SaaS",
      peer_type: "router",
      public_key: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
      resource_id: "router-niger-1"
    }
  });
  assert.equal(saasPeer.status, 200);
  assert.equal(saasPeer.payload.assigned_address, "10.250.7.2/32");
  assert.equal(hubRequests.at(-1).body.account_id, completion.payload.organization.id);
  assert.equal(hubRequests.at(-1).body.resource_id, "router-niger-1");

  const rotatedSaasPeer = await api("/v1/saas/vpn/peers", {
    token: sessionToken,
    body: {
      action: "rotate",
      name: "Routeur SaaS",
      peer_type: "router",
      previous_public_key: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
      public_key: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=",
      resource_id: "router-niger-1"
    }
  });
  assert.equal(rotatedSaasPeer.status, 200);
  assert.equal(hubRequests.at(-1).body.action, "rotate");
  assert.equal(hubRequests.at(-1).body.previous_public_key, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=");

  const saasOperatorPeers = await api("/v1/saas/vpn/peers", {
    method: "GET",
    token: sessionToken
  });
  assert.equal(saasOperatorPeers.status, 200);
  assert.equal(saasOperatorPeers.payload.peers.length, 2);
  assert.equal(saasOperatorPeers.payload.peers[0].name, "PC récupéré");
  assert.equal(saasOperatorPeers.payload.peers[0].peer_type, "operator");
  assert.equal(saasOperatorPeers.payload.peers[1].peer_type, "router");
  assert.equal(hubRequests.at(-1).url, "/v1/peers/list");

  const login = await api("/v1/saas/auth/login", {
    body: {
      email: "amina.saas@example.com",
      password: "SaaSsimple123"
    }
  });
  assert.equal(login.status, 200);
  assert.equal(login.payload.subscription.is_active, true);

  const forgot = await api("/v1/saas/auth/forgot-password", {
    body: { email: "amina.saas@example.com" }
  });
  assert.equal(forgot.status, 200);
  assert.ok(forgot.payload.reset_token);

  const reset = await api("/v1/saas/auth/reset-password", {
    body: {
      reset_token: forgot.payload.reset_token,
      new_password: "NouveauSimple123",
      confirm_password: "NouveauSimple123"
    }
  });
  assert.equal(reset.status, 200);

  const oldSession = await api("/v1/saas/auth/me", {
    method: "GET",
    token: sessionToken
  });
  assert.equal(oldSession.status, 401);

  const loginAfterReset = await api("/v1/saas/auth/login", {
    body: {
      email: "amina.saas@example.com",
      password: "NouveauSimple123"
    }
  });
  assert.equal(loginAfterReset.status, 200);

  const renewalDesktopPublicKey = "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH=";
  const renewalDesktop = await api("/v1/saas/devices/register", {
    token: loginAfterReset.payload.session.token,
    body: {
      installation_id: "223e4567-e89b-42d3-a456-426614174000",
      public_key: renewalDesktopPublicKey,
      name: "PC renouvellement",
      platform: "windows",
      app_version: "0.2.3"
    }
  });
  assert.equal(renewalDesktop.status, 200, JSON.stringify(renewalDesktop.payload));

  const unlimitedDb = new DatabaseSync(databasePath);
  unlimitedDb.prepare(`
    UPDATE organization_subscriptions
    SET device_limit_mode = 'unlimited', updated_at = ?
    WHERE organization_id = ? AND status = 'active'
  `).run(new Date().toISOString(), completion.payload.organization.id);
  unlimitedDb.close();

  const unlimitedDesktop = await api("/v1/saas/devices/register", {
    token: loginAfterReset.payload.session.token,
    body: {
      installation_id: "323e4567-e89b-42d3-a456-426614174222",
      public_key: "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII=",
      name: "PC supplémentaire illimité",
      platform: "windows",
      app_version: "0.2.5"
    }
  });
  assert.equal(unlimitedDesktop.status, 200, JSON.stringify(unlimitedDesktop.payload));
  assert.equal(unlimitedDesktop.payload.device_limit_mode, "unlimited");
  assert.equal(unlimitedDesktop.payload.max_devices, null);
  assert.equal(unlimitedDesktop.payload.active_device_count, 3);
  assert.equal(
    hubRequests.findLast((entry) => entry.url === "/v1/tenants")?.body.operator_limit,
    null
  );

  const integrationDb = new DatabaseSync(databasePath);
  integrationDb.prepare(`
    UPDATE organization_subscriptions
    SET current_period_end = ?, updated_at = ?
    WHERE organization_id = ?
  `).run(
    new Date(Date.now() - 60_000).toISOString(),
    new Date().toISOString(),
    completion.payload.organization.id
  );
  integrationDb.close();

  const graceServices = await api("/v1/saas/services/access", {
    method: "GET",
    token: loginAfterReset.payload.session.token
  });
  assert.equal(graceServices.status, 200);

  const graceAccount = await api("/v1/saas/auth/me", {
    method: "GET",
    token: loginAfterReset.payload.session.token
  });
  assert.equal(graceAccount.status, 200);
  assert.equal(graceAccount.payload.subscription.status, "grace_period");
  assert.equal(graceAccount.payload.subscription.is_active, true);
  assert.equal(graceAccount.payload.subscription.grace_days_remaining, 7);

  const graceReconciliation = await api("/v1/admin/vpn/reconcile", {
    token: masterToken,
    body: {}
  });
  assert.equal(graceReconciliation.status, 200);
  assert.ok(hubRequests.some((item) =>
    item.url === "/v1/peers"
    && item.body.public_key === renewalDesktopPublicKey
    && item.body.action === "upsert"
  ));

  const expiredDb = new DatabaseSync(databasePath);
  expiredDb.prepare(`
    UPDATE organization_subscriptions
    SET current_period_end = ?, updated_at = ?
    WHERE organization_id = ?
  `).run(
    new Date(Date.now() - 8 * 86_400_000).toISOString(),
    new Date().toISOString(),
    completion.payload.organization.id
  );
  expiredDb.close();

  const expiredServices = await api("/v1/saas/services/access", {
    method: "GET",
    token: loginAfterReset.payload.session.token
  });
  assert.equal(expiredServices.status, 402);
  assert.equal(expiredServices.payload.details.code, "SUBSCRIPTION_REQUIRED");

  const expiredReconciliation = await api("/v1/admin/vpn/reconcile", {
    token: masterToken,
    body: {}
  });
  assert.equal(expiredReconciliation.status, 200);
  assert.ok(hubRequests.some((item) =>
    item.url === "/v1/peers"
    && item.body.public_key === renewalDesktopPublicKey
    && item.body.action === "disable"
  ));

  const suspendedDevices = await api("/v1/saas/devices", {
    method: "GET",
    token: loginAfterReset.payload.session.token
  });
  assert.equal(suspendedDevices.status, 200);
  const suspendedDesktop = suspendedDevices.payload.devices.find(
    (device) => device.id === renewalDesktop.payload.device.id
  );
  assert.equal(suspendedDesktop.status, "active");
  assert.equal(suspendedDesktop.vpn.desired_state, "disabled");
  assert.equal(suspendedDesktop.vpn.applied_state, "disabled");
  assert.equal(suspendedDesktop.revoked_at, null);

  const expiredAccountStillAccessible = await api("/v1/saas/auth/me", {
    method: "GET",
    token: loginAfterReset.payload.session.token
  });
  assert.equal(expiredAccountStillAccessible.status, 200);
  assert.equal(expiredAccountStillAccessible.payload.subscription.is_active, false);
});

test("authentification, licences, paiements iPay et crédits revendeur restent cohérents", async () => {
  const adminLogin = await api("/v1/admin/auth/login", {
    body: {
      email: "alitimbo.pro11@gmail.com",
      password: "admin123"
    }
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.payload.admin.role, "owner");
  assert.equal(adminLogin.payload.admin.must_change_password, true);

  const blockedBeforePasswordChange = await api("/v1/admin/plans", {
    token: adminLogin.payload.session_token,
    body: {
      id: "should-not-be-created",
      code: "BLOCKED",
      name: "Bloqué",
      router_limit: 1,
      max_devices: 1,
      duration_days: 30
    }
  });
  assert.equal(blockedBeforePasswordChange.status, 428);

  const adminPasswordChange = await api("/v1/admin/auth/change-password", {
    token: adminLogin.payload.session_token,
    body: {
      current_password: "admin123",
      new_password: "AdminTicketPro123!"
    }
  });
  assert.equal(adminPasswordChange.status, 200);
  const adminToken = adminPasswordChange.payload.session_token;

  const smtpUnavailable = await api("/v1/admin/email/test", {
    token: adminToken,
    body: {}
  });
  assert.equal(smtpUnavailable.status, 503);

  const admins = await api("/v1/admin/admins/list", {
    token: adminToken,
    body: {}
  });
  assert.equal(admins.status, 200);
  assert.deepEqual(
    admins.payload.admins.map((admin) => admin.email).sort(),
    ["alitimbo.pro11@gmail.com", "maitredoudos54@gmail.com"]
  );

  const organizationPlan = await api("/v1/admin/plans", {
    token: adminToken,
    body: {
      id: "integration-organization-2",
      code: "INTEGRATION-ORG-2",
      name: "Organisation 2",
      router_limit: 2,
      max_devices: 2,
      duration_days: 30,
      price_cfa: 3000,
      billing_period: "monthly",
      is_reseller: false
    }
  });
  assert.equal(organizationPlan.status, 200);

  const unlimitedOrganizationPlan = await api("/v1/admin/plans", {
    token: adminToken,
    body: {
      id: "integration-organization-unlimited",
      code: "INTEGRATION-ORG-UNLIMITED",
      name: "Organisation illimitée",
      router_limit: 20,
      device_limit_mode: "unlimited",
      duration_days: 30,
      price_cfa: 25000,
      billing_period: "monthly",
      is_reseller: false
    }
  });
  assert.equal(unlimitedOrganizationPlan.status, 200);
  assert.equal(unlimitedOrganizationPlan.payload.plan.device_limit_mode, "unlimited");
  assert.equal(unlimitedOrganizationPlan.payload.plan.max_devices, null);

  const annualStarterPlan = await api("/v1/admin/plans", {
    token: adminToken,
    body: {
      id: "integration-starter-yearly",
      code: "INTEGRATION-STARTER-YEARLY",
      offer_code: "STARTER",
      name: "Starter annuel",
      router_limit: 1,
      max_devices: 2,
      duration_days: 365,
      price_cfa: 50000,
      billing_period: "yearly",
      purchase_mode: "online",
      is_reseller: false
    }
  });
  assert.equal(annualStarterPlan.status, 200);
  assert.equal(annualStarterPlan.payload.plan.offer_code, "STARTER");
  assert.equal(annualStarterPlan.payload.plan.purchase_mode, "online");

  const enterpriseContactPlan = await api("/v1/admin/plans", {
    token: adminToken,
    body: {
      id: "integration-enterprise-contact",
      code: "INTEGRATION-ENTERPRISE-CONTACT",
      offer_code: "ENTERPRISE",
      name: "Entreprise",
      router_limit: 1000,
      device_limit_mode: "unlimited",
      duration_days: 365,
      price_cfa: null,
      billing_period: "custom",
      purchase_mode: "contact",
      is_reseller: false
    }
  });
  assert.equal(enterpriseContactPlan.status, 200);
  assert.equal(enterpriseContactPlan.payload.plan.purchase_mode, "contact");
  assert.equal(enterpriseContactPlan.payload.plan.price_cfa, null);

  const publicPurchasablePlans = await api("/v1/plans", { method: "GET" });
  assert.equal(publicPurchasablePlans.status, 200);
  assert.equal(
    publicPurchasablePlans.payload.plans.some((plan) => plan.id === "integration-enterprise-contact"),
    false
  );
  const publicCatalog = await api("/v1/plans/catalog", { method: "GET" });
  assert.equal(publicCatalog.status, 200);
  assert.equal(
    publicCatalog.payload.plans.some((plan) => plan.id === "integration-enterprise-contact"),
    true
  );

  const invalidPricelessPlan = await api("/v1/admin/plans", {
    token: adminToken,
    body: {
      id: "integration-invalid-price",
      code: "INVALID-PRICE",
      name: "Prix invalide",
      router_limit: 1,
      max_devices: 1,
      duration_days: 30,
      is_active: true,
      is_reseller: false
    }
  });
  assert.equal(invalidPricelessPlan.status, 400);

  const recommendedOrganizationPlan = await api("/v1/admin/plans", {
    token: adminToken,
    body: {
      id: "integration-organization-2",
      code: "INTEGRATION-ORG-2",
      name: "Organisation 2",
      router_limit: 2,
      max_devices: 2,
      duration_days: 30,
      price_cfa: 3000,
      billing_period: "monthly",
      is_recommended: true,
      is_reseller: false
    }
  });
  assert.equal(recommendedOrganizationPlan.status, 200);
  const allPlansAfterRecommendation = await api("/v1/admin/plans/list", {
    token: adminToken,
    body: {}
  });
  assert.equal(
    allPlansAfterRecommendation.payload.plans.filter(
      (plan) => !plan.is_reseller && plan.is_recommended
    ).length,
    1
  );

  const organizationLicense = await api("/v1/admin/licenses", {
    token: adminToken,
    body: {
      plan_id: "integration-organization-2",
      label: "Organisation cliente"
    }
  });
  assert.equal(organizationLicense.status, 200);
  assert.match(organizationLicense.payload.key, /^TP-/);

  const organizationDetail = await api("/v1/admin/licenses/detail", {
    token: adminToken,
    body: { license_id: organizationLicense.payload.license_id }
  });
  assert.equal(organizationDetail.status, 200);
  assert.equal(organizationDetail.payload.license.license_type, "standard");

  const organizationPayment = await api("/v1/payments/orders/organization", {
    body: {
      plan_id: "integration-organization-2",
      msisdn: "22790909090",
      customer_name: "Organisation iPay",
      payment_type: "mobile"
    }
  });
  assert.equal(organizationPayment.status, 200);
  assert.equal(organizationPayment.payload.order.status, "pending");
  assert.equal(organizationPayment.payload.payment.meta_data.code, "123456");

  const organizationPaymentStatus = await api("/v1/payments/orders/status", {
    body: {
      order_id: organizationPayment.payload.order.order_id,
      order_token: organizationPayment.payload.order_token
    }
  });
  assert.equal(organizationPaymentStatus.status, 200);
  assert.equal(organizationPaymentStatus.payload.order.status, "succeeded");
  assert.equal(organizationPaymentStatus.payload.order.fulfillment_status, "fulfilled");
  assert.match(organizationPaymentStatus.payload.order.license_key, /^TP-/);

  const organizationPaymentStatusAgain = await api("/v1/payments/orders/status", {
    body: {
      order_id: organizationPayment.payload.order.order_id,
      order_token: organizationPayment.payload.order_token
    }
  });
  assert.equal(
    organizationPaymentStatusAgain.payload.order.license_id,
    organizationPaymentStatus.payload.order.license_id
  );

  const pendingOrganizationPayment = await api("/v1/payments/orders/organization", {
    body: {
      plan_id: "integration-organization-2",
      msisdn: "22790909090",
      customer_name: "Organisation abandon",
      payment_type: "mobile"
    }
  });
  ipayPayments.get(pendingOrganizationPayment.payload.payment.reference).status = "pending";
  const abandonedOrganizationPayment = await api("/v1/payments/orders/abandon", {
    body: {
      order_id: pendingOrganizationPayment.payload.order.order_id,
      order_token: pendingOrganizationPayment.payload.order_token
    }
  });
  assert.equal(abandonedOrganizationPayment.status, 200);
  assert.equal(abandonedOrganizationPayment.payload.abandoned, true);
  assert.equal(abandonedOrganizationPayment.payload.order.status, "cancelled");
  assert.equal(abandonedOrganizationPayment.payload.order.fulfillment_status, "failed");

  const abandonedOrganizationPaymentAgain = await api("/v1/payments/orders/abandon", {
    body: {
      order_id: pendingOrganizationPayment.payload.order.order_id,
      order_token: pendingOrganizationPayment.payload.order_token
    }
  });
  assert.equal(abandonedOrganizationPaymentAgain.payload.abandoned, true);

  const planResult = await api("/v1/admin/plans", {
    token: adminToken,
    body: {
      id: "integration-reseller-10",
      code: "INTEGRATION-RESELLER-10",
      name: "Revendeur 10",
      router_limit: 10,
      max_devices: 3,
      duration_days: 30,
      price_cfa: 10000,
      billing_period: "monthly",
      is_reseller: true
    }
  });
  assert.equal(planResult.status, 200);
  assert.equal(planResult.payload.plan.is_reseller, true);

  const selfRegistration = await api("/v1/reseller/register-and-pay", {
    body: {
      name: "Revendeur autonome",
      email: "autonome@example.com",
      password: "AutonomeTicketPro123!",
      confirm_password: "AutonomeTicketPro123!",
      plan_id: "integration-reseller-10",
      msisdn: "90909090",
      payment_type: "amanata"
    }
  });
  assert.equal(selfRegistration.status, 200);

  const selfRegistrationStatus = await api("/v1/payments/orders/status", {
    body: {
      order_id: selfRegistration.payload.order.order_id,
      order_token: selfRegistration.payload.order_token
    }
  });
  assert.equal(selfRegistrationStatus.status, 200);
  assert.equal(selfRegistrationStatus.payload.order.fulfillment_status, "fulfilled");

  const autonomousLogin = await api("/v1/reseller/auth/login", {
    body: {
      email: "autonome@example.com",
      password: "AutonomeTicketPro123!"
    }
  });
  assert.equal(autonomousLogin.status, 200);
  assert.equal(autonomousLogin.payload.reseller.router_capacity, 10);
  assert.equal(autonomousLogin.payload.reseller.must_change_password, false);

  const resellerResult = await api("/v1/admin/resellers", {
    token: adminToken,
    body: {
      plan_id: "integration-reseller-10",
      name: "Revendeur test",
      email: "revendeur@example.com",
      temporary_password: "RevendeurTemp123!",
      max_child_devices: 3,
      max_child_duration_days: 60
    }
  });
  assert.equal(resellerResult.status, 200);
  const resellerId = resellerResult.payload.reseller.id;

  const resellerLogin = await api("/v1/reseller/auth/login", {
    body: {
      email: "revendeur@example.com",
      password: "RevendeurTemp123!"
    }
  });
  assert.equal(resellerLogin.status, 200);
  assert.equal(resellerLogin.payload.reseller.must_change_password, true);

  const resellerPasswordChange = await api("/v1/reseller/auth/change-password", {
    token: resellerLogin.payload.session_token,
    body: {
      current_password: "RevendeurTemp123!",
      new_password: "RevendeurTicketPro123!"
    }
  });
  assert.equal(resellerPasswordChange.status, 200);
  let resellerToken = resellerPasswordChange.payload.session_token;

  const resetIssued = await api("/v1/admin/resellers/password-reset", {
    token: adminToken,
    body: { reseller_id: resellerId }
  });
  assert.equal(resetIssued.status, 200);

  const resetPassword = await api("/v1/reseller/auth/reset-password", {
    body: {
      email: "revendeur@example.com",
      reset_token: resetIssued.payload.reset_token,
      new_password: "RevendeurReset123!"
    }
  });
  assert.equal(resetPassword.status, 200);

  const revokedOldSession = await api("/v1/reseller/overview", {
    method: "GET",
    token: resellerToken
  });
  assert.equal(revokedOldSession.status, 401);

  const resellerLoginAfterReset = await api("/v1/reseller/auth/login", {
    body: {
      email: "revendeur@example.com",
      password: "RevendeurReset123!"
    }
  });
  assert.equal(resellerLoginAfterReset.status, 200);
  resellerToken = resellerLoginAfterReset.payload.session_token;

  const childA = await api("/v1/reseller/licenses", {
    token: resellerToken,
    body: {
      router_limit: 6,
      max_devices: 1,
      duration_days: 30,
      label: "Client A"
    }
  });
  assert.equal(childA.status, 200);
  assert.equal(childA.payload.expiry_starts_on_first_activation, true);

  const activationA = await api("/v1/licenses/activate", {
    body: {
      key: childA.payload.key,
      account_id: "client-a",
      device_id: "device-a",
      device_proof: "proof-a",
      install_id: "install-a",
      router_ids: ["router-a-1"]
    }
  });
  assert.equal(activationA.status, 200);

  const vpnBootstrap = await api("/v1/vpn/bootstrap", {
    body: {
      license_id: activationA.payload.license_id,
      activation_token: activationA.payload.activation_token,
      account_id: "client-a",
      device_id: "device-a",
      device_proof: "proof-a",
      install_id: "install-a"
    }
  });
  assert.equal(vpnBootstrap.status, 200);
  assert.equal(vpnBootstrap.payload.address_pool, "10.250.7.0/24");
  assert.equal(vpnBootstrap.payload.server_endpoint, "vpn.integration.test");
  assert.equal(hubRequests.at(-1).body.account_id, activationA.payload.license_id);
  assert.equal("api_token" in vpnBootstrap.payload, false);

  const vpnPeer = await api("/v1/vpn/peers", {
    body: {
      license_id: activationA.payload.license_id,
      activation_token: activationA.payload.activation_token,
      account_id: "client-a",
      device_id: "device-a",
      device_proof: "proof-a",
      install_id: "install-a",
      action: "upsert",
      peer_type: "router",
      name: "MikroTik test",
      public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    }
  });
  assert.equal(vpnPeer.status, 200);
  assert.equal(vpnPeer.payload.assigned_address, "10.250.7.2/32");

  const migrated = await api("/v1/saas/migrate-license", {
    body: {
      license_id: activationA.payload.license_id,
      activation_token: activationA.payload.activation_token,
      account_id: "client-a",
      device_id: "device-a",
      device_proof: "proof-a",
      install_id: "install-a",
      organization_name: "Client A historique",
      name: "Propriétaire A",
      email: "client-a@example.com",
      password: "Migration123",
      confirm_password: "Migration123"
    }
  });
  assert.equal(migrated.status, 200);
  assert.equal(migrated.payload.subscription.status, "active");
  assert.equal(migrated.payload.subscription.router_limit, 6);
  assert.equal(
    migrated.payload.subscription.current_period_end,
    activationA.payload.expires_at
  );

  const rejectedVpnDevice = await api("/v1/vpn/bootstrap", {
    body: {
      license_id: activationA.payload.license_id,
      activation_token: activationA.payload.activation_token,
      account_id: "client-a",
      device_id: "device-a",
      device_proof: "wrong-proof",
      install_id: "install-a"
    }
  });
  assert.equal(rejectedVpnDevice.status, 401);

  const childB = await api("/v1/reseller/licenses", {
    token: resellerToken,
    body: {
      router_limit: 4,
      max_devices: 2,
      duration_days: 30,
      label: "Client B"
    }
  });
  assert.equal(childB.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));

  const activationB = await api("/v1/licenses/activate", {
    body: {
      key: childB.payload.key,
      account_id: "client-b",
      device_id: "device-b",
      device_proof: "proof-b",
      install_id: "install-b",
      router_ids: ["router-b-1"]
    }
  });
  assert.equal(activationB.status, 200);
  assert.notEqual(activationA.payload.license_id, activationB.payload.license_id);
  assert.ok(Date.parse(activationB.payload.expires_at) > Date.parse(activationA.payload.expires_at));

  const overCapacity = await api("/v1/reseller/licenses", {
    token: resellerToken,
    body: { router_limit: 1, duration_days: 30 }
  });
  assert.equal(overCapacity.status, 409);
  assert.equal(overCapacity.payload.details.router_available, 0);

  const crossLicense = await api("/v1/licenses/validate", {
    body: {
      license_id: activationB.payload.license_id,
      activation_token: activationA.payload.activation_token,
      account_id: "client-a",
      device_id: "device-a",
      device_proof: "proof-a",
      install_id: "install-a",
      router_ids: ["router-a-1"]
    }
  });
  assert.equal(crossLicense.status, 401);

  const list = await api("/v1/reseller/licenses/list", { token: resellerToken, body: {} });
  assert.equal(list.status, 200);
  assert.equal(list.payload.licenses.length, 2);
  assert.equal("account_id" in list.payload.licenses[0], false);
  assert.equal("activation_token" in list.payload.licenses[0], false);

  const revokeChildA = await api("/v1/reseller/licenses/revoke", {
    token: resellerToken,
    body: { license_id: activationA.payload.license_id }
  });
  assert.equal(revokeChildA.status, 200);
  assert.equal(revokeChildA.payload.reseller.router_available, 0);
  assert.equal(revokeChildA.payload.reseller.router_consumed, 10);

  const replacementWithoutPayment = await api("/v1/reseller/licenses", {
    token: resellerToken,
    body: { router_limit: 6, duration_days: 30, label: "Client C" }
  });
  assert.equal(replacementWithoutPayment.status, 409);

  const resellerPayment = await api("/v1/reseller/payments/orders", {
    headers: { "x-forwarded-for": "10.20.30.40" },
    token: resellerToken,
    body: {
      plan_id: "integration-reseller-10",
      msisdn: "+227 90 90 90 90",
      payment_type: "nita_online"
    }
  });
  assert.equal(resellerPayment.status, 200);

  const resellerWebhookPayload = {
    data: {
      external_reference: resellerPayment.payload.order.transaction_id,
      reference: resellerPayment.payload.payment.reference,
      status: "succeeded",
      amount: 10000,
      msisdn: "22790909090"
    }
  };
  const unauthorizedWebhook = await api("/v1/payments/ipay/webhook", {
    headers: { "Secret-Hash": "wrong-secret" },
    body: resellerWebhookPayload
  });
  assert.equal(unauthorizedWebhook.status, 401);

  const resellerWebhook = await api("/v1/payments/ipay/webhook", {
    headers: { "Secret-Hash": "ipay-webhook-secret-test" },
    body: resellerWebhookPayload
  });
  assert.equal(resellerWebhook.status, 200);
  assert.equal(resellerWebhook.payload.fulfillment_status, "fulfilled");

  const duplicateWebhook = await api("/v1/payments/ipay/webhook", {
    headers: { "Secret-Hash": "ipay-webhook-secret-test" },
    body: resellerWebhookPayload
  });
  assert.equal(duplicateWebhook.status, 200);

  const resellerAfterPayment = await api("/v1/reseller/overview", {
    method: "GET",
    token: resellerToken
  });
  assert.equal(resellerAfterPayment.payload.reseller.router_capacity, 20);
  assert.equal(resellerAfterPayment.payload.reseller.router_available, 10);

  const replacement = await api("/v1/reseller/licenses", {
    token: resellerToken,
    body: { router_limit: 6, duration_days: 30, label: "Client C" }
  });
  assert.equal(replacement.status, 200);
  assert.equal(replacement.payload.reseller.router_available, 4);

  const revokeReseller = await api("/v1/admin/resellers/revoke", {
    token: adminToken,
    body: { reseller_id: resellerId }
  });
  assert.equal(revokeReseller.status, 200);
  assert.equal(revokeReseller.payload.child_licenses_unchanged, true);

  const blockedOverview = await api("/v1/reseller/overview", {
    method: "GET",
    token: resellerToken
  });
  assert.equal(blockedOverview.status, 403);

  const childBStillValid = await api("/v1/licenses/validate", {
    body: {
      license_id: activationB.payload.license_id,
      activation_token: activationB.payload.activation_token,
      account_id: "client-b",
      device_id: "device-b",
      device_proof: "proof-b",
      install_id: "install-b",
      router_ids: ["router-b-1"]
    }
  });
  assert.equal(childBStillValid.status, 200);
});
