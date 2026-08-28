import { describe, expect, it } from "vitest";
import {
  buildVoucherBatchOwnershipComment,
  extractVoucherBatchOwnershipSuffix,
  voucherBelongsToBatch
} from "./VoucherOwnership";

describe("propriété d'un voucher par son lot", () => {
  it("normalise et retrouve le lot sans exposer de secret", () => {
    expect(buildVoucherBatchOwnershipComment(" batch:42/demo ")).toBe("TicketProBatch:batch-42-demo");
    expect(extractVoucherBatchOwnershipSuffix("TicketProBatch:batch-42-demo")).toBe("batch=batch-42-demo;");
    expect(voucherBelongsToBatch(
      "TicketPro:v1;validity=180;expires=0;state=new;batch=batch-42-demo;",
      "batch:42/demo"
    )).toBe(true);
  });

  it("refuse qu'un lot adopte le voucher d'un autre opérateur", () => {
    expect(voucherBelongsToBatch(
      "TicketPro:v1;validity=180;expires=0;state=new;batch=batch-a;",
      "batch-b"
    )).toBe(false);
  });
});
