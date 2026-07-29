import { describe, expect, it } from "vitest";
import {
  protectTicketPassword,
  resolveTicketPasswordValue
} from "./TicketPasswordService";

describe("TicketPasswordService", () => {
  it("résout le mode identifiant égal au mot de passe sans stockage en clair", async () => {
    await expect(resolveTicketPasswordValue({
      passwordSecretRef: "secret://router-1/123456/password",
      username: "123456"
    })).resolves.toBe("123456");
  });

  it("protège puis résout un mot de passe distinct", async () => {
    const protectedPassword = await protectTicketPassword("847295");

    expect(protectedPassword).not.toContain("847295");
    await expect(resolveTicketPasswordValue({
      passwordSecretRef: protectedPassword,
      username: "123456"
    })).resolves.toBe("847295");
  });
});
