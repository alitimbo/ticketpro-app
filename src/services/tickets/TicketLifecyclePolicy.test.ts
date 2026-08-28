import { describe, expect, it } from "vitest";
import {
  canApplyPlanChangeToVoucher,
  isTerminalVoucherStatus,
  resolveObservedTicketStatus,
  resolveSharedTicketStatus
} from "./TicketLifecyclePolicy";

describe("TicketLifecyclePolicy", () => {
  it("interdit toute régression d'un voucher utilisé ou terminal", () => {
    expect(resolveObservedTicketStatus("activé", "disponible")).toEqual({
      regression: true,
      status: "activé"
    });
    expect(resolveObservedTicketStatus("consommé", "disponible")).toEqual({
      regression: true,
      status: "consommé"
    });
    expect(resolveObservedTicketStatus("expiré", "activé")).toEqual({
      regression: true,
      status: "expiré"
    });
    expect(resolveObservedTicketStatus("activé", "consommé")).toEqual({
      regression: false,
      status: "consommé"
    });
  });

  it("conserve l'impression tant qu'aucune activation n'est observée", () => {
    expect(resolveObservedTicketStatus("imprimé", "disponible")).toEqual({
      regression: false,
      status: "imprimé"
    });
  });

  it("autorise la modification du plan uniquement avant émission et utilisation", () => {
    const pristine = {
      activated_at: null,
      completed_at: null,
      downloaded_bytes: 0,
      expires_at: null,
      exported_at: null,
      printed_count: 0,
      status: "disponible",
      uploaded_bytes: 0,
      uptime_seconds: 0
    };
    expect(canApplyPlanChangeToVoucher(pristine)).toBe(true);
    expect(canApplyPlanChangeToVoucher({ ...pristine, printed_count: 1 })).toBe(false);
    expect(canApplyPlanChangeToVoucher({ ...pristine, activated_at: "2026-08-27T10:00:00.000Z" })).toBe(false);
    expect(canApplyPlanChangeToVoucher({ ...pristine, status: "consommé" })).toBe(false);
    expect(isTerminalVoucherStatus("consommé")).toBe(true);
    expect(isTerminalVoucherStatus("expiré")).toBe(true);
    expect(isTerminalVoucherStatus("activé")).toBe(false);
  });

  it("accepte une desactivation explicite partagee mais jamais une remise a zero", () => {
    expect(resolveSharedTicketStatus("activÃ©", "dÃ©sactivÃ©")).toEqual({
      regression: false,
      status: "dÃ©sactivÃ©"
    });
    expect(resolveSharedTicketStatus("consommÃ©", "disponible")).toEqual({
      regression: true,
      status: "consommÃ©"
    });
  });
});
