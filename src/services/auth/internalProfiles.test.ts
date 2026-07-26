import { afterEach, describe, expect, it } from "vitest";
import {
  appendInternalProfileLog,
  internalProfileLogsStorageKey,
  internalProfilesStorageKey,
  loadInternalProfiles,
  recordInternalProfileUsed,
  saveInternalProfiles,
  setInternalProfileEnabled,
  updateInternalProfileDisplayName
} from "./internalProfiles";

describe("internal profiles", () => {
  afterEach(() => {
    localStorage.removeItem(internalProfilesStorageKey);
    localStorage.removeItem(internalProfileLogsStorageKey);
  });

  it("empêche de désactiver le dernier Admin actif", () => {
    const profiles = loadInternalProfiles();
    const result = setInternalProfileEnabled(profiles, "admin", false);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Impossible de désactiver le dernier profil Admin actif.");
  });

  it("met à jour le nom affiché et la dernière utilisation", () => {
    const renamed = updateInternalProfileDisplayName(loadInternalProfiles(), "operator", "Caisse principale");
    saveInternalProfiles(renamed);

    recordInternalProfileUsed("operator", "2026-07-09T10:00:00.000Z");

    expect(loadInternalProfiles().find((profile) => profile.role === "operator")).toMatchObject({
      displayName: "Caisse principale",
      lastUsedAt: "2026-07-09T10:00:00.000Z"
    });
  });

  it("crée un log sans secret", () => {
    const log = appendInternalProfileLog({
      accountId: "account-douma-demo",
      action: "profile_password_updated",
      internalProfileId: "account-douma-demo:internal-profile-admin",
      role: "agent",
      userMessage: "Mot de passe du profil mis à jour."
    });

    expect(log.userMessage).toBe("Mot de passe du profil mis à jour.");
    expect(JSON.stringify(log)).not.toContain("password:");
  });

  it("isole la configuration des profils par compte principal", () => {
    const accountAProfiles = updateInternalProfileDisplayName(loadInternalProfiles("account-a"), "agent", "Agent A");
    saveInternalProfiles(accountAProfiles, "account-a");

    expect(loadInternalProfiles("account-a").find((profile) => profile.role === "agent")).toMatchObject({
      accountId: "account-a",
      displayName: "Agent A",
      id: "account-a:internal-profile-agent"
    });
    expect(loadInternalProfiles("account-b").find((profile) => profile.role === "agent")).toMatchObject({
      accountId: "account-b",
      displayName: "Agent",
      id: "account-b:internal-profile-agent"
    });
  });
});
