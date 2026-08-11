import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

if (process.platform !== "win32") {
  throw new Error("Le build Windows natif doit être exécuté depuis Windows.");
}

const signingPrivateKeyPath = String(
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? ""
).trim();
const signingPrivateKey = String(process.env.TAURI_SIGNING_PRIVATE_KEY ?? "").trim()
  || (signingPrivateKeyPath
    ? readFileSync(signingPrivateKeyPath, "utf8").trim()
    : "");
const skipSigning = process.env.TICKETPRO_BUILD_NO_SIGN === "1";

const buildEnv = {
  ...process.env,
  ...(signingPrivateKey ? { TAURI_SIGNING_PRIVATE_KEY: signingPrivateKey } : {}),
  CARGO_BUILD_JOBS: "1",
  CARGO_INCREMENTAL: "0"
};

const bundleConfig = JSON.stringify({
  bundle: {
    resources: {
      "resources/ticketpro-vpn-service.exe": "ticketpro-vpn-service.exe",
      "resources/vpn/x86_64/*": "vpn/"
    }
  }
});

await run("cargo", [
  "build",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "-p",
  "ticketpro-vpn-service",
  "--release"
]);

const serviceSource = resolve("src-tauri/target/release/ticketpro-vpn-service.exe");
const serviceDestination = resolve("src-tauri/resources/ticketpro-vpn-service.exe");
mkdirSync(resolve("src-tauri/resources"), { recursive: true });
copyFileSync(serviceSource, serviceDestination);

await run(process.execPath, [
  "node_modules/@tauri-apps/cli/tauri.js",
  "build",
  "--bundles",
  "nsis",
  ...(skipSigning ? ["--no-sign"] : []),
  "--config",
  bundleConfig
]);

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: buildEnv
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Build Windows interrompu par le signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} a termine avec le code ${code ?? 1}.`));
        return;
      }
      resolvePromise();
    });
  });
}
