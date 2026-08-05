import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MENU_MUSIC_TRACK is null until a real file is dropped in (see
 * music-manifest.ts) -- these tests prove the silent-by-design path first,
 * then mock the manifest to prove the actual player logic once a track
 * exists, the same split sound-effects.test.ts uses against the real
 * (non-null) SFX manifest.
 */

interface FakeAudio {
  src: string;
  loop: boolean;
  volume: number;
  preload: string;
  paused: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

let built: FakeAudio[] = [];
let listeners: Record<string, EventListener[]> = {};

function stubEnvironment() {
  built = [];
  listeners = {};
  class MockAudio implements FakeAudio {
    src: string;
    loop = false;
    volume = 0;
    preload = "";
    paused = true;
    play = vi.fn(() => {
      this.paused = false;
      return Promise.resolve();
    });
    pause = vi.fn(() => {
      this.paused = true;
    });
    constructor(src: string) {
      this.src = src;
      built.push(this);
    }
  }
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("window", {
    addEventListener: (type: string, handler: EventListener) => {
      (listeners[type] ??= []).push(handler);
    },
    removeEventListener: vi.fn(),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (...args: Parameters<typeof clearInterval>) => clearInterval(...args),
  });
}

function fireGesture() {
  for (const handler of listeners.pointerdown ?? []) handler(new Event("pointerdown"));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  stubEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("with no track configured (the shipped default)", () => {
  it("builds nothing and plays nothing", async () => {
    const { startMenuMusic } = await import("./menu-music");
    startMenuMusic();
    expect(built).toHaveLength(0);
  });
});

describe("once a track is configured", () => {
  async function loadPlayer() {
    vi.doMock("./music-manifest", () => ({
      MENU_MUSIC_TRACK: "/sounds/menu-theme.mp3",
      MENU_MUSIC_GAIN: 0.4,
    }));
    return import("./menu-music");
  }

  it("loops the one track it was given and starts it playing", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    expect(built).toHaveLength(1);
    expect(built[0].src).toBe("/sounds/menu-theme.mp3");
    expect(built[0].loop).toBe(true);
    expect(built[0].play).toHaveBeenCalledTimes(1);
  });

  it("fades up to the configured gain rather than jumping straight there", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    // One fade tick (700ms / 14 steps = 50ms), not the whole ramp.
    await vi.advanceTimersByTimeAsync(50);
    expect(built[0].volume).toBeGreaterThan(0);
    expect(built[0].volume).toBeLessThan(0.4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(built[0].volume).toBeCloseTo(0.4, 5);
  });

  it("is idempotent: a second start while already playing builds nothing new", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    startMenuMusic();
    expect(built).toHaveLength(1);
    expect(built[0].play).toHaveBeenCalledTimes(1);
  });

  it("fades out and then pauses on stop, rather than cutting abruptly", async () => {
    const { startMenuMusic, stopMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    stopMenuMusic();
    expect(built[0].pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(built[0].volume).toBeCloseTo(0, 5);
    expect(built[0].pause).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when disabled, and does not resume on its own when re-enabled", async () => {
    const { startMenuMusic, setMenuMusicEnabled } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    setMenuMusicEnabled(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(built[0].pause).toHaveBeenCalledTimes(1);

    setMenuMusicEnabled(true);
    expect(built[0].play).toHaveBeenCalledTimes(1);
  });

  it("retries on the next real gesture after autoplay blocks the first attempt", async () => {
    const { startMenuMusic } = await loadPlayer();
    built = [];
    class BlockedThenAllowedAudio implements FakeAudio {
      src: string;
      loop = false;
      volume = 0;
      preload = "";
      paused = true;
      pause = vi.fn(() => {
        this.paused = true;
      });
      play = vi.fn(() => {
        if (built.length === 1) return Promise.reject(new Error("blocked"));
        this.paused = false;
        return Promise.resolve();
      });
      constructor(src: string) {
        this.src = src;
        built.push(this);
      }
    }
    vi.stubGlobal("Audio", BlockedThenAllowedAudio);

    startMenuMusic();
    await vi.advanceTimersByTimeAsync(0);
    expect(built[0].play).toHaveBeenCalledTimes(1);
    expect(built[0].paused).toBe(true);

    fireGesture();
    expect(built[0].play).toHaveBeenCalledTimes(2);
  });
});
