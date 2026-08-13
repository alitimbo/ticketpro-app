import { access, readFile } from "node:fs/promises";
import path from "node:path";

const expectedApiUrl = "https://api.ticketpro-ne.com";
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
const rustMain = await readFile("src-tauri/src/main.rs", "utf8");
const databaseModule = await readFile("src-tauri/src/database.rs", "utf8");
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

if (!rustMain.includes('windows_subsystem = "windows"')) {
  failures.push("Le binaire Windows de production doit être compilé sans console.");
}

if (!databaseModule.includes('"disable_legacy_demo_account"')) {
  failures.push("La migration de neutralisation du compte de démonstration doit être embarquée.");
}

for (const key of forbiddenFrontendKeys) {
  if (new RegExp(`^${key}=`, "m").test(productionEnv)) {
    failures.push(`Le secret serveur ${key} ne doit jamais être injecté dans le frontend.`);
  }
}

if (tauriConfig.bundle?.publisher !== "Akicorp Solutions") {
  failures.push("Le publisher Windows doit être Akicorp Solutions.");
}

if (tauriConfig.bundle?.createUpdaterArtifacts !== true) {
  failures.push("bundle.createUpdaterArtifacts doit être activé pour produire le fichier .sig.");
}

const updaterPublicKey = String(tauriConfig.plugins?.updater?.pubkey ?? "");
if (
  updaterPublicKey.length < 40
  || updaterPublicKey.includes("REPLACE_WITH_TICKETPRO_UPDATER_PUBLIC_KEY")
) {
  failures.push(
    "La vraie clé publique Ed25519 de l'Updater doit remplacer la valeur temporaire."
  );
}

const signingPrivateKey = String(process.env.TAURI_SIGNING_PRIVATE_KEY ?? "").trim();
const signingPrivateKeyPath = String(
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? ""
).trim();

if (!signingPrivateKey && !signingPrivateKeyPath) {
  failures.push(
    "TAURI_SIGNING_PRIVATE_KEY ou TAURI_SIGNING_PRIVATE_KEY_PATH doit être défini hors du dépôt pour signer l'Updater."
  );
} else if (signingPrivateKeyPath) {
  try {
    await access(path.resolve(signingPrivateKeyPath));
  } catch {
    failures.push(
      `La clé privée Updater est introuvable au chemin TAURI_SIGNING_PRIVATE_KEY_PATH : ${signingPrivateKeyPath}.`
    );
  }
}

if (!String(process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "").trim()) {
  failures.push(
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD doit protéger la clé privée de l'Updater."
  );
}

const updaterEndpoints = tauriConfig.plugins?.updater?.endpoints;
if (
  !Array.isArray(updaterEndpoints)
  || !updaterEndpoints.some((endpoint) => String(endpoint).startsWith(`${expectedApiUrl}/v1/app-updates/`))
) {
  failures.push("L'Updater doit utiliser l'endpoint HTTPS officiel TicketPro.");
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
