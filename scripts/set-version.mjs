import { readFile, writeFile } from "node:fs/promises";

const nextVersion = String(process.argv[2] ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  throw new Error("Utilisation : npm run version:set -- 0.2.0");
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
const tauriConfig = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const cargoManifest = await readFile("src-tauri/Cargo.toml", "utf8");

packageJson.version = nextVersion;
packageLock.version = nextVersion;
if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = nextVersion;
}
tauriConfig.version = nextVersion;
const updatedCargoManifest = cargoManifest.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${nextVersion}"`
);

await Promise.all([
  writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile("package-lock.json", `${JSON.stringify(packageLock, null, 2)}\n`),
  writeFile("src-tauri/tauri.conf.json", `${JSON.stringify(tauriConfig, null, 2)}\n`),
  writeFile("src-tauri/Cargo.toml", updatedCargoManifest)
]);

process.stdout.write(`Version TicketPro synchronisée : ${nextVersion}\n`);
