import { describe, expect, it } from "vitest";
import { accountStatusLabel, formatAccountDate, validateAccountDetails, validatePasswordChange } from "./accountPageModel";

describe("accountPageModel", () => {
  it("formate le statut et les dates du compte principal", () => {
    expect(accountStatusLabel("active")).toBe("Actif");
    expect(formatAccountDate("2026-07-10T10:00:00.000Z")).toBe("10/07/2026");
    expect(formatAccountDate(null)).toBe("Non renseignée");
  });

  it("valide les informations principales du compte", () => {
    expect(validateAccountDetails({ companyName: "", displayName: "Douma", phone: "" })).toBe("Entrez le nom de l'entreprise.");
    expect(validateAccountDetails({ companyName: "Douma", displayName: "", phone: "" })).toBe("Entrez le nom affiché.");
    expect(validateAccountDetails({ companyName: "Douma", displayName: "Douma", phone: "" })).toBe("Entrez le téléphone du propriétaire.");
    expect(validateAccountDetails({ companyName: "Douma", displayName: "Douma", phone: "+22790000000" })).toBeNull();
  });

  it("valide le changement de mot de passe principal", () => {
    expect(validatePasswordChange({ confirmPassword: "nouveau123", newPassword: "nouveau123", oldPassword: "" })).toBe(
      "Entrez l'ancien mot de passe."
    );
    expect(validatePasswordChange({ confirmPassword: "autre123", newPassword: "nouveau123", oldPassword: "test123" })).toBe(
      "Les deux nouveaux mots de passe ne correspondent pas."
    );
    expect(validatePasswordChange({ confirmPassword: "nouveau123", newPassword: "nouveau123", oldPassword: "test123" })).toBeNull();
  });
});
