import { decryptLocalSecret, encryptLocalSecret } from "../security/localSecrets";

const PRIME = (1n << 255n) - 19n;
const A24 = 121665n;
const BASEPOINT = 9n;

export type WireGuardKeyPair = {
  privateKey: string;
  publicKey: string;
};

export type VpnPeerConfig = {
  address: string;
  privateKey: string;
  publicKey: string;
  allowedIps: string;
  endpoint: string;
};

export function generateWireGuardKeyPair(): WireGuardKeyPair {
  const privateBytes = new Uint8Array(32);
  crypto.getRandomValues(privateBytes);
  clampScalar(privateBytes);

  return {
    privateKey: encodeKey(privateBytes),
    publicKey: encodeKey(bigIntToLittleEndian(x25519(privateBytes, BASEPOINT)))
  };
}

export async function protectWireGuardPrivateKey(privateKey: string): Promise<string> {
  return encryptLocalSecret(privateKey);
}

export async function revealWireGuardPrivateKey(encryptedPrivateKey: string): Promise<string> {
  return decryptLocalSecret(encryptedPrivateKey);
}

export function allocateWireGuardAddress(addressPool: string, usedAddresses: string[]): string {
  const [network, prefixText] = addressPool.split("/");
  const prefix = Number(prefixText);
  const octets = network.split(".").map(Number);

  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255) || prefix < 16 || prefix > 30) {
    throw new Error("Le pool VPN doit être un réseau IPv4 CIDR valide entre /16 et /30.");
  }

  const networkNumber = toNumber(octets) & prefixMask(prefix);
  const broadcastNumber = networkNumber | (~prefixMask(prefix) >>> 0);
  const used = new Set(usedAddresses.map((address) => address.split("/")[0]));

  for (let candidate = networkNumber + 1; candidate < broadcastNumber; candidate += 1) {
    const address = fromNumber(candidate);
    if (!used.has(address)) {
      return `${address}/${prefix}`;
    }
  }

  throw new Error("Le pool VPN ne contient plus d'adresse disponible.");
}

export function buildRouterOsWireGuardScript(input: {
  interfaceName: string;
  privateKey: string;
  assignedAddress: string;
  serverPublicKey: string;
  serverEndpoint: string;
  serverPort: number;
  serverAllowedIps: string;
}): string {
  return [
    `# TicketPro — configuration WireGuard MikroTik`,
    `# Exécuter avec un compte administrateur RouterOS.`,
    `/interface/wireguard/add name=${quoteRouterOs(input.interfaceName)} private-key=${quoteRouterOs(input.privateKey)} listen-port=13231`,
    `/ip/address/add address=${quoteRouterOs(input.assignedAddress)} interface=${quoteRouterOs(input.interfaceName)}`,
    `/interface/wireguard/peers/add interface=${quoteRouterOs(input.interfaceName)} public-key=${quoteRouterOs(input.serverPublicKey)} allowed-address=${quoteRouterOs(input.serverAllowedIps)} endpoint-address=${quoteRouterOs(input.serverEndpoint)} endpoint-port=${input.serverPort} persistent-keepalive=25`,
    `/ip/route/add dst-address=${quoteRouterOs(input.serverAllowedIps)} gateway=${quoteRouterOs(input.interfaceName)}`
  ].join("\n");
}

export function buildOperatorWireGuardConfig(input: VpnPeerConfig): string {
  return [
    "# TicketPro — profil opérateur WireGuard",
    "# Importer ce fichier dans le client WireGuard officiel.",
    "[Interface]",
    `PrivateKey = ${input.privateKey}`,
    `Address = ${input.address}`,
    "",
    "[Peer]",
    `PublicKey = ${input.publicKey}`,
    `AllowedIPs = ${input.allowedIps}`,
    `Endpoint = ${input.endpoint}`,
    "PersistentKeepalive = 25",
    ""
  ].join("\n");
}

function clampScalar(bytes: Uint8Array): void {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
}

function x25519(privateBytes: Uint8Array, u: bigint): bigint {
  const scalar = littleEndianToBigInt(privateBytes);
  let x1 = u;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;

  for (let bit = 254; bit >= 0; bit -= 1) {
    const k = (scalar >> BigInt(bit)) & 1n;
    swap ^= k;
    if (swap === 1n) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = k;
    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    x3 = mod((da + cb) * (da + cb));
    z3 = mod(x1 * (da - cb) * (da - cb));
    x2 = mod(aa * bb);
    z2 = mod(e * (aa + A24 * e));
  }

  if (swap === 1n) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  return mod(x2 * modPow(z2, PRIME - 2n));
}

function mod(value: bigint): bigint {
  return ((value % PRIME) + PRIME) % PRIME;
}

function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let current = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) {
      result = mod(result * current);
    }
    current = mod(current * current);
    remaining >>= 1n;
  }
  return result;
}

function littleEndianToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(bytes[index]);
  }
  return result;
}

function bigIntToLittleEndian(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return bytes;
}

function encodeKey(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function toNumber(octets: number[]): number {
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function fromNumber(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function prefixMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function quoteRouterOs(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
