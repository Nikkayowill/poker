import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOUND_FILES, soundGain } from "./manifest";

/**
 * The player, checked for the thing the manifest tests cannot see.
 *
 * manifest.test.ts proves the mix is correct as data. It says nothing about
 * whether that data ever reaches an <audio> element, and the bug this module
 * used to have lived entirely on that side: one element cached per *file*,
 * with `raise` and `all-in` sharing a recording, so whichever played last
 * left its gain behind for the other.
 */

interface FakeAudio {
  src: string;
  volume: number;
  preload: string;
  currentTime: number;
  play: ReturnType<typeof vi.fn>;
}

let built: FakeAudio[] = [];

async function loadPlayer() {
  built = [];
  class MockAudio implements FakeAudio {
    src: string;
    volume = 1;
    preload = "";
    currentTime = -1;
    play = vi.fn(() => Promise.resolve());
    constructor(src: string) {
      this.src = src;
      built.push(this);
    }
  }
  vi.stubGlobal("Audio", MockAudio);
  // A window with no real audio stack: enough for the module's
  // `typeof window === "undefined"` guard to take the browser path.
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.resetModules();
  return import("./sound-effects");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playSound", () => {
  it("plays each effect at its own gain", async () => {
    const { playSound } = await loadPlayer();
    playSound("win");
    expect(built).toHaveLength(1);
    expect(built[0].src).toBe(SOUND_FILES.win);
    expect(built[0].volume).toBeCloseTo(soundGain("win"), 10);
    expect(built[0].play).toHaveBeenCalledTimes(1);
    // Rewound, so a sound that fires twice in a hand is heard twice.
    expect(built[0].currentTime).toBe(0);
  });

  it("gives two effects that share a recording their own element", async () => {
    const { playSound } = await loadPlayer();
    playSound("deal");
    playSound("card");

    expect(SOUND_FILES.deal).toBe(SOUND_FILES.card);
    // Two elements for one file. Keyed by file -- which is what this module
    // did -- this is length 1, and the two effects then share a single volume
    // that belongs to whichever was played most recently. They agree on gain
    // today; the keying is what keeps that a choice rather than a constraint.
    expect(built).toHaveLength(2);
    expect(built[0].volume).toBeCloseTo(soundGain("deal"), 10);
    expect(built[1].volume).toBeCloseTo(soundGain("card"), 10);
  });

  it("plays the all-in from its own recording, not the raise at a hotter gain", async () => {
    const { playSound } = await loadPlayer();
    playSound("raise");
    playSound("all-in");

    expect(built).toHaveLength(2);
    expect(built[0].src).toBe(SOUND_FILES.raise);
    expect(built[1].src).toBe(SOUND_FILES["all-in"]);
    expect(built[0].src).not.toBe(built[1].src);
  });

  it("reuses one element per effect rather than building them mid-hand", async () => {
    const { playSound } = await loadPlayer();
    playSound("call");
    playSound("call");
    playSound("call");
    expect(built).toHaveLength(1);
    expect(built[0].play).toHaveBeenCalledTimes(3);
  });

  it("builds nothing for an effect with no asset", async () => {
    const { playSound } = await loadPlayer();
    playSound("lose");
    expect(built).toHaveLength(0);
  });

  it("builds the clock cue, which used to be silent", async () => {
    const { playSound } = await loadPlayer();
    playSound("timeout");
    expect(built).toHaveLength(1);
    expect(built[0].src).toBe(SOUND_FILES.timeout);
  });

  it("goes silent when sound is off, and comes back without rebuilding", async () => {
    const { playSound, setSoundEnabled } = await loadPlayer();
    playSound("deal");
    setSoundEnabled(false);
    playSound("deal");
    playSound("fold");
    expect(built).toHaveLength(1);
    expect(built[0].play).toHaveBeenCalledTimes(1);

    setSoundEnabled(true);
    playSound("deal");
    expect(built).toHaveLength(1);
    expect(built[0].play).toHaveBeenCalledTimes(2);
  });

  it("plays check as two real knocks, spaced like a live double-tap", async () => {
    vi.useFakeTimers();
    const { playSound } = await loadPlayer();
    playSound("check");
    // The first knock is immediate, same as every other effect.
    expect(built).toHaveLength(1);
    expect(built[0].play).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(189);
    expect(built[0].play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    // The second knock reuses the same element -- rewound, not a new one.
    expect(built).toHaveLength(1);
    expect(built[0].play).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("drops a pending repeat if sound is turned off before it fires", async () => {
    vi.useFakeTimers();
    const { playSound, setSoundEnabled } = await loadPlayer();
    playSound("check");
    setSoundEnabled(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(built[0].play).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("survives a rejected play() without throwing", async () => {
    // Autoplay policy rejects until a gesture lands. An unhandled rejection
    // here would surface as an error in the middle of a hand.
    const { playSound } = await loadPlayer();
    playSound("chips");
    built[0].play.mockReturnValueOnce(Promise.reject(new Error("blocked")));
    expect(() => playSound("chips")).not.toThrow();
    await Promise.resolve();
  });
});
