import http from "node:http";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.HUB_PORT ?? 8788);
const interfaceName = process.env.WG_INTERFACE ?? "wg0";
const masterToken = process.env.HUB_MASTER_TOKEN ?? "";
const fallbackToken = process.env.HUB_API_TOKEN ?? "";
const accountTokens = JSON.parse(process.env.HUB_API_TOKENS_JSON ?? "{}");
const tenantsFile = process.env.HUB_TENANTS_FILE ?? "/data/tenants.json";
const supernet = parseCidr(process.env.HUB_SUPERNET ?? "10.250.0.0/16");
const tenantPrefix = Number(process.env.HUB_TENANT_PREFIX ?? 24);
const publicEndpoint = process.env.HUB_PUBLIC_ENDPOINT ?? "";
const serverPublicKey = process.env.HUB_SERVER_PUBLIC_KEY ?? "";
const serverPort = Number(process.env.HUB_SERVER_PORT ?? 51820);
const tenants = await loadTenants();

validateConfiguration();
upgradeTenantData();
await persistTenants();
await syncWireGuardPeers();
await syncTenantFirewall();

const server = http.createServer(async (request, response) => {
  applyCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    try {
      await runWireGuard(["show", interfaceName]);
      json(response, 200, {
        interface: interfaceName,
        status: "ok",
        tenant_count: Object.keys(tenants).length
      });
    } catch {
      json(response, 503, { interface: interfaceName, status: "unavailable" });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/v1/tenants") {
    try {
      requireMaster(request);
      const body = await readJson(request);
      const accountId = requireAccountId(body);
      const tenant = tenants[accountId] ?? createTenant();
      tenant.router_limit = normalizeLimit(body.router_limit, tenant.router_limit ?? 1);
      tenant.operator_limit = normalizeLimit(body.operator_limit, tenant.operator_limit ?? 1);
      tenants[accountId] = tenant;
      await persistTenants();
      await syncTenantFirewall();
      json(response, 200, tenantResponse(accountId, tenant));
    } catch (error) {
      jsonError(response, error);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/v1/peers") {
    try {
      const body = await readJson(request);
      const accountId = requireAccountId(body);
      const tenant = tenants[accountId];
      if (!tenant) throw new HubError(404, "tenant_not_found");
      requireTenantOrMaster(request, accountId);
      validatePublicKey(body.public_key);
      if (body.action !== "upsert" && body.action !== "revoke") {
        throw new HubError(400, "invalid_action");
      }

      const existing = tenant.peers.find((peer) => peer.public_key === body.public_key);
      if (body.action === "revoke") {
        await runWireGuard(["set", interfaceName, "peer", body.public_key, "remove"]);
        if (existing) {
          existing.status = "revoked";
          existing.revoked_at = new Date().toISOString();
        }
        await saveWireGuardConfig();
        await persistTenants();
        json(response, 200, {
          account_id: accountId,
          public_key: body.public_key,
          status: "revoked"
        });
        return;
      }

      const peer = existing ?? {
        assigned_address: allocatePeerAddress(tenant),
        created_at: new Date().toISOString(),
        public_key: body.public_key
      };
      if (existing && tenant.peers.some((item) =>
        item.public_key !== existing.public_key
        && item.status === "active"
        && item.assigned_address === existing.assigned_address
      )) {
        peer.assigned_address = allocatePeerAddress(tenant);
      }
      peer.name = typeof body.name === "string" ? body.name.slice(0, 200) : "";
      peer.peer_type = body.peer_type === "operator" ? "operator" : "router";
      const activeOfType = tenant.peers.filter((item) =>
        item.public_key !== peer.public_key
        && item.peer_type === peer.peer_type
        && item.status === "active"
      ).length;
      const limit = peer.peer_type === "operator" ? tenant.operator_limit : tenant.router_limit;
      if (activeOfType >= limit) throw new HubError(409, `${peer.peer_type}_peer_limit_reached`);
      peer.status = "active";
      peer.revoked_at = null;
      if (!existing) tenant.peers.push(peer);

      await runWireGuard([
        "set",
        interfaceName,
        "peer",
        peer.public_key,
        "allowed-ips",
        peer.assigned_address,
        "persistent-keepalive",
        String(normalizeKeepalive(body.persistent_keepalive))
      ]);
      await saveWireGuardConfig();
      await persistTenants();
      json(response, 200, {
        account_id: accountId,
        address_pool: tenant.address_pool,
        assigned_address: peer.assigned_address,
        public_key: peer.public_key,
        status: "active"
      });
    } catch (error) {
      jsonError(response, error);
    }
    return;
  }

  json(response, 404, { error: "not_found" });
});

server.listen(port, process.env.HUB_BIND ?? "127.0.0.1", () => {
  console.log(`TicketPro WireGuard hub listening on ${process.env.HUB_BIND ?? "127.0.0.1"}:${port}`);
});

function validateConfiguration() {
  if (masterToken.length < 32) throw new Error("HUB_MASTER_TOKEN doit contenir au moins 32 caractères.");
  if (!publicEndpoint) throw new Error("HUB_PUBLIC_ENDPOINT est requis.");
  validatePublicKey(serverPublicKey);
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error("HUB_SERVER_PORT invalide.");
  }
  if (!Number.isInteger(tenantPrefix) || tenantPrefix <= supernet.prefix || tenantPrefix > 29) {
    throw new Error("HUB_TENANT_PREFIX doit être supérieur au préfixe du supernet et inférieur ou égal à 29.");
  }
}

function upgradeTenantData() {
  for (const [accountId, tenant] of Object.entries(tenants)) {
    tenant.api_token ||= randomBytes(32).toString("hex");
    tenant.created_at ||= new Date().toISOString();
    tenant.address_pool ||= allocateTenantSubnet(accountId);
    tenant.peers = Array.isArray(tenant.peers) ? tenant.peers : [];
    tenant.router_limit = normalizeLimit(tenant.router_limit, 1);
    tenant.operator_limit = normalizeLimit(tenant.operator_limit, 1);
  }
}

function createTenant() {
  return {
    address_pool: allocateTenantSubnet(),
    api_token: randomBytes(32).toString("hex"),
    created_at: new Date().toISOString(),
    peers: []
  };
}

function allocateTenantSubnet(excludedAccountId = null) {
  const subnetSize = 2 ** (32 - tenantPrefix);
  const capacity = 2 ** (tenantPrefix - supernet.prefix);
  const used = new Set(
    Object.entries(tenants)
      .filter(([accountId]) => accountId !== excludedAccountId)
      .map(([, tenant]) => tenant.address_pool)
      .filter(Boolean)
  );
  for (let index = 0; index < capacity; index += 1) {
    const cidr = `${intToIpv4(supernet.network + index * subnetSize)}/${tenantPrefix}`;
    if (!used.has(cidr)) return cidr;
  }
  throw new HubError(409, "vpn_address_capacity_exhausted");
}

function allocatePeerAddress(tenant) {
  const network = parseCidr(tenant.address_pool);
  const used = new Set(
    tenant.peers
      .filter((peer) => peer.status === "active")
      .map((peer) => peer.assigned_address)
  );
  const hostCount = 2 ** (32 - network.prefix);
  for (let host = 2; host < hostCount - 1; host += 1) {
    const address = `${intToIpv4(network.network + host)}/32`;
    if (!used.has(address)) return address;
  }
  throw new HubError(409, "tenant_address_capacity_exhausted");
}

async function syncTenantFirewall() {
  await runIptables(["-N", "TICKETPRO-WG"], true);
  await runIptables(["-F", "TICKETPRO-WG"]);
  for (const tenant of Object.values(tenants)) {
    await runIptables(["-A", "TICKETPRO-WG", "-s", tenant.address_pool, "-d", tenant.address_pool, "-j", "ACCEPT"]);
  }
  await runIptables(["-A", "TICKETPRO-WG", "-j", "DROP"]);
  const jump = ["FORWARD", "-i", interfaceName, "-o", interfaceName, "-j", "TICKETPRO-WG"];
  try {
    await runIptables(["-C", ...jump]);
  } catch {
    await runIptables(["-I", ...jump]);
  }
}

async function syncWireGuardPeers() {
  const activePeers = new Map();
  for (const tenant of Object.values(tenants)) {
    for (const peer of tenant.peers) {
      if (peer.status === "active") activePeers.set(peer.public_key, peer);
    }
  }

  const { stdout } = await execFileAsync("wg", ["show", interfaceName, "peers"], { timeout: 10_000 });
  const configuredKeys = stdout.split(/\s+/).filter(Boolean);
  for (const publicKey of configuredKeys) {
    if (!activePeers.has(publicKey)) {
      await runWireGuard(["set", interfaceName, "peer", publicKey, "remove"]);
    }
  }
  for (const peer of activePeers.values()) {
    await runWireGuard([
      "set",
      interfaceName,
      "peer",
      peer.public_key,
      "allowed-ips",
      peer.assigned_address,
      "persistent-keepalive",
      "25"
    ]);
  }
  await saveWireGuardConfig();
}

async function loadTenants() {
  try {
    return JSON.parse(await readFile(tenantsFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Impossible de charger ${tenantsFile}: ${error instanceof Error ? error.message : "erreur inconnue"}`);
  }
}

async function persistTenants() {
  await mkdir(tenantsFile.substring(0, tenantsFile.lastIndexOf("/")), { recursive: true });
  const temporaryFile = `${tenantsFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(tenants, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryFile, tenantsFile);
}

function tenantResponse(accountId, tenant) {
  return {
    account_id: accountId,
    address_pool: tenant.address_pool,
    server_endpoint: publicEndpoint,
    server_port: serverPort,
    server_public_key: serverPublicKey
  };
}

function requireMaster(request) {
  if (request.headers.authorization !== `Bearer ${masterToken}`) {
    throw new HubError(401, "unauthorized");
  }
}

function requireTenantOrMaster(request, accountId) {
  const expectedToken = tenants[accountId]?.api_token ?? accountTokens[accountId] ?? fallbackToken;
  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${masterToken}` && (!expectedToken || authorization !== `Bearer ${expectedToken}`)) {
    throw new HubError(401, "unauthorized");
  }
}

function requireAccountId(body) {
  if (typeof body.account_id !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(body.account_id)) {
    throw new HubError(400, "invalid_account_id");
  }
  return body.account_id;
}

function validatePublicKey(value) {
  if (!/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(String(value ?? ""))) {
    throw new HubError(400, "invalid_wireguard_public_key");
  }
}

function normalizeKeepalive(value) {
  const keepalive = Number(value ?? 25);
  return Number.isInteger(keepalive) && keepalive >= 0 && keepalive <= 65535 ? keepalive : 25;
}

function normalizeLimit(value, fallback) {
  const limit = Number(value ?? fallback);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100_000 ? limit : fallback;
}

function parseCidr(value) {
  const [address, rawPrefix] = String(value).split("/");
  const prefix = Number(rawPrefix);
  const addressInt = ipv4ToInt(address);
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) throw new Error(`CIDR invalide: ${value}`);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (addressInt & mask) >>> 0;
  if (network !== addressInt) throw new Error(`Le CIDR doit être une adresse réseau: ${value}`);
  return { network, prefix };
}

function ipv4ToInt(value) {
  const octets = String(value).split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error(`Adresse IPv4 invalide: ${value}`);
  }
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function intToIpv4(value) {
  const normalized = value >>> 0;
  return [
    (normalized >>> 24) & 255,
    (normalized >>> 16) & 255,
    (normalized >>> 8) & 255,
    normalized & 255
  ].join(".");
}

async function runWireGuard(args) {
  await execFileAsync("wg", args, { timeout: 10_000 });
}

async function saveWireGuardConfig() {
  await execFileAsync("wg-quick", ["save", interfaceName], { timeout: 10_000 });
}

async function runIptables(args, ignoreFailure = false) {
  try {
    await execFileAsync("iptables", args, { timeout: 10_000 });
  } catch (error) {
    if (!ignoreFailure) throw error;
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100_000) reject(new HubError(413, "payload_too_large"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        reject(new HubError(400, "invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

function applyCors(response) {
  response.setHeader("Access-Control-Allow-Origin", process.env.HUB_ALLOWED_ORIGIN ?? "null");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
}

function jsonError(response, error) {
  const status = error instanceof HubError ? error.status : 500;
  if (status === 500) console.error(error);
  json(response, status, { error: error instanceof Error ? error.message : "internal_error" });
}

function json(response, status, body) {
  response.writeHead(status).end(JSON.stringify(body));
}

class HubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
