import type { SaasAuthResult, SaasSubscription } from "../saas";

type RefreshOptions = {
  organizationId: string;
  membershipId: string;
  fetchAccount: (signal: AbortSignal) => Promise<SaasAuthResult>;
  onSubscription: (subscription: SaasSubscription) => void;
  initialSubscription?: SaasSubscription;
  intervalMs?: number;
};

/** Refresh only commercial state: never replace the currently selected local profile. */
export function startSaasSubscriptionRefresh(options: RefreshOptions) {
  let disposed = false;
  let inFlight = false;
  let controller: AbortController | undefined;
  let lastObserved = JSON.stringify(options.initialSubscription);
  async function refresh() {
    if (disposed || inFlight) return;
    inFlight = true;
    const activeController = new AbortController();
    controller = activeController;
    const timeout = setTimeout(() => activeController.abort(), 15_000);
    try {
      const current = await options.fetchAccount(activeController.signal);
      if (!disposed && !activeController.signal.aborted && current.organization.id === options.organizationId
        && current.user.membership_id === options.membershipId) {
        const observed = JSON.stringify(current.subscription);
        if (observed !== lastObserved) {
          lastObserved = observed;
          options.onSubscription(current.subscription);
        }
      }
    } catch {
      // Offline or transient VPS failure: retain the last observed state.
    } finally {
      clearTimeout(timeout);
      controller = undefined;
      inFlight = false;
    }
  }
  const timer = setInterval(() => void refresh(), options.intervalMs ?? 60_000);
  return {
    refresh,
    stop: () => { disposed = true; clearInterval(timer); controller?.abort(); }
  };
}
