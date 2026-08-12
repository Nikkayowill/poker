/**
 * The 3D room's swappable look: void colour, carpet gradient, and every
 * light's colour/intensity.
 *
 * WHY THIS EXISTS. The camera never sees a horizon at any shipped aspect
 * (`floor-environment.ts`'s `horizonInFrame`, pinned by a test that walks
 * the whole aspect range) — that's load-bearing for card and face
 * legibility, not a limitation to design around. So the entire visible
 * environment is the floor, the fog it fades into, and the lights that hit
 * the table. Until this file existed that "look" was five hardcoded values
 * spread across three files (`STUDIO_BACKDROP`, `CARPET_STOPS`,
 * `STUDIO_SPOT`/`STUDIO_RIM` colour+intensity, plus a hemisphere and a kick
 * light typed straight into `poker-scene.tsx`'s JSX) — changing the room's
 * mood meant hand-editing all five and re-rendering to check nothing drifted
 * out of sync. One `RoomTheme` per look, swappable at a menu, is what makes
 * a second mood (and a fifth, later) an entry in an array instead of a
 * five-file edit.
 *
 * What is deliberately NOT here, because it isn't a "look" choice: light
 * *positions*, the spotlight's angle/penumbra/target (solved from the table
 * geometry in `studio-environment.ts`), and the rim light's `castShadow:
 * false` (a performance decision, restated as a plain constant in
 * `floor-environment.ts`). Every theme shares the same rig; only what each
 * fixture emits changes.
 *
 * Same shape as `lib/scene/table-renderer.ts` and `lib/scene/bet-style.ts`
 * on purpose — a typed id union, a themes array, a `stackchips:` storage
 * key, normalize/next/label helpers — and lives in `lib/` for the same
 * reason those do: `vitest.config.ts` collects only `lib/` and `app/`.
 */

export type RoomThemeId = "after_dark" | "velvet_lounge";

export interface RoomTheme {
  id: RoomThemeId;
  label: string;
  /**
   * Fog colour AND canvas background — the two must match or the fade draws
   * a horizon line (see `studio-environment.ts`'s `studioFog`). Also the
   * carpet gradient's own final stop; a theme whose last `carpetStops` entry
   * doesn't equal this is the seam-at-the-rim bug `floor-environment.test.ts`
   * exists to catch, generalized to every theme now rather than the one that
   * used to be hardcoded.
   */
  backdrop: string;
  /** A fraction-of-`FLOOR_RADIUS` colour ramp; see `carpetColorAt`. */
  carpetStops: readonly { stop: number; color: string }[];
  spot: { color: string; intensity: number; decay: number };
  rim: { color: string; intensity: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  kick: { color: string; intensity: number };
}

/**
 * Today's look, byte-identical to the values this file replaces — the
 * default render must not change just because the values moved.
 */
const AFTER_DARK: RoomTheme = {
  id: "after_dark",
  label: "Room: Poker After Dark",
  backdrop: "#060913",
  carpetStops: [
    { stop: 0, color: "#241a12" },
    { stop: 0.2, color: "#1c130e" },
    { stop: 0.45, color: "#100b0a" },
    { stop: 1, color: "#060913" },
  ],
  spot: { color: "#ffeed8", intensity: 156, decay: 1.6 },
  rim: { color: "#c99456", intensity: 0.42 },
  hemisphere: { sky: "#8f8aa6", ground: "#191219", intensity: 0.55 },
  kick: { color: "#e8d9c4", intensity: 0.85 },
};

/**
 * A second, deliberately different starting point — warm burgundy void and
 * carpet under a slightly hotter spot, in the same family as the rail's own
 * dark leather rather than the felt's brand green (the felt itself is
 * untouched by any theme; see table-3d.tsx). Its exact hex values are a
 * first guess, not a final judgment — same as every other palette in this
 * codebase, tune it against a real GPU render (headless Playwright falls
 * back to SwiftShader and hides real colour work) using the room-theme menu
 * toggle to switch to it live.
 */
const VELVET_LOUNGE: RoomTheme = {
  id: "velvet_lounge",
  label: "Room: Velvet Lounge",
  backdrop: "#0d0608",
  carpetStops: [
    { stop: 0, color: "#3a1420" },
    { stop: 0.2, color: "#2a0f18" },
    { stop: 0.45, color: "#170a0e" },
    { stop: 1, color: "#0d0608" },
  ],
  spot: { color: "#ffe6c2", intensity: 150, decay: 1.6 },
  rim: { color: "#d9a45a", intensity: 0.4 },
  hemisphere: { sky: "#a68a8f", ground: "#1f1013", intensity: 0.5 },
  kick: { color: "#f0dcc0", intensity: 0.85 },
};

export const ROOM_THEMES: readonly RoomTheme[] = [AFTER_DARK, VELVET_LOUNGE];

export const DEFAULT_ROOM_THEME_ID: RoomThemeId = "after_dark";

/** Same `stackchips:` namespace as every other preference. */
export const ROOM_THEME_STORAGE_KEY = "stackchips:room-theme";

const IDS: readonly RoomThemeId[] = ROOM_THEMES.map((theme) => theme.id);

/** A stored or wire value, coerced to a real theme id. Anything else is the default. */
export function normalizeRoomThemeId(value: unknown): RoomThemeId {
  return IDS.includes(value as RoomThemeId) ? (value as RoomThemeId) : DEFAULT_ROOM_THEME_ID;
}

/** The next theme id in the cycle, for a single menu entry that toggles through. */
export function nextRoomThemeId(id: RoomThemeId): RoomThemeId {
  const index = IDS.indexOf(id);
  return IDS[(index + 1) % IDS.length];
}

/** Resolve an id to its full theme. Falls back to the default rather than
 * throwing, so a stale id from an older build degrades to a look instead of
 * a crash. */
export function roomThemeById(id: RoomThemeId): RoomTheme {
  return ROOM_THEMES.find((theme) => theme.id === id) ?? AFTER_DARK;
}

/** What the table menu prints for the active theme. */
export function roomThemeLabel(id: RoomThemeId): string {
  return roomThemeById(id).label;
}
