import { describe, expect, it, vi } from "vitest";
import { forEachCooperative } from "./cooperativeWork";

describe("cooperative work", () => {
  it("bounds concurrency and lets a browser task run between chunks", async () => {
    let active = 0;
    let peak = 0;
    let browserRan = false;
    const browser = new Promise<void>(resolve => setTimeout(() => { browserRan = true; resolve(); }, 0));
    await forEachCooperative(Array.from({ length: 100 }, (_, i) => i), async i => {
      peak = Math.max(peak, ++active);
      if (i >= 8) expect(browserRan).toBe(true);
      await Promise.resolve();
      active--;
    });
    await browser;
    expect(peak).toBeLessThanOrEqual(8);
    expect(active).toBe(0);
  });

  it("drains a failed chunk before rejecting and does not launch the next chunk", async () => {
    let completed = 0;
    const work = vi.fn(async (i: number) => {
      if (i === 0) throw new Error("injected");
      await new Promise(resolve => setTimeout(resolve, 1));
      completed++;
    });
    await expect(forEachCooperative(Array.from({ length: 50 }, (_, i) => i), work)).rejects.toThrow("injected");
    expect(work).toHaveBeenCalledTimes(8);
    expect(completed).toBe(7);
  });
});
