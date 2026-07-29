import { describe, expect, it } from "vitest";
import packageMetadata from "../../../package.json";
import { getAppMetadata } from "./appMetadata";

describe("getAppMetadata", () => {
  it("utilise automatiquement la version du paquet pendant le développement web", async () => {
    await expect(getAppMetadata()).resolves.toEqual({
      identifier: "solutions.akicorp.ticketpro",
      name: "TicketPro",
      version: packageMetadata.version
    });
  });
});
