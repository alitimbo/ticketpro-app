// Organization overrides are independent of billing snapshots and survive renewal.
export function resolveOrganizationDeviceLimit(policy, subscription) {
  const mode = policy?.mode ?? "inherit";
  if (mode === "unlimited") return { mode: "unlimited", maxDevices: null, source: "organization" };
  if (mode === "limited") return { mode: "limited", maxDevices: Number(policy.max_devices), source: "organization" };
  const unlimited = subscription?.device_limit_mode === "unlimited";
  return {
    mode: unlimited ? "unlimited" : "limited",
    maxDevices: unlimited ? null : subscription ? Number(subscription.max_devices ?? 1) : 0,
    source: "plan"
  };
}

export function organizationHubOperatorLimit(effectiveLimit, ownerCount, collaboratorCount) {
  // SQL admission enforces the commercial quota. Preserve existing devices after
  // a downgrade; hub technical limits must not arbitrarily disconnect them.
  return effectiveLimit === null ? null : Math.max(effectiveLimit, ownerCount) + collaboratorCount;
}
