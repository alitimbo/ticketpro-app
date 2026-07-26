export type RuntimeEnvironment = "development" | "production" | "test";

/**
 * Resolves the application environment in one place so production code can
 * explicitly reject fixtures and development-only capabilities.
 */
export function resolveRuntimeEnvironment(mode: string | undefined, isTest = false): RuntimeEnvironment {
  if (isTest || mode === "test") {
    return "test";
  }

  return mode === "production" ? "production" : "development";
}

export function canUseDemoData(environment: RuntimeEnvironment): boolean {
  return environment !== "production";
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const runtimeEnvironment = resolveRuntimeEnvironment(import.meta.env.MODE, import.meta.env.MODE === "test");
export const isProductionRuntime = runtimeEnvironment === "production";
