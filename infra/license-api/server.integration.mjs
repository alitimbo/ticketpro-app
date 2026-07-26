import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = 20_000 + Math.floor(Math.random() * 10_000);
const ipayPort = 30_000 + Math.floor(Math.random() * 10_000);
const hubPort = 40_000 + Math.floor(Math.random() * 10_000);
const baseUrl = `http://127.0.0.1:${port}`;
const masterToken = "ticketpro-integration-master-token";
const hubMasterToken = "ticketpro-integration-hub-master-token";
const databasePath = path.join(process.cwd(), `license-integration-${process.pid}.sqlite`);
let server;
let ipayServer;
let hubServer;
const ipayPayments = new Map();
const hubRequests = [];

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
  const payload = await response.json();
  return { status: response.status, payload };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
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
    response.end(JSON.stringify({
      account_id: body.account_id,
      address_pool: "10.250.7.0/24",
      assigned_address: body.action === "upsert" ? "10.250.7.2/32" : null,
      public_key: body.public_key,
      status: body.action === "revoke" ? "revoked" : "active"
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
      LICENSE_MASTER_TOKEN: masterToken,
      LICENSE_HASH_SECRET: "integration-hash-secret-at-least-32-characters",
      IPAY_BASE_URL: `http://127.0.0.1:${ipayPort}`,
      IPAY_ENV: "test",
      IPAY_PUBLIC_KEY: "ipay-public-test",
      IPAY_PRIVATE_KEY: "ipay-private-test",
      IPAY_SECRET_HASH: "ipay-webhook-secret-test",
      VPN_HUB_URL: `http://127.0.0.1:${hubPort}`,
      VPN_HUB_MASTER_TOKEN: hubMasterToken
    },
    stdio: ["ignore", "ignore", "pipe"]
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
