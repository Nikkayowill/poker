# 2D table facts

Migrated from the root `CLAUDE.md` (2026-08-17) — loads only when working under this directory.
See also `lib/scene/chips/CLAUDE.md` for the chip system specifically.

- Canvas 2D room (`lib/scene/`), not WebGL — the WebGL room is preserved on `archive/webgl-room` but
  was explicitly reverted at the user's request; don't resurrect it without being asked. `three` is
  uninstalled on `main`.
- The room fits `.poker-rail`'s measured box (not the table wrap's raw width) and solves both radii
  per breakpoint — a fixed radius ratio painted a pancake on portrait phones.
- The pot sits 0.55 of the felt's depth away from the viewer, never at centre (a centred pot stacks
  under the community cards).
- Standing street bets rest at the bettor's own seat and sweep to centre only when the street turns;
  the centre pile always renders `pot − Σ streetBet` so felt chips match the HUD number
  (unit-tested invariant).
