import { describe, expect, it } from "vitest";
import { buildPlanQuotaEnforcementLine, readPlanQuotaMetadata, writePlanQuotaMetadata } from "./PlanQuotaMetadata";
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

  it("fait appliquer par RouterOS le quota du plan aux vouchers qui ne l'ont pas, à la connexion", () => {
    const source = writePlanQuotaMetadata(mergeVoucherLifecycleOnLogin(""), 8192);
    const line = buildPlanQuotaEnforcementLine(8 * 1024 ** 3);
    expect(source).toContain(line);
    // Before the lifecycle handler, whose early returns must not skip it.
    expect(source.indexOf(line)).toBeLessThan(source.indexOf("TICKETPRO-LIFECYCLE-BEGIN"));
    expect(line).toContain("limit-bytes-total=8589934592");
    // Only a voucher without its own limit is changed, then reconnected under it.
    expect(line).toContain('($tpPlanQuotaNow = 0)');
    expect(line).toContain("/ip hotspot active remove [find where user=$user]");
    // Balanced RouterOS blocks on a single line.
    expect(line.split("{").length).toBe(line.split("}").length);
    expect(line).not.toMatch(/[\r\n]/);
  });

  it("n'ajoute aucune limite à un plan illimité et ne duplique jamais la ligne", () => {
    const unlimited = writePlanQuotaMetadata(mergeVoucherLifecycleOnLogin(""), null);
    expect(unlimited).not.toContain("tpPlanQuotaId");
    const limited = writePlanQuotaMetadata(unlimited, 2048);
    const rewritten = writePlanQuotaMetadata(limited, 4096);
    expect(rewritten.match(/tpPlanQuotaId \[/g)).toHaveLength(1);
    expect(rewritten).toContain("limit-bytes-total=4294967296");
    expect(writePlanQuotaMetadata(rewritten, null)).not.toContain("tpPlanQuotaId");
  });
});
