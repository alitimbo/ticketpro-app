import { describe, expect, it } from "vitest";
import { assertAccountProfileOwnership } from "./ownership";

describe("account and internal profile ownership", () => {
  it("accepte un profil interne rattaché au compte actif", () => {
    expect(assertAccountProfileOwnership("account-a", "account-a:internal-profile-operator")).toEqual({
      accountId: "account-a",
      internalProfileId: "account-a:internal-profile-operator"
    });
  });

  it("refuse une écriture sans compte ou avec le profil d'un autre compte", () => {
    expect(() => assertAccountProfileOwnership("", "")).toThrow(
      "Le compte principal et le profil interne actifs sont requis."
    );
    expect(() => assertAccountProfileOwnership("account-a", "account-b:internal-profile-admin")).toThrow(
      "Le profil interne n'appartient pas au compte principal actif."
    );
  });
});
