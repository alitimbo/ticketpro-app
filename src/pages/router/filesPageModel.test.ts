import { describe, expect, it } from "vitest";
import { createSession } from "../../services/auth";
import {
  archivedFileFromRecord,
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

  it("transforme un fichier SQLite en archive avec son état disque", () => {
    const file = archivedFileFromRecord(
      {
        account_id: "account-a",
        batch_id: "batch-a",
        created_at: "2026-07-13T12:00:00.000Z",
        created_by_profile: "operator",
        created_by_profile_id: "account-a:internal-profile-operator",
        deleted_at: null,
        file_name: "tickets-batch-a.pdf",
        file_path: "files/tickets-batch-a.pdf",
        format: "pdf",
        id: "file-a",
        router_id: "router-a",
        sync_status: "local",
        type: "tickets_pdf",
        updated_at: "2026-07-13T12:00:00.000Z"
      },
      { fileExists: false, planId: "plan-a", planName: "1h", routerName: "Routeur A", ticketQuantity: 10 }
    );

    expect(file).toMatchObject({ fileName: "tickets-batch-a.pdf", status: "missing", ticketQuantity: 10 });
  });
});
