import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaasAuthResult } from "../saas";
import { startSaasSubscriptionRefresh } from "./SaasSubscriptionRefreshService";

const account = (limit: number | null = 2, organizationId = "org-a") => ({
  organization: { id: organizationId }, user: { membership_id: "member-a" },
  subscription: { max_devices: limit, device_limit_mode: limit === null ? "unlimited" : "limited", device_limit_policy_revision: 1 }
}) as SaasAuthResult;
afterEach(() => vi.useRealTimers());
describe("silent SaaS quota propagation", () => {
  it("aborts an unresponsive HTTP call and retries on the next interval", async () => {
    vi.useFakeTimers();
    const fetchAccount = vi.fn().mockImplementationOnce((signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Timeout")), { once: true });
    })).mockResolvedValue(account(5));
    const onSubscription = vi.fn();
    const watcher = startSaasSubscriptionRefresh({ organizationId: "org-a", membershipId: "member-a", fetchAccount, onSubscription });
    const pending = watcher.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(onSubscription).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(onSubscription).toHaveBeenCalledWith(account(5).subscription);
    watcher.stop();
  });
  it("refreshes at 60 seconds, supports unlimited and ignores unchanged data", async () => {
    vi.useFakeTimers();
    const onSubscription = vi.fn();
    const watcher = startSaasSubscriptionRefresh({ organizationId: "org-a", membershipId: "member-a", initialSubscription: account().subscription, fetchAccount: vi.fn().mockResolvedValue(account(null)), onSubscription });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onSubscription).toHaveBeenCalledWith(account(null).subscription);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onSubscription).toHaveBeenCalledTimes(1);
    watcher.stop();
  });
  it("retains observed state offline, then propagates on retry", async () => {
    vi.useFakeTimers();
    const fetchAccount = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(account(5));
    const onSubscription = vi.fn();
    const watcher = startSaasSubscriptionRefresh({ organizationId: "org-a", membershipId: "member-a", fetchAccount, onSubscription });
    await watcher.refresh();
    expect(onSubscription).not.toHaveBeenCalled();
    await watcher.refresh();
    expect(onSubscription).toHaveBeenCalledWith(account(5).subscription);
    watcher.stop();
  });
  it("rejects a different organization or membership", async () => {
    vi.useFakeTimers();
    const onSubscription = vi.fn();
    const fetchAccount = vi.fn().mockResolvedValueOnce(account(2, "org-b")).mockResolvedValueOnce({ ...account(), user: { membership_id: "other" } });
    const watcher = startSaasSubscriptionRefresh({ organizationId: "org-a", membershipId: "member-a", fetchAccount, onSubscription });
    await watcher.refresh(); await watcher.refresh();
    expect(onSubscription).not.toHaveBeenCalled();
    watcher.stop();
  });
  it("deduplicates requests and ignores a late reply after stopping", async () => {
    vi.useFakeTimers();
    let resolve!: (value: SaasAuthResult) => void;
    const fetchAccount = vi.fn(() => new Promise<SaasAuthResult>((done) => { resolve = done; }));
    const onSubscription = vi.fn();
    const watcher = startSaasSubscriptionRefresh({ organizationId: "org-a", membershipId: "member-a", fetchAccount, onSubscription });
    const pending = watcher.refresh(); await watcher.refresh();
    expect(fetchAccount).toHaveBeenCalledTimes(1);
    watcher.stop(); resolve(account(4)); await pending;
    expect(onSubscription).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchAccount).toHaveBeenCalledTimes(1);
  });
});
