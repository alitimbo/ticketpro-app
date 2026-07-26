import { access, readFile } from "node:fs/promises";

const expectedApiUrl = "https://license.autoticket-ne.com";
const requiredIcons = [
  "src-tauri/icons/32x32.png",
  "src-tauri/icons/128x128.png",
  "src-tauri/icons/128x128@2x.png",
  "src-tauri/icons/icon.ico"
];
const forbiddenFrontendKeys = [
  "IPAY_PUBLIC_KEY",
  "IPAY_PRIVATE_KEY",
  "IPAY_SECRET_HASH",
  "LICENSE_HASH_SECRET",
  "LICENSE_DEFAULT_ADMIN_PASSWORD",
  "VPN_HUB_MASTER_TOKEN",
  "WIREGUARD_PRIVATE_KEY"
];

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const tauriConfig = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const cargoManifest = await readFile("src-tauri/Cargo.toml", "utf8");
const productionEnv = await readFile(".env.production", "utf8");

const failures = [];
const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const productionApiUrl = productionEnv.match(/^VITE_LICENSE_API_URL=(.+)$/m)?.[1]?.trim();

if (packageJson.version !== tauriConfig.version || packageJson.version !== cargoVersion) {
  failures.push(
    `Versions désynchronisées (package=${packageJson.version}, tauri=${tauriConfig.version}, cargo=${cargoVersion ?? "absente"}).`
  );
}

if (productionApiUrl !== expectedApiUrl) {
  failures.push(`VITE_LICENSE_API_URL doit valoir exactement ${expectedApiUrl}.`);
}

for (const key of forbiddenFrontendKeys) {
  if (new RegExp(`^${key}=`, "m").test(productionEnv)) {
    failures.push(`Le secret serveur ${key} ne doit jamais être injecté dans le frontend.`);
  }
}

if (tauriConfig.bundle?.publisher !== "Akicorp Solutions") {
  failures.push("Le publisher Windows doit être Akicorp Solutions.");
}

if (!Array.isArray(tauriConfig.bundle?.icon) || !tauriConfig.bundle.icon.includes("icons/icon.ico")) {
  failures.push("L'icône Windows .ico n'est pas déclarée dans le bundle Tauri.");
}

for (const icon of requiredIcons) {
  try {
    await access(icon);
  } catch {
    failures.push(`Icône requise introuvable : ${icon}.`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Préflight Windows refusé :\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}

process.stdout.write(
  [
    "Préflight Windows réussi.",
    `Version : ${packageJson.version}`,
    `API : ${productionApiUrl}`,
    "Éditeur : Akicorp Solutions",
    "Secrets frontend : aucun secret serveur détecté"
  ].join("\n") + "\n"
);
