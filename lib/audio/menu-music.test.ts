import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shipped playlist is real (see music-manifest.ts), but these tests mock
 * it anyway: they are about the player's behaviour, and pinning them to the
 * seven files that happen to be there today would make adding an eighth a
 * test failure. The empty-playlist path is proved first, since that is the
 * silent-by-design contract the rest of the app relies on.
 */

interface FakeAudio {
  src: string;
  loop: boolean;
  volume: number;
  preload: string;
  paused: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, handler: EventListener) => void;
  handlers: Record<string, EventListener[]>;
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
    handlers: Record<string, EventListener[]> = {};
    play = vi.fn(() => {
      this.paused = false;
      return Promise.resolve();
    });
    pause = vi.fn(() => {
      this.paused = true;
    });
    addEventListener = (type: string, handler: EventListener) => {
      (this.handlers[type] ??= []).push(handler);
    };
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

/** The element reaching the end of a track, which is what advances the cycle. */
function fireEnded() {
  const audio = built[0];
  audio.paused = true;
  for (const handler of audio.handlers.ended ?? []) handler(new Event("ended"));
}

const PLAYLIST = [
  "/sounds/one.mp3",
  "/sounds/two.mp3",
  "/sounds/three.mp3",
  "/sounds/four.mp3",
];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  stubEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("with no tracks configured", () => {
  it("builds nothing and plays nothing", async () => {
    vi.doMock("./music-manifest", () => ({
      MENU_MUSIC_TRACKS: [],
      MENU_MUSIC_GAIN: 0.4,
    }));
    const { startMenuMusic } = await import("./menu-music");
    startMenuMusic();
    expect(built).toHaveLength(0);
  });
});

describe("with a single track", () => {
  async function loadPlayer() {
    vi.doMock("./music-manifest", () => ({
      MENU_MUSIC_TRACKS: ["/sounds/menu-theme.mp3"],
      MENU_MUSIC_GAIN: 0.4,
    }));
    return import("./menu-music");
  }

  it("loops it in the element rather than advancing a cycle of one", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    expect(built).toHaveLength(1);
    expect(built[0].src).toBe("/sounds/menu-theme.mp3");
    expect(built[0].loop).toBe(true);
    expect(built[0].play).toHaveBeenCalledTimes(1);
  });
});

describe("with a playlist", () => {
  async function loadPlayer() {
    vi.doMock("./music-manifest", () => ({
      MENU_MUSIC_TRACKS: PLAYLIST,
      MENU_MUSIC_GAIN: 0.4,
    }));
    return import("./menu-music");
  }

  it("does not loop the element, so `ended` can fire", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    expect(built).toHaveLength(1);
    expect(built[0].loop).toBe(false);
    expect(PLAYLIST).toContain(built[0].src);
  });

  it("advances to another track on `ended`, reusing the one element", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    const first = built[0].src;

    fireEnded();
    await vi.advanceTimersByTimeAsync(0);

    // One element for the whole playlist: a second would have to earn its own
    // autoplay permission.
    expect(built).toHaveLength(1);
    expect(built[0].src).not.toBe(first);
    expect(built[0].play).toHaveBeenCalledTimes(2);
  });

  it("plays every track once before repeating any of them", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    const played = [built[0].src];
    for (let i = 1; i < PLAYLIST.length; i += 1) {
      fireEnded();
      await vi.advanceTimersByTimeAsync(0);
      played.push(built[0].src);
    }
    expect([...played].sort()).toEqual([...PLAYLIST].sort());
  });

  it("does not play the same track twice across a cycle boundary", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    // Exhaust the cycle, so the next `ended` reshuffles.
    for (let i = 1; i < PLAYLIST.length; i += 1) {
      fireEnded();
      await vi.advanceTimersByTimeAsync(0);
    }
    const last = built[0].src;
    fireEnded();
    await vi.advanceTimersByTimeAsync(0);
    expect(built[0].src).not.toBe(last);
  });

  it("fades each new track up rather than cutting it in at full gain", async () => {
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    expect(built[0].volume).toBeCloseTo(0.4, 5);

    fireEnded();
    await vi.advanceTimersByTimeAsync(50);
    expect(built[0].volume).toBeGreaterThan(0);
    expect(built[0].volume).toBeLessThan(0.4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(built[0].volume).toBeCloseTo(0.4, 5);
  });

  it("stops advancing once it has been disabled", async () => {
    const { startMenuMusic, setMenuMusicEnabled } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    setMenuMusicEnabled(false);
    await vi.advanceTimersByTimeAsync(1000);

    const callsBefore = built[0].play.mock.calls.length;
    fireEnded();
    await vi.advanceTimersByTimeAsync(0);
    expect(built[0].play).toHaveBeenCalledTimes(callsBefore);
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
      handlers: Record<string, EventListener[]> = {};
      pause = vi.fn(() => {
        this.paused = true;
      });
      addEventListener = (type: string, handler: EventListener) => {
        (this.handlers[type] ??= []).push(handler);
      };
      play = vi.fn(() => {
        if (this.play.mock.calls.length === 1) return Promise.reject(new Error("blocked"));
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

describe("the OS media controls", () => {
  interface FakeSession {
    metadata: unknown;
    playbackState: string;
    setActionHandler: ReturnType<typeof vi.fn>;
    handlers: Record<string, (() => void) | null>;
  }

  function stubMediaSession(): FakeSession {
    const session: FakeSession = {
      metadata: null,
      playbackState: "none",
      handlers: {},
      setActionHandler: vi.fn((action: string, handler: (() => void) | null) => {
        session.handlers[action] = handler;
      }),
    };
    vi.stubGlobal("navigator", { mediaSession: session });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(init: Record<string, unknown>) {
          Object.assign(this, init);
        }
      },
    );
    return session;
  }

  async function loadPlayer() {
    vi.doMock("./music-manifest", () => ({
      MENU_MUSIC_TRACKS: PLAYLIST,
      MENU_MUSIC_GAIN: 0.4,
      MENU_MUSIC_METADATA: {
        title: "StackChips",
        artist: "High Roller Arcade",
        album: "StackChips",
        artwork: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    }));
    return import("./menu-music");
  }

  // The whole point of this block: with no metadata published, a phone labels
  // the stream "Untitled" in its notification shade, which shipped to players.
  it("names the stream, so the phone has something to print", async () => {
    const session = stubMediaSession();
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);

    expect(session.metadata).toMatchObject({
      title: "StackChips",
      artist: "High Roller Arcade",
    });
    expect(session.playbackState).toBe("playing");
  });

  it("keeps that label across a track change, and reports paused on stop", async () => {
    const session = stubMediaSession();
    const { startMenuMusic, stopMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    fireEnded();
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.metadata).toMatchObject({ title: "StackChips" });

    stopMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.playbackState).toBe("paused");
  });

  // The OS pause button must reach this module, not the bare element: pausing
  // behind its back leaves it believing it is still playing, so the next
  // idempotent start() would decline to resume.
  it("routes the OS pause button through the module's own fade-and-stop", async () => {
    const session = stubMediaSession();
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);

    session.handlers.pause?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(built[0].pause).toHaveBeenCalledTimes(1);

    session.handlers.play?.();
    expect(built[0].play).toHaveBeenCalledTimes(2);
  });

  it("draws no skip buttons for a bed with no chapters", async () => {
    const session = stubMediaSession();
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.handlers.nexttrack).toBeNull();
    expect(session.handlers.previoustrack).toBeNull();
  });

  it("plays normally where MediaSession does not exist", async () => {
    vi.stubGlobal("navigator", {});
    const { startMenuMusic } = await loadPlayer();
    startMenuMusic();
    await vi.advanceTimersByTimeAsync(1000);
    expect(built[0].play).toHaveBeenCalledTimes(1);
    expect(built[0].volume).toBeCloseTo(0.4, 5);
  });
});

describe("shuffleIndices", () => {
  it("is a permutation: every index exactly once", async () => {
    vi.doMock("./music-manifest", () => ({
      MENU_MUSIC_TRACKS: PLAYLIST,
      MENU_MUSIC_GAIN: 0.4,
    }));
    const { shuffleIndices } = await import("./menu-music");
    for (let count = 1; count <= 12; count += 1) {
      const order = shuffleIndices(count);
      expect([...order].sort((a, b) => a - b)).toEqual(
        Array.from({ length: count }, (_, i) => i),
      );
    }
  });

  it("is driven entirely by the randomness it is given", async () => {
    vi.doMock("./music-manifest", () => ({
      MENU_MUSIC_TRACKS: PLAYLIST,
      MENU_MUSIC_GAIN: 0.4,
    }));
    const { shuffleIndices } = await import("./menu-music");
    // Always drawing 0 swaps each position with the first, which is a fixed,
    // checkable arrangement -- proof the sequence, not Math.random, decides.
    expect(shuffleIndices(4, () => 0)).toEqual([1, 2, 3, 0]);
    // Drawing just under 1 always picks the top index, leaving order intact.
    expect(shuffleIndices(4, () => 0.999)).toEqual([0, 1, 2, 3]);
  });
});
