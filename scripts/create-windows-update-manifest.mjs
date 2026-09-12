import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function readArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Utilisation : --installer <setup.exe> --signature <setup.exe.sig> --url <https://...> [--notes <texte>] [--output <stable.json>]"
      );
    }
    result[key.slice(2)] = value;
  }
  return result;
}

const args = readArguments(process.argv.slice(2));
for (const required of ["installer", "signature", "url"]) {
  if (!args[required]) throw new Error(`Argument --${required} requis.`);
}
if (!String(args.url).startsWith("https://")) {
  throw new Error("L'URL de téléchargement doit obligatoirement utiliser HTTPS.");
}

await access(args.installer);
const signature = (await readFile(args.signature, "utf8")).trim();
if (signature.length < 40) throw new Error("Le fichier .sig ne contient pas une signature valide.");

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const installerName = path.basename(args.installer);
if (!installerName.includes(packageJson.version)) {
  throw new Error(
    `Le nom de l'installateur doit contenir la version ${packageJson.version}.`
  );
}

const outputPath = path.resolve(args.output ?? "output/app-updates/stable.json");
const enforcement = args.enforcement ?? "recommended";
if (!["recommended", "required"].includes(enforcement)) {
  throw new Error("--enforcement doit être recommended ou required.");
}
if (args["minimum-supported-version"] && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(args["minimum-supported-version"])) {
  throw new Error("--minimum-supported-version doit respecter le format x.y.z.");
}

const manifest = {
  version: packageJson.version,
  enforcement,
  ...(args["minimum-supported-version"]
    ? { minimum_supported_version: args["minimum-supported-version"] }
    : {}),
  notes: args.notes ?? `Mise à jour TicketPro ${packageJson.version}.`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      url: args.url,
      signature
    }
  }
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600
});
process.stdout.write(`Manifeste Updater créé : ${outputPath}\n`);
