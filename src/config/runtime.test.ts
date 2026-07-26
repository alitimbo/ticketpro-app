import { describe, expect, it } from "vitest";
import { canUseDemoData, resolveRuntimeEnvironment } from "./runtime";

describe("runtime configuration", () => {
  it("identifies production explicitly", () => {
    expect(resolveRuntimeEnvironment("production")).toBe("production");
    expect(canUseDemoData("production")).toBe(false);
  });

  it("keeps development and test environments distinct", () => {
    expect(resolveRuntimeEnvironment("development")).toBe("development");
    expect(resolveRuntimeEnvironment("test")).toBe("test");
    expect(resolveRuntimeEnvironment("development", true)).toBe("test");
    expect(canUseDemoData("development")).toBe(true);
    expect(canUseDemoData("test")).toBe(true);
  });

  it("defaults unknown modes to development", () => {
    expect(resolveRuntimeEnvironment(undefined)).toBe("development");
    expect(resolveRuntimeEnvironment("staging")).toBe("development");
  });
});
