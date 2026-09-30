import { describe, expect, it } from "vitest";
import { dataLimitMbToBytes, voucherQuotaMatches } from "./VoucherQuota";

describe("voucher quotas", () => {
  it("converts volumes without a signed 32-bit overflow", () => {
    expect(dataLimitMbToBytes(10)).toBe(10_485_760);
    expect(dataLimitMbToBytes(2048)).toBe(2_147_483_648);
    expect(dataLimitMbToBytes(5120)).toBe(5_368_709_120);
    expect(dataLimitMbToBytes(null)).toBeNull();
  });
  it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects an invalid volume %s", value => {
    expect(() => dataLimitMbToBytes(value)).toThrow();
  });
  it("rejects absent, lower and higher RouterOS quotas for a limited ticket", () => {
    for (const value of [null, undefined, 0, 10, 3_000_000_000]) {
      expect(voucherQuotaMatches({ limitBytesTotal: value }, 2_147_483_648)).toBe(false);
    }
    expect(voucherQuotaMatches({ limitBytesTotal: 2_147_483_648 }, 2_147_483_648)).toBe(true);
    expect(voucherQuotaMatches({ limitBytesTotal: 0 }, null)).toBe(true);
    expect(voucherQuotaMatches({ limitBytesTotal: 10 }, null)).toBe(false);
  });
});
