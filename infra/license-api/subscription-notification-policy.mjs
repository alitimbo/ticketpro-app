export function subscriptionNotificationEvent({
  graceDays,
  hasPaidSubscription,
  nowMs,
  subscription,
  trialPlanCode,
  trialPlanId
}) {
  const dayMs = 86_400_000;
  const periodEndMs = Date.parse(subscription.current_period_end);
  if (!Number.isFinite(periodEndMs)) return null;
  const isTrial = subscription.plan_id === trialPlanId
    || subscription.plan_code === trialPlanCode;

  if (isTrial) {
    if (nowMs >= periodEndMs + 2 * dayMs) {
      if (hasPaidSubscription) return null;
      return {
        eventKey: "trial-ended-2d",
        kind: "trial_ended",
        remainingDays: 0
      };
    }
    if (nowMs >= periodEndMs) return null;
    if (nowMs >= periodEndMs - dayMs) {
      return {
        eventKey: "trial-ending-1d",
        kind: "trial_ending",
        remainingDays: 1
      };
    }
    if (nowMs >= periodEndMs - 3 * dayMs) {
      return {
        eventKey: "trial-ending-3d",
        kind: "trial_ending",
        remainingDays: 3
      };
    }
    return null;
  }

  const graceEndsMs = periodEndMs + graceDays * dayMs;
  if (nowMs < periodEndMs || nowMs >= graceEndsMs) return null;
  const elapsedGraceDays = Math.floor((nowMs - periodEndMs) / dayMs);
  return {
    eventKey: `paid-grace-day-${elapsedGraceDays + 1}`,
    kind: "paid_grace",
    remainingDays: graceDays - elapsedGraceDays
  };
}
