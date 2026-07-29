import {
  getIdentifier,
  getName,
  getVersion
} from "@tauri-apps/api/app";
import packageMetadata from "../../../package.json";
import { isTauriRuntime } from "../../config/runtime";

export type AppMetadata = {
  identifier: string;
  name: string;
  version: string;
};

export async function getAppMetadata(): Promise<AppMetadata> {
  if (isTauriRuntime()) {
    try {
      const [identifier, name, version] = await Promise.all([
        getIdentifier(),
        getName(),
        getVersion()
      ]);
      return { identifier, name, version };
    } catch {
      // Le fallback garde la page fonctionnelle pendant le développement.
    }
  }
  return {
    identifier: "solutions.akicorp.ticketpro",
    name: "TicketPro",
    version: packageMetadata.version
  };
}
