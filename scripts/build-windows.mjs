import { spawn } from "node:child_process";
import process from "node:process";

if (process.platform !== "win32") {
  throw new Error("Le build Windows natif doit être exécuté depuis Windows.");
}

const child = spawn(
  process.execPath,
  ["node_modules/@tauri-apps/cli/tauri.js", "build", "--bundles", "nsis"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_BUILD_JOBS: "1",
      CARGO_INCREMENTAL: "0"
    }
  }
);

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Build Tauri interrompu par le signal ${signal}.\n`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
