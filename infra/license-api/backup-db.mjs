import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = process.env.LICENSE_DB ?? "/data/licenses.sqlite";
const destination = process.argv[2] ?? "/data/licenses-backup.sqlite";

if (!destination.startsWith("/data/") || destination === source) {
  throw new Error("La sauvegarde doit être un fichier distinct situé dans /data");
}

rmSync(destination, { force: true });

const sourceDb = new DatabaseSync(source);
sourceDb.exec("PRAGMA wal_checkpoint(FULL)");
const escapedDestination = destination.replaceAll("'", "''");
sourceDb.exec(`VACUUM INTO '${escapedDestination}'`);
sourceDb.close();

const backupDb = new DatabaseSync(destination, { readOnly: true });
const integrity = backupDb.prepare("PRAGMA integrity_check").get();
backupDb.close();

if (integrity.integrity_check !== "ok") {
  rmSync(destination, { force: true });
  throw new Error(`Échec du contrôle d'intégrité SQLite : ${integrity.integrity_check}`);
}

console.log(JSON.stringify({ source, destination, integrity: "ok" }));
