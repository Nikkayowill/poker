# game3d — R3F table room (experiment)

An isolated 3D presentation layer for the six-max table, built with
React Three Fiber + drei. **The engine is read-only from here**: the only
input is the redacted `GameSnapshot` the existing API already serves, and
nothing in `lib/game/`, `lib/server/`, or the DOM table was modified.
Deleting `components/game3d/`, `lib/game3d/`, and `app/game3d/` (plus the
three `package.json` deps: `three`, `@react-three/fiber`,
`@react-three/drei`) removes the experiment without a trace.

## Layout

- `lib/game3d/` — pure, unit-tested logic (`npm test` reaches only `lib/`
  and `app/`, which is why it is not under `components/`):
  - `seat-layout.ts` — the one spatial authority: seat ring, bet spots,
    pot/board positions, facing angles.
  - `chip-trajectory.ts` — closed-form arc + damped-bounce flight. Pure
    function of elapsed time, no integrator: the 2D room's
    "fed the drawn position back into the stepper" bug is structurally
    impossible here, and flights terminate exactly.
  - `denominations.ts` — amount → chip colours, display-capped.
  - `scene-model.ts` — `deriveSceneModel(GameSnapshot)`: seat rotation
    (local player → slot 0), moods, and the felt-sums-to-pot invariant
    (`potResting = pot − Σ streetBet`).
  - `avatar-state.ts` — fuzzy clip matching for arbitrary .glb rigs, toss
    transient resolution, head-tracking clamps.
  - `snapshot-fixture.ts` — typed snapshot builders shared by tests and
    the demo.
- `components/game3d/` — rendering:
  - `game3d-bridge.tsx` — **the seam**. Give it a `GameSnapshot`; children
    render into the HTML overlay. Mount it where `poker-app.tsx` holds its
    snapshot to drive it from the live game.
  - `scene/` — Canvas root (dynamic `ssr: false` only), light rig (one
    shadow-casting spotlight over the felt), table, generated card
    textures (no network; CSP-safe).
  - `avatars/player-avatar-3d.tsx` — GLB path (`useGLTF` +
    `useAnimations`, cross-faded states, bone head-tracking) and a
    procedural zero-asset fallback. Remote GLB hosts (e.g. Ready Player
    Me) additionally need a CSP `connect-src` entry in `next.config.ts`,
    which this branch deliberately does not touch.
  - `chips/` — shared-geometry stacks and the flight manager
    (bet → own spot; street turn sweeps spots → pot; winners funnel out;
    hand boundary clears instantly — the 2D room's exact contract).
  - `hud/action-hud.tsx` + `game3d.module.css` — crisp HTML overlay
    (pot, message, Fold/Call/Raise). A CSS module so the numbered global
    cascade is untouched. (The repo does not use Tailwind; the module
    fills that role.)
- `app/game3d/page.tsx` — looping scripted demo; your seat's actions
  branch the script.

## Performance notes

DPI capped at `[1, 2]`; one 1024px shadow map; one shared chip geometry
and one material triple per denomination; card textures cached per
rank+suit; flights mutate mesh transforms in `useFrame` (no React
re-render mid-air); low segment counts throughout.
