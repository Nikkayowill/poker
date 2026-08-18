# Chip system (rebuilt 2026-08-14)

Migrated from the root `CLAUDE.md` (2026-08-17) — loads only when working under this directory.

The 2D chip system was deleted and rebuilt from scratch; `chip-layer.ts`, `chip-physics.ts`,
`chip-spring.ts` and `paint.ts` no longer exist. Both 2D renderers (classic ellipse + racetrack)
share it through `ChipSpace`/`SceneProjection`. The 3D room's chips are separate and untouched.
- **A chip is sized in pixels, not world units** (`chip-spec.ts`). The old system sized it in world
  units and let the projection decide, which gave the side wall 1.7px on a desktop and 0.65px on a
  phone — under a pixel there is no cylinder, which is the whole "flat, like a UI element" problem.
  The wall is clamped to 3–4px and the radius floor (6px) is *derived* from it (`MIN_WALL_PX /
  WALL_RATIO`), not chosen. `solveChipWorldRadius` runs once per fit and feeds **both** the layout
  and the painter — clamping in the painter alone spaces the mound for one chip size and draws
  another, and the columns overlap.
- **Stack height is a screen-space offset**, not world Y: `RenderChip` carries a ground position and
  an integer `stackIndex`, and the painter multiplies it by a pitch derived from that chip's own
  drawn size. That is what pins the gap between stacked chips at 3–4px on every plate and at every
  depth under the racetrack's perspective camera.
- **Two populations that never mix** (`chip-scene.ts`). Permanent chips (pot mound, standing bets)
  are pure layout and never move; transient chips are spawned, flown and destroyed. A chip joining
  the pot is a transient chip that reveals its permanent chip on landing. The old `keepOnArrival`
  flag left settled chips in the moving list carrying a live target — every "the pot twitched" bug
  came from that and none are expressible now.
- **The motion is an analytic spring on a clock** (`chip-motion.ts`), not an integrated one. It must
  terminate exactly at t=1 or the demand loop can never sleep; `omega` is solved from the requested
  overshoot so a preset's overshoot is exact, and every preset's residual at t=1 is under half a
  pixel on the longest journey. Timings come from the *action* (`ChipMoveKind`: call 200ms → all-in
  620ms), derived client-side in `bet-flight.ts` — deliberately not on the wire.
- The landing squash is a fraction of the post-landing window, never a fixed millisecond count: a
  fixed 110ms squash outlives every flight's remaining clock and the terminal snap chops it, so
  chips arrive still visibly squashed.
- Bet style (`bet-style.ts`) is now three *modifiers* over that one engine (arc, stagger, variance,
  scatter), not three separate animations. It cannot reorder the action timings.
- The pot is a **mound**, not a wall: columns capped at 9, up to 6 columns in a triangular footprint
  that grows into depth as well as width, capped at 54 chips. A pot's size is meant to be readable
  from the silhouette; the exact number is in the HUD.
- Wall edge inserts are shaded most of the way to the wall's own value on purpose — at face
  brightness, nine chips of unaligned marks turn a column into a checkerboard.
- The denomination numeral only prints at radius ≥ 9px (racetrack, large desktop plates). Below that
  it is 2–3px of cap height and reads as dirt; colour carries the denomination, which is what casino
  chips are colour-coded for.
- `app/dev/chips` is the bench: every denomination, stack height, pot silhouette and action's motion
  at the classic room's own measured scales (desktop rail ≈ 44 px/unit, portrait phone rail ≈ 17,
  large desktop ≈ 60). The racetrack has no fixed scale to bench against — its camera-derived
  `scaleAt()` varies by viewport (`racetrack-scene.tsx`) rather than landing on one constant the way
  the classic room's rail width does. Judge chip art there, at those scales, not zoomed.
