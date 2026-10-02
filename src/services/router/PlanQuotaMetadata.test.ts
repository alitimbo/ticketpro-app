import { describe, expect, it } from "vitest";
import { readPlanQuotaMetadata, writePlanQuotaMetadata } from "./PlanQuotaMetadata";
import { mergeVoucherLifecycleOnLogin } from "./MikroTikRouterAdapter";

describe("RouterOS plan quota metadata", () => {
  it("round-trips Mo, Go and explicit unlimited, preserving custom login scripts", () => {
    for (const quota of [10, 2048, 5120, null]) {
      const source = writePlanQuotaMetadata(mergeVoucherLifecycleOnLogin(':log info "custom";'), quota);
      expect(readPlanQuotaMetadata(source)).toEqual({ dataLimitMb: quota });
      expect(source).toContain(':log info "custom";');
      expect(source).toContain("TICKETPRO-LIFECYCLE-BEGIN");
      const repaired = mergeVoucherLifecycleOnLogin(source);
      expect(readPlanQuotaMetadata(repaired)).toEqual({ dataLimitMb: quota });
      expect(writePlanQuotaMetadata(source, quota)).toBe(source);
    }
  });
  it("distinguishes unknown metadata from an explicitly unlimited plan", () => {
    expect(readPlanQuotaMetadata(':log info "custom";')).toBeNull();
    expect(readPlanQuotaMetadata(writePlanQuotaMetadata("", null))).toEqual({ dataLimitMb: null });
  });
  it("stores TicketPro duration and validity independently from native profile settings", () => {
    const source = writePlanQuotaMetadata("", {
      dataLimitMb: 2048,
      durationMinutes: 60,
      validityMinutes: 180
    });

    expect(readPlanQuotaMetadata(source)).toEqual({
      dataLimitMb: 2048,
      durationMinutes: 60,
      validityMinutes: 180
    });
  });
  it.each(['{"dataLimitMb":-1}', '{"dataLimitMb":0}', '{"dataLimitMb":"2048"}', '{broken}', '{}'])(
    "refuses invalid quota metadata instead of granting unlimited access: %s", payload => {
      expect(() => readPlanQuotaMetadata(`# TICKETPRO-PLAN-QUOTA v1 ${payload}`)).toThrow();
    }
  );
});
