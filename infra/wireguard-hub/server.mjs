import http from "node:http";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  isIdempotentActivePeer,
  isPeerLimitReached,
  revokeDuplicateActivePeers,
  selectActivePeersToReplace,
  selectRevokedPeerForRecovery
} from "./peer-lifecycle.mjs";
import { buildTenantFirewallCommands } from "./tenant-firewall.mjs";

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
const peerMutationQueues = new Map();

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
      await assertWireGuardInterfaceUp();
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
      tenant.operator_limit = normalizeOptionalLimit(body.operator_limit, tenant.operator_limit ?? 1);
      tenants[accountId] = tenant;
      await persistTenants();
      await syncTenantFirewall();
      json(response, 200, tenantResponse(accountId, tenant));
    } catch (error) {
      jsonError(response, error);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/v1/peers/list") {
    try {
      const body = await readJson(request);
      const accountId = requireAccountId(body);
      const tenant = tenants[accountId];
      if (!tenant) throw new HubError(404, "tenant_not_found");
      requireTenantOrMaster(request, accountId);
      const latestHandshakes = await readLatestHandshakes();
      json(response, 200, {
        account_id: accountId,
        peers: tenant.peers.map((peer) => ({
          assigned_address: peer.assigned_address,
          created_at: peer.created_at,
          name: peer.name ?? "",
          peer_type: peer.peer_type,
          public_key: peer.public_key,
          resource_id: peer.resource_id ?? legacyResourceId(peer.public_key),
          revoked_at: peer.revoked_at ?? null,
          status: peer.status,
          ...peerRuntimeState(peer, latestHandshakes)
        }))
      });
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
      if (!["upsert", "disable", "revoke", "rotate"].includes(body.action)) {
        throw new HubError(400, "invalid_action");
      }
      const result = await withPeerMutationLock("wireguard-global", () =>
        mutatePeer(accountId, tenant, body)
      );
      json(response, 200, result);
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
    for (const peer of tenant.peers) {
      peer.resource_id ||= legacyResourceId(peer.public_key);
    }
    revokeDuplicateActivePeers(tenant.peers);
    tenant.router_limit = normalizeLimit(tenant.router_limit, 1);
    tenant.operator_limit = normalizeOptionalLimit(tenant.operator_limit, 1);
  }
}

async function mutatePeer(accountId, tenant, body) {
  const publicKey = String(body.public_key);
  const peerType = body.peer_type === "operator" ? "operator" : "router";
  const resourceId = normalizeResourceId(body.resource_id ?? legacyResourceId(publicKey));
  const existing = tenant.peers.find((peer) => peer.public_key === publicKey);
  const previousPublicKey = body.previous_public_key
    ? String(body.previous_public_key)
    : null;
  if (previousPublicKey) validatePublicKey(previousPublicKey);
  if (body.action === "rotate" && (!previousPublicKey || previousPublicKey === publicKey)) {
    throw new HubError(400, "rotation_requires_distinct_previous_key");
  }

  if (body.action === "revoke") {
    const revokedAt = new Date().toISOString();
    if (existing) {
      existing.status = "revoked";
      existing.revoked_at = revokedAt;
    }
    if (!isPublicKeyActiveInAnotherTenant(accountId, publicKey)) {
      await runWireGuard(["set", interfaceName, "peer", publicKey, "remove"]);
    }
    await syncTenantFirewall();
    await saveWireGuardConfig();
    await persistTenants();
    return { account_id: accountId, public_key: publicKey, resource_id: resourceId, status: "revoked" };
  }

  if (body.action === "disable") {
    if (existing && existing.status !== "revoked") {
      existing.status = "disabled";
      existing.disabled_at = new Date().toISOString();
    }
    if (!isPublicKeyActiveInAnotherTenant(accountId, publicKey)) {
      await runWireGuard(["set", interfaceName, "peer", publicKey, "remove"]);
    }
    await syncTenantFirewall();
    await saveWireGuardConfig();
    await persistTenants();
    return {
      account_id: accountId,
      public_key: publicKey,
      resource_id: resourceId,
      status: existing?.status === "revoked" ? "revoked" : "disabled"
    };
  }

  if (existing?.status === "revoked") {
    throw new HubError(409, "revoked_key_cannot_be_reactivated");
  }
  const sharedPeer = findActivePeerInAnotherTenant(accountId, publicKey);

  if (isIdempotentActivePeer(existing, { peerType, publicKey, resourceId })) {
    await syncWireGuardPeers();
    await syncTenantFirewall();
    return {
      account_id: accountId,
      address_pool: tenant.address_pool,
      assigned_address: existing.assigned_address,
      public_key: publicKey,
      resource_id: resourceId,
      replaced_public_keys: [],
      status: "active"
    };
  }

  const replacedPeers = selectActivePeersToReplace(tenant.peers, {
    peerType,
    previousPublicKey,
    publicKey,
    resourceId
  });
  const revokedPeerForRecovery = body.action === "rotate" && replacedPeers.length === 0
    ? selectRevokedPeerForRecovery(tenant.peers, {
        peerType,
        previousPublicKey,
        resourceId
      })
    : null;
  if (body.action === "upsert" && replacedPeers.length > 0) {
    throw new HubError(409, "active_peer_already_exists_for_resource");
  }
  if (body.action === "rotate" && replacedPeers.length === 0 && !revokedPeerForRecovery) {
    throw new HubError(409, "active_previous_peer_not_found");
  }

  let replacementAddress = revokedPeerForRecovery?.assigned_address ?? null;
  if (body.action === "rotate" && replacedPeers.length > 0) {
    replacementAddress = replacedPeers[0].assigned_address;
    const revokedAt = new Date().toISOString();
    for (const replaced of replacedPeers) {
      // Security is fail-closed: the former key is removed before the new key
      // is accepted and persisted.
      await runWireGuard(["set", interfaceName, "peer", replaced.public_key, "remove"]);
      replaced.status = "revoked";
      replaced.revoked_at = revokedAt;
    }
    await saveWireGuardConfig();
    await persistTenants();
  }

  const peer = existing ?? {
    assigned_address: replacementAddress ?? sharedPeer?.assigned_address ?? allocatePeerAddress(tenant),
    created_at: new Date().toISOString(),
    public_key: publicKey
  };
  peer.name = typeof body.name === "string" ? body.name.slice(0, 200) : "";
  peer.peer_type = peerType;
  peer.resource_id = resourceId;
  const activeOfType = tenant.peers.filter((item) =>
    item.public_key !== peer.public_key
    && item.peer_type === peerType
    && item.status === "active"
  ).length;
  const limit = peerType === "operator" ? tenant.operator_limit : tenant.router_limit;
  if (isPeerLimitReached(activeOfType, limit)) {
    throw new HubError(409, `${peerType}_peer_limit_reached`);
  }

  peer.status = "active";
  peer.disabled_at = null;
  peer.revoked_at = null;
  if (!existing) tenant.peers.push(peer);
  await syncWireGuardPeers();
  await syncTenantFirewall();
  await saveWireGuardConfig();
  await persistTenants();
  return {
    account_id: accountId,
    address_pool: tenant.address_pool,
    assigned_address: peer.assigned_address,
    public_key: publicKey,
    resource_id: resourceId,
    replaced_public_keys: replacedPeers.map((replaced) => replaced.public_key),
    status: "active"
  };
}

async function withPeerMutationLock(mutationKey, mutation) {
  const previous = peerMutationQueues.get(mutationKey) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  peerMutationQueues.set(mutationKey, queued);
  await previous;
  try {
    return await mutation();
  } finally {
    release();
    if (peerMutationQueues.get(mutationKey) === queued) peerMutationQueues.delete(mutationKey);
  }
}

function findActivePeerInAnotherTenant(accountId, publicKey) {
  for (const [candidateAccountId, candidate] of Object.entries(tenants)) {
    if (candidateAccountId === accountId) continue;
    const peer = candidate.peers?.find((item) =>
      item.public_key === publicKey && item.status === "active"
    );
    if (peer) return peer;
  }
  return null;
}

function isPublicKeyActiveInAnotherTenant(accountId, publicKey) {
  return Boolean(findActivePeerInAnotherTenant(accountId, publicKey));
}

async function readLatestHandshakes() {
  const { stdout } = await execFileAsync(
    "wg",
    ["show", interfaceName, "latest-handshakes"],
    { timeout: 10_000 }
  );
  return new Map(stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [publicKey, rawTimestamp] = line.trim().split(/\s+/);
    return [publicKey, Number(rawTimestamp) || 0];
  }));
}

function peerRuntimeState(peer, latestHandshakes) {
  if (peer.status === "revoked") {
    return { connection_status: "revoked", last_handshake_at: null };
  }
  if (peer.status !== "active") {
    return { connection_status: "disconnected", last_handshake_at: null };
  }
  const timestamp = latestHandshakes.get(peer.public_key) ?? 0;
  const connected = timestamp > 0 && timestamp * 1_000 >= Date.now() - 180_000;
  return {
    connection_status: connected ? "connected" : "disconnected",
    last_handshake_at: timestamp > 0 ? new Date(timestamp * 1_000).toISOString() : null
  };
}

function normalizeResourceId(value) {
  const resourceId = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(resourceId)) {
    throw new HubError(400, "invalid_resource_id");
  }
  return resourceId;
}

function legacyResourceId(publicKey) {
  return `legacy:${createHash("sha256").update(String(publicKey)).digest("hex")}`;
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
      // Une adresse reste attachée à l'historique du pair, même révoqué.
      // Une rotation de clé réutilise explicitement l'adresse du même device,
      // tandis qu'un nouvel appareil reçoit toujours une IP encore jamais vue.
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
  for (const command of buildTenantFirewallCommands(tenants, interfaceName)) {
    if (command.fallbackArgs) {
      try {
        await runIptables(command.args);
      } catch {
        await runIptables(command.fallbackArgs);
      }
    } else {
      await runIptables(command.args, command.ignoreFailure);
    }
  }
}

async function syncWireGuardPeers() {
  const activePeers = new Map();
  for (const tenant of Object.values(tenants)) {
    for (const peer of tenant.peers) {
      if (peer.status !== "active") continue;
      const grouped = activePeers.get(peer.public_key) ?? {
        allowedAddresses: new Set(),
        keepalive: 25,
        publicKey: peer.public_key
      };
      grouped.allowedAddresses.add(peer.assigned_address);
      grouped.keepalive = normalizeKeepalive(peer.persistent_keepalive ?? grouped.keepalive);
      activePeers.set(peer.public_key, grouped);
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
      peer.publicKey,
      "allowed-ips",
      [...peer.allowedAddresses].join(","),
      "persistent-keepalive",
      String(peer.keepalive)
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

function normalizeOptionalLimit(value, fallback) {
  if (value === null) return null;
  return normalizeLimit(value, fallback === null ? 1 : fallback);
}

async function assertWireGuardInterfaceUp() {
  const { stdout } = await execFileAsync(
    "ip",
    ["-o", "link", "show", "dev", interfaceName],
    { timeout: 10_000 }
  );
  const flags = stdout.match(/<([^>]*)>/)?.[1]?.split(",") ?? [];
  if (!flags.includes("UP")) throw new Error("wireguard_interface_down");
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
