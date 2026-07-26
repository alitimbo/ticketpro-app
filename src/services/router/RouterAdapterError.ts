import type { RouterErrorCode } from "../../domain/router";

export class RouterAdapterError extends Error {
  constructor(
    public readonly code: RouterErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RouterAdapterError";
  }
}

export function isRouterAdapterError(error: unknown): error is RouterAdapterError {
  return error instanceof RouterAdapterError;
}
