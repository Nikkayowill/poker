import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_THEME_ID,
  ROOM_THEMES,
  ROOM_THEME_STORAGE_KEY,
  nextRoomThemeId,
  normalizeRoomThemeId,
  roomThemeById,
  roomThemeLabel,
  type RoomThemeId,
} from "./room-theme";

describe("normalizeRoomThemeId", () => {
  it("passes through every real theme id", () => {
    for (const theme of ROOM_THEMES) {
      expect(normalizeRoomThemeId(theme.id)).toBe(theme.id);
    }
  });

  it("falls back to the default for anything else", () => {
    for (const value of [null, undefined, "", "sunrise", 1, {}, []]) {
      expect(normalizeRoomThemeId(value)).toBe(DEFAULT_ROOM_THEME_ID);
    }
  });
});

describe("nextRoomThemeId", () => {
  it("cycles and returns to where it started", () => {
    let id: RoomThemeId = ROOM_THEMES[0].id;
    const seen = new Set<RoomThemeId>();
    for (let i = 0; i < ROOM_THEMES.length; i += 1) {
      seen.add(id);
      id = nextRoomThemeId(id);
    }
    expect(id).toBe(ROOM_THEMES[0].id);
    expect(seen.size).toBe(ROOM_THEMES.length);
  });
});

describe("roomThemeById", () => {
  it("resolves every id to a theme carrying that same id", () => {
    for (const theme of ROOM_THEMES) {
      expect(roomThemeById(theme.id).id).toBe(theme.id);
    }
  });

  it("falls back to the default rather than throwing on a stale id", () => {
    expect(roomThemeById("does_not_exist" as RoomThemeId).id).toBe(DEFAULT_ROOM_THEME_ID);
  });
});

describe("roomThemeLabel", () => {
  it("names each theme distinctly", () => {
    const labels = ROOM_THEMES.map((theme) => roomThemeLabel(theme.id));
    expect(new Set(labels).size).toBe(ROOM_THEMES.length);
  });

  it("keeps every label short enough for one menu row", () => {
    // Same 28-character cap dealerLine and tableRendererLabel hold to --
    // variable-length prose in a fixed row is what clipped before.
    for (const label of ROOM_THEMES.map((theme) => roomThemeLabel(theme.id))) {
      expect(label.length).toBeLessThanOrEqual(28);
    }
  });
});

describe("every theme's palette", () => {
  it("has a carpet that reaches exactly its own backdrop at the rim", () => {
    // The seam-hiding equality: a lit floor meets a fogged void with no
    // horizon line only because the carpet's outermost stop IS the fog/
    // canvas colour. floor-environment.test.ts measures this against the
    // real geometry; this is the same contract stated on the data itself,
    // so a new theme added here without a matching last stop fails before
    // it ever reaches a render.
    for (const theme of ROOM_THEMES) {
      const last = theme.carpetStops[theme.carpetStops.length - 1];
      expect(last.color, theme.id).toBe(theme.backdrop);
    }
  });

  it("starts every carpet ramp at 0 and ends at 1", () => {
    for (const theme of ROOM_THEMES) {
      expect(theme.carpetStops[0].stop, theme.id).toBe(0);
      expect(theme.carpetStops[theme.carpetStops.length - 1].stop, theme.id).toBe(1);
    }
  });

  it("never lets the rim light compete with the key", () => {
    // Same cap floor-environment.test.ts's "is a rim and not a second key"
    // held on the one theme that used to exist.
    for (const theme of ROOM_THEMES) {
      expect(theme.rim.intensity, theme.id).toBeLessThan(0.55);
    }
  });
});

describe("the storage key", () => {
  it("shares the stackchips namespace with every other preference", () => {
    expect(ROOM_THEME_STORAGE_KEY.startsWith("stackchips:")).toBe(true);
  });
});
