import { copyFile, mkdir, writeFile } from "node:fs/promises";

const tenantsPath = "/data/tenants.json";
const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z");
const backupDirectory = "/data/backups";
const backupPath = `${backupDirectory}/tenants-pre-test-reset-${timestamp}.json`;

await mkdir(backupDirectory, { recursive: true });
await copyFile(tenantsPath, backupPath);
await writeFile(tenantsPath, "{}\n", { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ backupPath, tenantsReset: true }, null, 2));
