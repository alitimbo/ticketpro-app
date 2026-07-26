import type { DatabaseClient } from "../DatabaseClient";

export class AppSettingsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.database.query<{ id: string; key: string; value: string }>("SELECT * FROM app_settings");
    return rows.find((row) => row.key === key)?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const rows = await this.database.query<{ id: string; key: string; value: string }>("SELECT * FROM app_settings");
    const existing = rows.find((row) => row.key === key);
    const id = existing?.id ?? `setting-${key}`;

    if (existing) {
      await this.database.execute("UPDATE app_settings SET value = ?1, updated_at = ?2 WHERE id = ?3", [
        value,
        new Date().toISOString(),
        id
      ]);
      return;
    }

    await this.database.execute("INSERT INTO app_settings (id, key, value) VALUES (?1, ?2, ?3)", [
      id,
      key,
      value
    ]);
  }
}
