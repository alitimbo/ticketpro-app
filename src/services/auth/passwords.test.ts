import { afterEach, describe, expect, it } from "vitest";
import {
  hasProfilePasswordConfigured,
  hashProfilePassword,
  profilePasswordHashesKey,
  saveProfilePasswordHash,
  verifyDevelopmentPassword
} from "./passwords";

describe("profile passwords", () => {
  afterEach(() => {
    localStorage.removeItem(profilePasswordHashesKey);
  });

  it("utilise le hash personnalisé quand un mot de passe profil est changé", async () => {
    const hash = await hashProfilePassword("operator", "nouveau-secret");
    saveProfilePasswordHash("operator", hash);

    await expect(verifyDevelopmentPassword("operator", "nouveau-secret")).resolves.toBe(true);
    await expect(verifyDevelopmentPassword("operator", "operateur123")).resolves.toBe(false);
  });

  it("indique qu'un profil seed dispose d'un mot de passe", () => {
    expect(hasProfilePasswordConfigured("admin")).toBe(true);
    expect(hasProfilePasswordConfigured("operator")).toBe(true);
  });

  it("isole les mots de passe de profils entre deux comptes principaux", async () => {
    const hash = await hashProfilePassword("agent", "secret-compte-a");
    saveProfilePasswordHash("agent", hash, "account-a");

    await expect(verifyDevelopmentPassword("agent", "secret-compte-a", "account-a")).resolves.toBe(true);
    await expect(verifyDevelopmentPassword("agent", "secret-compte-a", "account-b")).resolves.toBe(false);
  });
});
