import { describe, expect, it } from "vitest";
import { InMemoryDatabaseClient } from "./InMemoryDatabaseClient";

describe("DatabaseClient transactions", () => {
  it("commits all statements together", async () => {
    const database = new InMemoryDatabaseClient();

    await database.transaction([
      {
        params: ["router-1", "account-1"],
        sql: "INSERT INTO routers (id, account_id) VALUES (?1, ?2)"
      },
      {
        params: ["router-2", "account-1"],
        sql: "INSERT INTO routers (id, account_id) VALUES (?1, ?2)"
      }
    ]);

    await expect(database.query("SELECT * FROM routers")).resolves.toHaveLength(2);
  });

  it("restores the previous state when one statement fails", async () => {
    const database = new InMemoryDatabaseClient();

    await expect(
      database.transaction([
        {
          params: ["router-1", "account-1"],
          sql: "INSERT INTO routers (id, account_id) VALUES (?1, ?2)"
        },
        {
          params: ["router-2"],
          sql: "INSERT INTO table_that_does_not_exist (id) VALUES (?1)"
        }
      ])
    ).rejects.toThrow("Table inconnue pour l'insertion.");

    await expect(database.query("SELECT * FROM routers")).resolves.toHaveLength(0);
  });
});
