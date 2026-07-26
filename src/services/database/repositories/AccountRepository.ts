import type { AccountRecord } from "../../../domain/database";
import type { DatabaseClient } from "../DatabaseClient";

export class AccountRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findById(id: string): Promise<AccountRecord | null> {
    const rows = await this.database.query<AccountRecord>("SELECT * FROM accounts WHERE id = ?1", [id]);
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<AccountRecord | null> {
    const rows = await this.database.query<AccountRecord>("SELECT * FROM accounts WHERE email = ?1", [email.trim().toLowerCase()]);
    return rows[0] ?? null;
  }

  async updateDetails(input: {
    companyName: string | null;
    displayName: string | null;
    email: string;
    id: string;
    phone: string | null;
  }): Promise<void> {
    await this.database.execute(
      "UPDATE accounts SET email = ?1, display_name = ?2, company_name = ?3, phone = ?4, updated_at = ?5 WHERE id = ?6",
      [input.email, input.displayName, input.companyName, input.phone, new Date().toISOString(), input.id]
    );
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.database.execute("UPDATE accounts SET password_hash = ?1, updated_at = ?2 WHERE id = ?3", [
      passwordHash,
      new Date().toISOString(),
      id
    ]);
  }

  async recordLogin(id: string, loggedInAt = new Date().toISOString()): Promise<void> {
    await this.database.execute("UPDATE accounts SET last_login_at = ?1, updated_at = ?2 WHERE id = ?3", [
      loggedInAt,
      loggedInAt,
      id
    ]);
  }
}
