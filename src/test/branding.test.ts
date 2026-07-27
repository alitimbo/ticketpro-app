import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("identité TicketPro", () => {
  it("configure le package, Tauri et Cargo avec la même identité", () => {
    const packageJson = JSON.parse(read("package.json")) as { name: string; version: string };
    const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
      bundle: { publisher: string; targets: string[] };
      identifier: string;
      mainBinaryName: string;
      productName: string;
      version: string;
    };
    const cargoToml = read("src-tauri/Cargo.toml");

    expect(packageJson.name).toBe("ticketpro");
    expect(tauriConfig).toMatchObject({
      identifier: "solutions.akicorp.ticketpro",
      mainBinaryName: "TicketPro",
      productName: "TicketPro"
    });
    expect(tauriConfig.version).toBe(packageJson.version);
    expect(tauriConfig.bundle).toMatchObject({ publisher: "Akicorp Solutions", targets: ["nsis"] });
    expect(cargoToml).toContain('name = "ticketpro"');
    expect(cargoToml).toContain(`version = "${packageJson.version}"`);
    expect(cargoToml).toContain('authors = ["Akicorp Solutions"]');
  });

  it("préserve la base historique lors du changement d'identifiant Tauri", () => {
    const databaseSource = read("src-tauri/src/database.rs");

    expect(databaseSource).toContain('const LEGACY_IDENTIFIER: &str = "com.local.hotspotmanager"');
    expect(databaseSource).toContain('const DATABASE_FILE_NAME: &str = "hotspot-manager.sqlite"');
    expect(databaseSource).toContain("migrate_legacy_storage(app)?");
    expect(databaseSource).toContain('["", "-wal", "-shm"]');
  });

  it("ignore les données utilisateur, secrets et installateurs", () => {
    const gitignore = read(".gitignore");

    for (const pattern of [
      "node_modules/",
      "dist/",
      "src-tauri/target/",
      "*.sqlite",
      "*.log",
      "*.pdf",
      "exports/",
      "backups/",
      ".env.*",
      "*.key",
      "TicketPro-Setup-*.exe"
    ]) {
      expect(gitignore).toContain(pattern);
    }
  });
});
