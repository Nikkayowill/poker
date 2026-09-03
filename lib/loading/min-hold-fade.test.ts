import { describe, expect, it } from "vitest";
import { phaseOnDeactivate, remainingHoldMs } from "./min-hold-fade";

describe("remainingHoldMs", () => {
  it("returns the full floor before any time has passed", () => {
    expect(remainingHoldMs(0, 450)).toBe(450);
  });

  it("counts down as elapsed time grows", () => {
    expect(remainingHoldMs(200, 450)).toBe(250);
  });

  it("never goes negative once the floor has passed", () => {
    expect(remainingHoldMs(9_000, 450)).toBe(0);
  });

  it("is exactly zero right at the floor", () => {
    expect(remainingHoldMs(450, 450)).toBe(0);
  });
});

describe("phaseOnDeactivate", () => {
  it("stays visible when deactivated before the minimum hold elapses", () => {
    // This is the whole point of the hold: an instant resolve must not be
    // allowed to skip the loading state a player would otherwise never see.
    expect(phaseOnDeactivate(50, 450, false)).toBe("visible");
  });

  it("starts hiding once the minimum hold has elapsed", () => {
    expect(phaseOnDeactivate(450, 450, false)).toBe("hiding");
  });

  it("starts hiding for any elapsed time past the floor", () => {
    expect(phaseOnDeactivate(10_000, 450, false)).toBe("hiding");
  });

  it("skips straight to hidden under reduced motion, even past the floor", () => {
    expect(phaseOnDeactivate(450, 450, true)).toBe("hidden");
  });

  it("still honors the minimum hold under reduced motion", () => {
    // Reduced motion means no fade animation, not "ignore the hold" -- the
    // floor is about giving a tap time to land, which has nothing to do
    // with whether the transition itself animates.
    expect(phaseOnDeactivate(50, 450, true)).toBe("visible");
  });

  it("a zero minimum hold hides immediately", () => {
    expect(phaseOnDeactivate(0, 0, false)).toBe("hiding");
  });
});
