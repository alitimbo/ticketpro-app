import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionNotificationEvent } from "./subscription-notification-policy.mjs";

const day = 86_400_000;
const end = Date.parse("2026-08-10T00:00:00.000Z");

test("l'essai envoie uniquement les relances J-3, J-1 et J+2", () => {
  assert.equal(trialEvent(end - 4 * day), null);
  assert.equal(trialEvent(end - 2.5 * day)?.eventKey, "trial-ending-3d");
  assert.equal(trialEvent(end - 0.5 * day)?.eventKey, "trial-ending-1d");
  assert.equal(trialEvent(end + day), null);
  assert.equal(trialEvent(end + 2 * day)?.eventKey, "trial-ended-2d");
  assert.equal(trialEvent(end + 4 * day, true), null);
});

test("l'abonnement payé produit une relance quotidienne pendant exactement sept jours", () => {
  assert.equal(paidEvent(end - 1), null);
  assert.deepEqual(paidEvent(end), {
    eventKey: "paid-grace-day-1",
    kind: "paid_grace",
    remainingDays: 7
  });
  assert.deepEqual(paidEvent(end + 6.5 * day), {
    eventKey: "paid-grace-day-7",
    kind: "paid_grace",
    remainingDays: 1
  });
  assert.equal(paidEvent(end + 7 * day), null);
});

function trialEvent(nowMs, hasPaidSubscription = false) {
  return policyEvent({
    hasPaidSubscription,
    nowMs,
    planCode: "TRIAL-7D",
    planId: "ticketpro-trial-7-days"
  });
}

function paidEvent(nowMs) {
  return policyEvent({
    hasPaidSubscription: true,
    nowMs,
    planCode: "PRO-5",
    planId: "plan-pro-5"
  });
}

function policyEvent({ hasPaidSubscription, nowMs, planCode, planId }) {
  return subscriptionNotificationEvent({
    graceDays: 7,
    hasPaidSubscription,
    nowMs,
    subscription: {
      current_period_end: new Date(end).toISOString(),
      plan_code: planCode,
      plan_id: planId
    },
    trialPlanCode: "TRIAL-7D",
    trialPlanId: "ticketpro-trial-7-days"
  });
}
