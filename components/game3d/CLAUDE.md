# 3D room facts

Migrated from the root `CLAUDE.md` (2026-08-17) — loads only when working under this directory.

- Runs `frameloop="always"` and must — drei's `useAnimations` advances mixers from `useFrame`, so
  demand-mode freezes every seated character. `awake()` reads an "is there pending work" registry
  flag, not recent-paint timing (a shadow-mapped scene under headless SwiftShader renders ~2fps and a
  timing-based check reported it permanently asleep).
- No skybox/backdrop wall is possible beyond the balustrade ring above — every frustum ray hits the
  floor at every shipped aspect. `lib/game3d/floor-environment.ts` derives floor radius from the
  camera fit instead of a wall.
- Camera fit (`frameCamera`) is a numeric search (bisect distance, Newton-step the aim), not a closed
  form — a closed form summed two upper bounds that never co-occur and under-filled every landscape
  aspect.
- Table felt is 2:1 stadium-proportioned (a real six-max table's ratio), derived from
  `TABLE_WIDTH_M`, not independently typed.
- Avatars' hands rest on the felt aimed at their own cards (`lib/game3d/hand-anchors.ts`/
  `arm-ik.ts`/`hand-rig.ts`) — five of six seats are physically out of reach of their own cards; the
  fix aims the wrist a hand-length back from the card rather than leaning the torso (tried and
  reverted — a lean big enough to matter reads as hunching and is unstable in a feedback loop).
  Finger curl is rebuilt per-digit from each joint's own bind-pose geometry, not a uniform curl
  applied to all five (which read as gripping a tube — "holding a flute").
- Chips resolve to explicit per-chip slots (`lib/game3d/chip-instance-model.ts:pileSlot`), not a
  golden-angle scatter — a resting pile's destination and a flight's landing target are the same
  computed value now, which is what stopped chips reading as stacked inside each other.
- 3D character ownership: 6 free starter avatars; Claira/Donni/Jimmy/Kenji unlock at 10/50/150/500
  lifetime hands won; Derek/Oscar/Victor/Marcus cost 1m–6m Gold (`lib/cosmetics/catalog.ts`). Never
  default a generated cosmetic entry to `price: 0` — free catalogue entries are implicit ownership.
- Never call `renderer.forceContextLoss()` in a React cleanup on any WebGL work here — with a
  React-owned canvas plus StrictMode's double-mount, a force-lost context can't be re-acquired and
  permanently breaks the second mount. `renderer.dispose()` alone is correct.
