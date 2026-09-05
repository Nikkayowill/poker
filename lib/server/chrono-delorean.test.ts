import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `CHRONO_DELOREAN_ENABLED` is a top-level `const` in lib/server/chrono-
 * delorean.ts, computed once from `process.env` the moment that module is
 * first imported -- the same shape (and the same reason: so the disabled
 * branch is a single boolean read, not a per-call environment lookup)
 * lib/server/admin-auth.ts's own module-scope constants use. Proving BOTH
 * the enabled and disabled paths therefore means re-importing the module
 * fresh under each environment, not just calling exported functions --
 * `vi.resetModules()` plus a dynamic `import()` after `vi.stubEnv` is the
 * standard way to do that, and it is used throughout this file rather than
 * a single static import at the top for exactly that reason: a static
 * import here would freeze `CHRONO_DELOREAN_ENABLED` at whatever
 * `process.env` held when the test FILE first loaded, before any test's own
 * `vi.stubEnv` call had a chance to run.
 *
 * Every dynamic import in one `it` pulls `ensureProfile` fresh from the same
 * reset module graph as the chrono-delorean module under test, rather than
 * mixing a fresh import with the file's own (nonexistent) static one --
 * profile-store.ts keeps its token->profile map at module scope, so a stale
 * reference to a pre-reset copy of it would silently look up a different,
 * empty map than the one the freshly-imported chrono-delorean functions
 * write through.
 */

interface LoadedChrono {
  CHRONO_DELOREAN_ENABLED: boolean;
  resolveChronoNow: (token: string) => Promise<Date>;
  readChronoDeloreanStatus: (token: string) => Promise<{
    enabled: boolean;
    offsetMs: number;
    realNowIso: string;
    simulatedNowIso: string;
  }>;
  setChronoDeloreanOffset: (token: string, offsetMs: number) => Promise<unknown>;
  advanceChronoDeloreanOffset: (token: string, deltaMs: number) => Promise<unknown>;
  resetChronoDeloreanOffset: (token: string) => Promise<unknown>;
  ChronoDeloreanDisabledError: new () => Error;
  ChronoDeloreanRangeError: new () => Error;
  ensureProfile: (token: string) => Promise<{ id: string }>;
}

async function loadChrono(env: { nodeEnv?: string; mode?: string }): Promise<LoadedChrono> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env.nodeEnv ?? "test");
  if (env.mode === undefined) {
    delete process.env.CHRONO_DELOREAN_MODE;
  } else {
    vi.stubEnv("CHRONO_DELOREAN_MODE", env.mode);
  }
  const chrono = await import("./chrono-delorean");
  const { ensureProfile } = await import("./profile-store");
  return { ...chrono, ensureProfile };
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CHRONO_DELOREAN_MODE;
});

describe("CHRONO_DELOREAN_ENABLED gating", () => {
  it("is false with no CHRONO_DELOREAN_MODE set, even outside production", async () => {
    const { CHRONO_DELOREAN_ENABLED } = await loadChrono({ nodeEnv: "development" });
    expect(CHRONO_DELOREAN_ENABLED).toBe(false);
  });

  it("is false in production even with CHRONO_DELOREAN_MODE=1 -- the load-bearing case", async () => {
    const { CHRONO_DELOREAN_ENABLED } = await loadChrono({ nodeEnv: "production", mode: "1" });
    expect(CHRONO_DELOREAN_ENABLED).toBe(false);
  });

  it("is false for any value of CHRONO_DELOREAN_MODE other than exactly '1'", async () => {
    const { CHRONO_DELOREAN_ENABLED } = await loadChrono({ nodeEnv: "development", mode: "true" });
    expect(CHRONO_DELOREAN_ENABLED).toBe(false);
  });

  it("is true only with both a non-production NODE_ENV and CHRONO_DELOREAN_MODE=1", async () => {
    const { CHRONO_DELOREAN_ENABLED } = await loadChrono({ nodeEnv: "development", mode: "1" });
    expect(CHRONO_DELOREAN_ENABLED).toBe(true);
  });
});

describe("resolveChronoNow", () => {
  it("returns real time when disabled, without ever touching a profile", async () => {
    const chrono = await loadChrono({ nodeEnv: "development" });
    const before = Date.now();
    const now = await chrono.resolveChronoNow(randomUUID());
    const after = Date.now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it("returns real time for a profile with no offset ever set, when enabled", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const token = randomUUID();
    await chrono.ensureProfile(token);
    const before = Date.now();
    const now = await chrono.resolveChronoNow(token);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("adds the stored offset to real time once one is set", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const token = randomUUID();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    await chrono.setChronoDeloreanOffset(token, threeDaysMs);

    const before = Date.now();
    const now = await chrono.resolveChronoNow(token);
    const after = Date.now();

    expect(now.getTime()).toBeGreaterThanOrEqual(before + threeDaysMs);
    expect(now.getTime()).toBeLessThanOrEqual(after + threeDaysMs);
  });

  it("never lets a disabled build see an offset set while enabled -- each is its own module instance", async () => {
    // Set an offset while enabled...
    const enabled = await loadChrono({ nodeEnv: "development", mode: "1" });
    const token = randomUUID();
    await enabled.ensureProfile(token);
    await enabled.setChronoDeloreanOffset(token, 999_999);

    // ...then reload disabled. resolveChronoNow must short-circuit to real
    // time before ever reading the store this profile's offset lives in --
    // proving that requires the SAME token to resolve to a DIFFERENT real
    // profile in the freshly reset profile-store, which is fine: the
    // assertion is only that the disabled path is real time, period.
    const disabled = await loadChrono({ nodeEnv: "development" });
    const before = Date.now();
    const now = await disabled.resolveChronoNow(token);
    expect(now.getTime() - before).toBeLessThan(1000);
  });
});

describe("mutating the offset requires the harness to be enabled", () => {
  it("setChronoDeloreanOffset throws ChronoDeloreanDisabledError when disabled", async () => {
    const chrono = await loadChrono({ nodeEnv: "development" });
    await expect(chrono.setChronoDeloreanOffset(randomUUID(), 1000)).rejects.toBeInstanceOf(
      chrono.ChronoDeloreanDisabledError,
    );
  });

  it("advanceChronoDeloreanOffset throws ChronoDeloreanDisabledError when disabled", async () => {
    const chrono = await loadChrono({ nodeEnv: "development" });
    await expect(chrono.advanceChronoDeloreanOffset(randomUUID(), 1000)).rejects.toBeInstanceOf(
      chrono.ChronoDeloreanDisabledError,
    );
  });

  it("resetChronoDeloreanOffset throws ChronoDeloreanDisabledError when disabled", async () => {
    const chrono = await loadChrono({ nodeEnv: "development" });
    await expect(chrono.resetChronoDeloreanOffset(randomUUID())).rejects.toBeInstanceOf(
      chrono.ChronoDeloreanDisabledError,
    );
  });
});

describe("offset arithmetic and bounds, once enabled", () => {
  it("advance is additive across repeated calls", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const token = randomUUID();
    const oneDay = 24 * 60 * 60 * 1000;

    const first = (await chrono.advanceChronoDeloreanOffset(token, oneDay)) as { offsetMs: number };
    expect(first.offsetMs).toBe(oneDay);

    const second = (await chrono.advanceChronoDeloreanOffset(token, oneDay)) as { offsetMs: number };
    expect(second.offsetMs).toBe(oneDay * 2);

    const rewound = (await chrono.advanceChronoDeloreanOffset(token, -oneDay)) as {
      offsetMs: number;
    };
    expect(rewound.offsetMs).toBe(oneDay);
  });

  it("set replaces the offset absolutely rather than adding to it", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const token = randomUUID();
    await chrono.setChronoDeloreanOffset(token, 5000);
    const status = (await chrono.setChronoDeloreanOffset(token, 2000)) as { offsetMs: number };
    expect(status.offsetMs).toBe(2000);
  });

  it("reset returns the offset to exactly zero", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const token = randomUUID();
    await chrono.setChronoDeloreanOffset(token, 123_456);
    const status = (await chrono.resetChronoDeloreanOffset(token)) as { offsetMs: number };
    expect(status.offsetMs).toBe(0);
  });

  it("rejects a set beyond +365 days with ChronoDeloreanRangeError", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const tooFar = 366 * 24 * 60 * 60 * 1000;
    await expect(chrono.setChronoDeloreanOffset(randomUUID(), tooFar)).rejects.toBeInstanceOf(
      chrono.ChronoDeloreanRangeError,
    );
  });

  it("rejects an advance that would push the total beyond -365 days", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const token = randomUUID();
    const maxBack = -365 * 24 * 60 * 60 * 1000;
    await chrono.setChronoDeloreanOffset(token, maxBack);
    await expect(chrono.advanceChronoDeloreanOffset(token, -1)).rejects.toBeInstanceOf(
      chrono.ChronoDeloreanRangeError,
    );
  });

  it("accepts exactly +/-365 days as in-bounds", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const boundary = 365 * 24 * 60 * 60 * 1000;
    const status = (await chrono.setChronoDeloreanOffset(randomUUID(), boundary)) as {
      offsetMs: number;
    };
    expect(status.offsetMs).toBe(boundary);
  });
});

describe("readChronoDeloreanStatus", () => {
  it("answers enabled:false with matching real/simulated clocks when disabled, never throwing", async () => {
    const chrono = await loadChrono({ nodeEnv: "development" });
    const status = await chrono.readChronoDeloreanStatus(randomUUID());
    expect(status.enabled).toBe(false);
    expect(status.offsetMs).toBe(0);
    expect(status.realNowIso).toBe(status.simulatedNowIso);
  });

  it("answers enabled:true with a simulatedNowIso offset from realNowIso by the stored amount", async () => {
    const chrono = await loadChrono({ nodeEnv: "development", mode: "1" });
    const token = randomUUID();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    await chrono.setChronoDeloreanOffset(token, oneWeekMs);

    const status = await chrono.readChronoDeloreanStatus(token);
    expect(status.enabled).toBe(true);
    expect(status.offsetMs).toBe(oneWeekMs);
    const delta = Date.parse(status.simulatedNowIso) - Date.parse(status.realNowIso);
    expect(delta).toBe(oneWeekMs);
  });
});
