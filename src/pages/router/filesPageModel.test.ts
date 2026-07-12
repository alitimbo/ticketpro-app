import { describe, expect, it } from "vitest";
import { createSession } from "../../services/auth";
import {
  createDemoArchivedFiles,
  emptyFileFilters,
  fileStatusLabel,
  filterArchivedFiles,
  scopeFilesForSession
} from "./filesPageModel";

const agentSession = createSession("agent", "doumacorporation@gmail.com", Date.now());

describe("filesPageModel", () => {
  it("filtre les archives par type, plan et profil", () => {
    const files = createDemoArchivedFiles();
    const filtered = filterArchivedFiles(files, {
      ...emptyFileFilters,
      fileType: "tickets_pdf",
      operatorProfile: "agent",
      planId: "plan-jour"
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({
      fileName: "tickets-jour-20.pdf",
      status: "missing",
      ticketQuantity: 20
    });
  });

  it("conserve les fichiers introuvables dans l'historique", () => {
    const files = createDemoArchivedFiles();
    const missing = files.find((file) => file.status === "missing");

    expect(missing).toBeDefined();
    expect(fileStatusLabel("missing")).toBe("Fichier introuvable");
  });

  it("limite les fichiers Agent a ses lots", () => {
    const scoped = scopeFilesForSession(createDemoArchivedFiles(), agentSession);

    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({
      createdByProfileId: "account-douma-demo:internal-profile-agent",
      fileName: "tickets-jour-20.pdf"
    });
  });
});
