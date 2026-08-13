import { describe, expect, it } from "vitest";
import { formatInternationalPhone, normalizeInternationalPhone } from "./phone";

describe("normalizeInternationalPhone", () => {
  it("accepte et normalise un numéro local du Niger", () => {
    expect(normalizeInternationalPhone("88 99 99 00", { required: true })).toEqual({
      ok: true,
      value: "+22788999900"
    });
    expect(normalizeInternationalPhone("22788999900")).toEqual({
      ok: true,
      value: "+22788999900"
    });
  });

  it("accepte les formats internationaux avec + ou 00", () => {
    expect(normalizeInternationalPhone("+33 6 12 34 56 78")).toEqual({
      ok: true,
      value: "+33612345678"
    });
    expect(normalizeInternationalPhone("00223 70 12 34 56")).toEqual({
      ok: true,
      value: "+22370123456"
    });
  });

  it("refuse un numéro international ambigu sans indicatif explicite", () => {
    expect(normalizeInternationalPhone("33612345678").ok).toBe(false);
    expect(normalizeInternationalPhone("Téléphone 88 99 99 00").ok).toBe(false);
  });

  it("gère les champs facultatifs et l'affichage nigérien", () => {
    expect(normalizeInternationalPhone("")).toEqual({ ok: true, value: "" });
    expect(normalizeInternationalPhone("", { required: true }).ok).toBe(false);
    expect(formatInternationalPhone("+22788999900")).toBe("+227 88 99 99 00");
  });
});
