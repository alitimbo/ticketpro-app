import { invoke } from "@tauri-apps/api/core";

export type ManagedFileResult = {
  absolute_path: string;
  bytes_written: number;
  relative_path: string;
};

export type ManagedFileMetadata = {
  absolute_path: string;
  exists: boolean;
  relative_path: string;
  size_bytes: number;
};

export type SystemPrinter = {
  id: string;
  is_default: boolean;
  name: string;
  status: string;
};

export class TauriFileService {
  async writeBytes(relativePath: string, bytes: Uint8Array): Promise<ManagedFileResult> {
    return invoke<ManagedFileResult>("file_write_bytes", {
      bytes: Array.from(bytes),
      relativePath
    });
  }

  async metadata(relativePath: string): Promise<ManagedFileMetadata> {
    return invoke<ManagedFileMetadata>("file_metadata", { relativePath });
  }

  async open(relativePath: string): Promise<void> {
    await invoke("file_open", { relativePath });
  }

  async reveal(relativePath: string): Promise<void> {
    await invoke("file_reveal", { relativePath });
  }

  async listPrinters(): Promise<SystemPrinter[]> {
    return invoke<SystemPrinter[]>("print_list_printers");
  }

  async printFile(relativePath: string, printerName: string): Promise<void> {
    await invoke("print_file", { printerName, relativePath });
  }
}
