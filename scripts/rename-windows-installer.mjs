import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";

const version = "0.1.0";
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
      await rename(join(directory, generatedInstaller), join(directory, installerName));
      process.stdout.write(`Installateur généré : ${join(directory, installerName)}\n`);
      process.exit(0);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

throw new Error("Installateur NSIS généré introuvable.");
