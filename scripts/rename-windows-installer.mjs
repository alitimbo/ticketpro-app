import { createHash } from "node:crypto";
import { copyFile, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
const installerName = `TicketPro-Setup-${version}-x64.exe`;
const tauriInstallerName = `TicketPro_${version}_x64-setup.exe`;
const candidateDirectories = [
  join("src-tauri", "target", "x86_64-pc-windows-msvc", "release", "bundle", "nsis"),
  join("src-tauri", "target", "release", "bundle", "nsis")
];

for (const directory of candidateDirectories) {
  try {
    const files = await readdir(directory);
    const generatedInstaller = files.includes(tauriInstallerName)
      ? tauriInstallerName
      : files.find((file) => file !== installerName && file.toLowerCase().endsWith("-setup.exe"))
        ?? (files.includes(installerName) ? installerName : undefined);

    if (generatedInstaller) {
      const installerPath = join(directory, installerName);
      const generatedInstallerPath = join(directory, generatedInstaller);
      const generatedSignaturePath = `${generatedInstallerPath}.sig`;
      const signaturePath = `${installerPath}.sig`;
      if (generatedInstaller !== installerName) {
        await copyFile(generatedInstallerPath, installerPath);
        await copyFile(generatedSignaturePath, signaturePath);
        await unlink(generatedInstallerPath);
        await unlink(generatedSignaturePath);
      } else {
        await readFile(signaturePath, "utf8");
      }
      const checksum = createHash("sha256").update(await readFile(installerPath)).digest("hex");
      const checksumPath = `${installerPath}.sha256`;
      await writeFile(checksumPath, `${checksum}  ${installerName}\n`, "utf8");
      process.stdout.write(`Installateur généré : ${installerPath}\n`);
      process.stdout.write(`SHA-256 : ${checksum}\n`);
      process.stdout.write(`Checksum : ${checksumPath}\n`);
      process.stdout.write(`Signature Updater : ${signaturePath}\n`);
      process.exit(0);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

throw new Error("Installateur NSIS généré introuvable.");
