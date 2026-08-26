# Racetrack table facts

Migrated from the root `CLAUDE.md` (2026-08-17) — loads only when working under this directory.
See also `lib/scene/chips/CLAUDE.md` for the chip system specifically.

- This is now support code for one live table: the 2.5D racetrack
  (`components/table/scene/racetrack-scene.tsx`, `lib/scene/table-anchors.ts`), a Canvas 2D room
  drawn from a real perspective camera. It is landscape-only; the app gates portrait viewports
  behind an orientation prompt rather than falling back to a second table.
- The classic orthographic room this directory used to serve (`table-scene.tsx`, `projection.ts`,
  `classicChipSpace`, and everything the old `canvas_2d` renderer value named) was deleted outright
  — not just disabled — once the app went landscape-only; recover it from git history if it's ever
  wanted again rather than re-deriving it. A few files here are still shared with it in spirit only:
  `lib/game/table-geometry.ts`'s CSS ellipse survives as the 3D room's own DOM seat cutouts and as
  the racetrack's pre-layout first-frame fallback, and `seat-ring.ts`'s `seatAngle` survives because
  `chip-scene.ts` still reads it.
- The 3D room (`components/game3d/`, `lib/game3d/`) is a separate WebGL renderer, currently disabled
  via `TABLE_RENDERER_3D_ENABLED` in `lib/scene/table-renderer.ts` but kept in the codebase on
  purpose in case it comes back. `three` is a real dependency again -- do not assume it's uninstalled.
- The pot sits 0.55 of the felt's depth away from the viewer, never at centre (a centred pot stacks
  under the community cards).
- Standing street bets rest at the bettor's own seat and sweep to centre only when the street turns;
  the centre pile always renders `pot − Σ streetBet` so felt chips match the HUD number
  (unit-tested invariant).
