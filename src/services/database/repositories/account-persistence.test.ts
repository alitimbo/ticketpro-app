import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "../InMemoryDatabaseClient";
import { AccountRepository } from "./AccountRepository";

describe("persistance du compte principal", () => {
  it("lit et met à jour les informations et le mot de passe du compte", async () => {
    const database = new InMemoryDatabaseClient();
    const accounts = new AccountRepository(database);

    await database.initialize();
    await database.execute(
      `INSERT INTO accounts (id, email, password_hash, display_name, company_name, phone, status, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ["account-test", "test@example.com", "hash-old", "Test", "Entreprise", "70000000", "active", null]
    );

    await accounts.updateDetails({
      companyName: "Nouvelle entreprise",
      displayName: "Compte test",
      email: "test@example.com",
      id: "account-test",
      phone: "71000000"
    });
    await accounts.updatePassword("account-test", "hash-new");

    await expect(accounts.findById("account-test")).resolves.toMatchObject({
      company_name: "Nouvelle entreprise",
      display_name: "Compte test",
      password_hash: "hash-new",
      phone: "71000000"
    });
  });
});
