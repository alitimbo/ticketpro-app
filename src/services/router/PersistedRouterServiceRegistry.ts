import type { RouterService } from "./RouterService";

const services = new Map<string, RouterService>();

export function registerPersistedRouterService(routerId: string, service: RouterService): void {
  services.set(routerId, service);
}

export function getPersistedRouterService(routerId: string): RouterService | null {
  return services.get(routerId) ?? null;
}

export function unregisterPersistedRouterService(routerId: string, service?: RouterService): void {
  if (!service || services.get(routerId) === service) {
    services.delete(routerId);
  }
}
