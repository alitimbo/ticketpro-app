import { describe, expect, it } from "vitest";
import {
  parseTechnicalMessage,
  redactTechnicalMessage,
  serializeTechnicalMessage
} from "./technicalMessage";

describe("technicalMessage", () => {
  it("conserve l'action et le code sans conserver les secrets", () => {
    const stored = serializeTechnicalMessage({
      action: "testConnection",
      code: "authentication_failed",
      detail: "password=router-secret Authorization=BearerToken private-key=abc"
    });
    const parsed = parseTechnicalMessage(stored);

    expect(parsed).toMatchObject({
      action: "testConnection",
      code: "authentication_failed"
    });
    expect(parsed.detail).toContain("password=[MASQUÉ]");
    expect(parsed.detail).toContain("Authorization=[MASQUÉ]");
    expect(parsed.detail).toContain("private-key=[MASQUÉ]");
    expect(stored).not.toContain("router-secret");
    expect(stored).not.toContain("BearerToken");
  });

  it("comprend les anciens formats de journaux", () => {
    expect(parseTechnicalMessage("getRouterHealth")).toEqual({
      action: "getRouterHealth",
      code: null,
      detail: null
    });
    expect(parseTechnicalMessage("timeout: connection refused")).toEqual({
      action: null,
      code: "timeout",
      detail: "connection refused"
    });
    expect(parseTechnicalMessage("file=tickets.csv password=secret")).toEqual({
      action: null,
      code: null,
      detail: "file=tickets.csv password=[MASQUÉ]"
    });
  });

  it("masque aussi les identifiants inclus dans une URL", () => {
    expect(redactTechnicalMessage("https://admin:secret@example.test")).toBe(
      "https://admin:[MASQUÉ]@example.test"
    );
  });
});
