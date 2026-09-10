import { describe, expect, it, vi } from "vitest";
import { presentTicketSync } from "./presentTicketSync";

describe("presentTicketSync", () => {
  it("affiche apres persistance locale sans attendre le cloud, mais conserve le verrou jusqu'au cloud", async () => {
    let release!: () => void;
    const cloud = new Promise<void>((resolve) => { release = resolve; });
    const present = vi.fn();
    const publish = vi.fn(() => cloud);
    let finished = false;
    const task = presentTicketSync(async () => ["confirmed"], present, publish).then(() => { finished = true; });
    await Promise.resolve();
    expect(present).toHaveBeenCalledWith(["confirmed"]);
    expect(publish).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    release();
    await task;
    expect(finished).toBe(true);
  });

  it("ne presente ni ne publie une ecriture locale echouee", async () => {
    const present = vi.fn();
    const publish = vi.fn();
    await expect(presentTicketSync(async () => { throw new Error("local"); }, present, publish)).rejects.toThrow("local");
    expect(present).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("conserve la presentation locale si la publication echoue", async () => {
    const present = vi.fn();
    await expect(presentTicketSync(async () => "confirmed", present, async () => { throw new Error("cloud"); })).rejects.toThrow("cloud");
    expect(present).toHaveBeenCalledExactlyOnceWith("confirmed");
  });
});
