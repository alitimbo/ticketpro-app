import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve("src-tauri/resources/vpn/x86_64");
const manifest = JSON.parse(await readFile(resolve(directory, "COMPONENTS.json"), "utf8"));

const components = [
  ["tunnel.dll", manifest.wireguardWindows.sha256],
  ["wireguard.dll", manifest.wireguardNt.sha256]
];

for (const [fileName, expectedHash] of components) {
  const bytes = await readFile(resolve(directory, fileName));
  const actualHash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (actualHash !== expectedHash) {
    throw new Error(`${fileName}: SHA-256 invalide (${actualHash})`);
  }
}

console.log(`Composants WireGuard ${manifest.architecture} verifies.`);
