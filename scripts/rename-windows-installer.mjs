import { createHash } from "node:crypto";
import { copyFile, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const installerName = `TicketPro-Setup-${version}-x64.exe`;
const candidateDirectories = [
  join("src-tauri", "target", "x86_64-pc-windows-msvc", "release", "bundle", "nsis"),
  join("src-tauri", "target", "release", "bundle", "nsis")
];

for (const directory of candidateDirectories) {
  try {
    const files = await readdir(directory);
    const generatedInstaller = files.find(
      (file) => file.toLowerCase().endsWith("-setup.exe") && file !== installerName
    );

    if (generatedInstaller) {
      const installerPath = join(directory, installerName);
      const generatedInstallerPath = join(directory, generatedInstaller);
      await copyFile(generatedInstallerPath, installerPath);
      await unlink(generatedInstallerPath);
      const checksum = createHash("sha256").update(await readFile(installerPath)).digest("hex");
      const checksumPath = `${installerPath}.sha256`;
      await writeFile(checksumPath, `${checksum}  ${installerName}\n`, "utf8");
      process.stdout.write(`Installateur généré : ${installerPath}\n`);
      process.stdout.write(`SHA-256 : ${checksum}\n`);
      process.stdout.write(`Checksum : ${checksumPath}\n`);
      process.exit(0);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

throw new Error("Installateur NSIS généré introuvable.");
