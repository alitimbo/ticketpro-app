import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type TauriConfig = {
  app?: {
    security?: {
      csp?: string | null;
    };
  };
};

describe("Tauri production security", () => {
  it("autorise uniquement les aperçus PDF locaux dans une frame blob", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")
    ) as TauriConfig;
    const csp = config.app?.security?.csp ?? "";

    expect(csp).toContain("frame-src 'self' blob:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/frame-src[^;]*https?:/);
  });
});
