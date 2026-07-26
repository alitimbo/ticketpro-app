import { invoke } from "@tauri-apps/api/core";

export type DatabaseBackup = {
  absolute_path: string;
  file_name: string;
  size_bytes: number;
};

export class DatabaseBackupService {
  async list(): Promise<DatabaseBackup[]> {
    return invoke<DatabaseBackup[]>("db_list_backups");
  }

  async backup(fileName: string): Promise<DatabaseBackup> {
    return invoke<DatabaseBackup>("db_backup", { fileName });
  }

  async restore(fileName: string): Promise<void> {
    await invoke("db_restore", { fileName });
  }
}
