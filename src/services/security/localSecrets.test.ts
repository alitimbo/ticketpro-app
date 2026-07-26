import { describe, expect, it } from "vitest";
import { decryptLocalSecret, encryptLocalSecret, isEncryptedLocalSecret } from "./localSecrets";

describe("secrets locaux", () => {
  it("chiffre puis déchiffre un mot de passe sans le conserver en clair", async () => {
    localStorage.removeItem("hotspot:local_secret_key");

    const encrypted = await encryptLocalSecret("mot-de-passe-routeur");

    expect(isEncryptedLocalSecret(encrypted)).toBe(true);
    expect(encrypted).not.toContain("mot-de-passe-routeur");
    await expect(decryptLocalSecret(encrypted)).resolves.toBe("mot-de-passe-routeur");
  });
});
