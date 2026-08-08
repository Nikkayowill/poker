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
  - `avatars.ts` — procedural character *specs*: primitive-shape part lists
    (capsule torso, sphere head, box/cylinder hats-hair-sunglasses) with a
    seeded wardrobe (FNV hash of the seat name, never `Math.random`) and an
    arithmetic triangle count; a test pins every character — six players
    and the dealer — under 1,500 triangles. Pure data, no three import.
  - `studio-environment.ts` — the "Poker After Dark" set: fog distances
    solved from the per-aspect camera framing (linear, not FogExp2 — the
    file header proves no single exponential density can keep the felt
    crisp *and* swallow the floor rim), the soft-edged spotlight cone
    (penumbra 0.85, truss height stated in metres through dimensions.ts),
    fold/bet pose targets, and the dealer's stand. Tests assert who is lit,
    who fades, and that a folded figure still projects on screen at
    1440×900, 844×390, 390×844 and 820×1180.
  - `snapshot-fixture.ts` — typed snapshot builders shared by tests and
    the demo.
- `components/game3d/` — rendering:
  - `game3d-bridge.tsx` — **the seam**. Give it a `GameSnapshot`; children
    render into the HTML overlay. Mount it where `poker-app.tsx` holds its
    snapshot to drive it from the live game.
  - `scene/` — Canvas root (dynamic `ssr: false` only), light rig (one
    shadow-casting spotlight over the felt), table, generated card
    textures (no network; CSP-safe).
  - `avatars/sprite-avatar.tsx` — **the seats' primary renderer**: the
    character's six-angle turnaround, drawn from `public/avatars3d/`.
    `lib/game3d/avatar-sprites.ts` is the pure half — the picker, the
    metrics and the motion amplitudes, all unit-tested.
    - **The quad faces the camera; the artwork carries the angle.** This
      is the whole difference from the standee it replaces. That renderer
      owned one frontal image per character, so it yawed the quad partway
      toward the seat's facing and clamped at ~45° — which made a side
      seat read as a cutout turned edge-on. With a real turnaround,
      `spriteForSeatAngle` picks the render that already depicts how that
      chair is turned and the quad simply squares up. Nothing fakes
      anything, and no seat ever shows a paper edge.
    - **The picker keys off the seat's ring angle, not its slot index**, so
      an eight-max ring or any reseating keeps working: angles between two
      renders round to the nearer. Art at 45° steps against a 60° ring
      leaves four seats up to 15° off-axis — invisible at table distance,
      and pinned by a test so a future ring can't drift further. The
      left/right assignment is pinned against the *geometry* rather than
      the file names, because a mirrored mapping is the easy mistake here.
    - **The quads are SCREEN-ALIGNED, pivoting at the head.** A
      world-vertical billboard does not project to screen-vertical under a
      camera pitched down: it keystones, measured at ±25.8° at the
      near-side seats on a desktop and ±47.8° upright, which reads exactly
      as the nearest players lounging backwards. The same pitch was also
      squashing every figure vertically by ~31%. Holding the quad parallel
      to the image plane fixes the lean and the proportions together.
      Pivoting it is a second decision: whichever point you pivot about is
      the only one that stays put, and pivoting at the *foot* swung every
      head ~0.8 units further from the camera, behind its own chair back —
      six faceless silhouettes. `HEAD_RISE` pins the head instead and lets
      the faded foot swing forward, where it is both transparent and below
      the felt, so it vanishes into the table.
    - **Three collisions the numbers hide, all found on renders and now
      tested.** The studio's `FOLD_SLIDE` (0.55) pushed the two near-side
      seats' heads clean off the frame when they folded — a seat at ±60°
      recedes outward *and* toward the camera, and both magnify how far
      out it projects; `SPRITE_FOLD_RECEDE` is 0.14 instead. And
      `SeatChair`'s backrest front face sits at z ≈ -0.144, so a figure
      receding to -0.14 landed exactly on opaque, depth-writing geometry
      and disappeared behind its own chair; `spriteSeatOffsetZ` stands the
      quad clear in every pose.
    - **The two near-side seats carry a second, runtime rail fade**
      (`railFadeAlpha` → an alphaMap only those seats mount): the head
      pivot tips their planes' lower halves out in front of the padded
      rim, where the still-opaque lower body won the depth test and
      painted across it. The boundary rides higher toward the plane's
      outer corners (they tip furthest forward) with a deterministic
      ripple; face and shoulders are untouched. UV-space and per-seat
      because the baked fade is shared by all six and the other four sit
      behind the rail correctly. Chasing this also found the *actual*
      hard-edged cutouts in the rim: the near-side `SeatChair` boxes,
      whose backrests jutted across the rail's corner with straight
      depth-tested edges. **Chairs are deleted entirely now** (product
      direction): every figure grounds by fading into the room's shadow —
      the near seats into the foreground pool the raised camera brings
      down the frame, the far seats tucked behind the table's edge.
    - **The camera is steeper for the same reason** (58° landscape / 66°
      upright, raised twice from 46/57): the dark band below the near rail
      reaches further down the screen and swallows the foreground players'
      lower halves, and the board is read from higher up. The upright
      profile's aimDrop rose each time, because a steeper camera converts
      less of the drop into screen-space lift and the felt-rides-high
      contract is test-pinned. Upright also guarantees the seated BODIES
      now (`FRAME.uprightHalfWidth`), not just the felt — half-faces
      sliced by a phone's frame edges read worse than a ~10% smaller
      table — and widening that fit moved the camera far enough back that
      `FOG_SPAN` had to shrink to keep the floor's rim fully fogged (the
      camera recedes from the central crisp points faster than from the
      lateral rim). The near-side pair also carries `NEAR_SIDE_TUCK`
      toward the rail, pulling them out of the frame's corners.
    - **Every seat is recessed behind its origin (`SPRITE_SEAT_OFFSET_Z`
      < 0) — except the local one, which TUCKS TOWARD the table.** At
      slot 0, away-from-table is toward the camera, which projects it
      DOWN the frame: a first cut recessed it like the others and sank
      the player's back into the action HUD. `LOCAL_SEAT_TUCK` carries it
      up-screen instead, parking the crown at the near rail.
    - **The bottom falloff is baked, per-region, and seeded.** A uniform
      vertical ramp fades a sleeve and the middle of a chest at the same
      rate, which the eye reads as a transparency effect rather than as
      occlusion. Real occlusion by a chair and a table edge is uneven, so
      the falloff's start height is a function of distance from the centre
      — torso first, hoodie next, sleeves last, shoulders never — plus a
      low-frequency noise field so the boundary is organic. It lives in
      the build script rather than the loader because no single constant
      expresses it. The noise is `-seed`ed: unseeded, every rebuild emits
      different assets and "regenerate from the originals" stops being a
      check anyone can run.
    - `TINT_FOLDED` is much lighter than the standee's. Not a softened
      signal — the same signal against darker art: black leather and
      near-black hair under a 0.33 multiply went to felt-black, and the
      folded seats read as empty chairs.
    - Motion is the standing "alive, not animated" contract: breathing,
      slow sway, an acting lean, a fold that dims and settles back.
      MeshBasic on purpose (the renders are lit artwork; scene lights
      would grade them twice), and scene fog still applies.
    - The assets are built by `scripts/build-avatar-sprites.sh`, and every
      batch of renders has arrived packaged differently — always *measure*
      a new one rather than trusting how a viewer shows it, because a real
      transparent PNG and a painted "transparency" checkerboard look
      identical on screen. So far: some arrived cut out; some on a solid
      **black plate**, which cannot be keyed (the jacket and hair are
      genuinely black, so a key — or even a corner flood-fill — tunnels
      through the torso) and go through `avatar-silhouette.sh`; and some
      with a checkerboard painted into the pixels plus a **white outer
      glow baked around the silhouette**, which no fuzz removes because it
      is a gradient, so the alpha is eroded 4px instead.
    - Normalisation is on **head height**, not the frame. The rear renders
      are turned closer to profile, so their shoulders are ~40% narrower
      relative to the head — correct for the pose, and not something to
      "fix" by scaling to the silhouette. Normalising the head keeps the
      character one size at every seat while each pose keeps its width.
    - The procedural 3D bust, the old single-image standee and the
      geometric dealer figure were **deleted** once the sprite direction
      was chosen (`git log` has them). The `.glb` path
      (`avatars/player-avatar-3d.tsx`) survives: nothing sets the bridge's
      `avatarUrls` prop today, but it is a wired public opt-in rather than
      dead code.
  - `avatars/player-avatar-3d.tsx` — the no-artwork fallback and the GLB
    path (`useGLTF` + `useAnimations`, cross-faded states, bone
    head-tracking), with the primitive-built figures from
    `lib/game3d/avatars.ts` via `avatars/character-figure.tsx`.
    `avatars/dealer-figure.tsx` is currently **unmounted**: beside
    illustrated characters a primitive-built dealer reads as the
    placeholder the seats stopped being; it returns when the house has
    real artwork. Remote GLB hosts (e.g. Ready Player Me) additionally
    need a CSP `connect-src` entry in `next.config.ts`, which this branch
    deliberately does not touch.
  - `hud/seat-nameplates.tsx` — DOM nameplates over each head, positioned
    by the same pure projection the camera is solved with; folded plates
    follow the standee's small recede.
  - The board is the one oversized card set (`BOARD_CARD_SCALE` in
    `scene/cards-3d.tsx`): flop/turn/river break the life-size rule so the
    whole table can read them, and they are **propped toward the camera**
    (`BOARD_CARD_TILT`, standing on their lower edge so the felt is never
    clipped — the cards lean, not the felt, because chips/pot/hole cards
    live on that surface and pitching the table under a fixed rail would
    shear the room). Watch the orientation parity: a FLAT card needs an
    in-plane half turn to read from this chair; a PROPPED one must have
    none, or all five render upside down. The far seats carry
    `FAR_SEAT_WARM_RIM`, a warm tint grade that lifts their faces out of
    the deep-shadow grounding without touching the lights.
  - `chips/` — the flight *choreography* (bet → own spot; street turn
    sweeps spots → pot; winners funnel out; hand boundary clears instantly
    — the 2D room's exact contract) in `chip-field.tsx`, and the actual
    GPU draw in `chip-instanced-layer.tsx`. Those used to be one file: a
    pile or a flight rendered its own `<mesh>` per chip. They're split now
    because instancing needs a single owner per denomination's shared
    buffer — see that file's header for why two components each calling
    `setMatrixAt` on the same InstancedMesh in their own `useFrame` would
    race with no ordering guarantee. `chip-field.tsx` still owns *which*
    piles and flights exist; `chip-instanced-layer.tsx` is the only place
    a chip's transform is ever written. `chip-stack.tsx` is left holding
    just the shared geometry/material factory (`chipGeometry`,
    `chipMaterials`) both the instanced layer and its own tests build on.
    `lib/game3d/chip-instance-model.ts` is the pure half — resting-pile and
    in-flight chip poses as plain arrays, no three.js import, reachable by
    `npm test`.
  - `scene/cards-instanced.tsx` — every live hole card as instances of
    **one** InstancedMesh sharing **one** atlas material: a single draw
    call for however many cards are in play, replacing what was one
    material per unique card. `lib/game3d/card-atlas.ts` is the pure
    grid/UV-rect math (no three import, tested — including the mismatch a
    naive port could hide: the atlas texture's v-axis has to invert per
    row to match the existing single-card pipeline's `flipY` convention,
    or every card samples upside down); `scene/card-atlas-texture.ts`
    composites the *existing*, already-tuned `cardFaceTexture`/
    `cardBackTexture` canvases into that grid (reusing them rather than
    repainting is what keeps every lesson in `card-textures.ts`'s own
    header — pre-darkened ink, drawn suits, anisotropy — from needing a
    second, atlas-shaped implementation) with a two-pass gutter (each
    cell drawn oversized once, then crisp on top) against mipmap bleed
    between neighbouring cells. A single draw call for N different
    textures needs a THIRD per-instance value stock InstancedMesh has no
    slot for (geometry and material are shared by design; only the
    transform varies) — `cards-instanced.tsx` adds one via
    `material.onBeforeCompile`, an instanced `vec4` UV rect, and one line
    appended after three's own `#include <uv_vertex>`, verified against
    the installed three@0.185.1 source rather than assumed. **Not yet
    checked on a real GPU** — see that file's header; SwiftShader-headless
    can't judge anisotropic/mip artifacts, which this codebase already
    learned once on `card-textures.ts`. `HoleCards`/`CardPlate`
    (`cards-3d.tsx`) are left imported-but-commented in `poker-scene.tsx`
    as an A/B fallback, the same pattern `SpriteAvatar` already uses there
    — an easy revert if the atlas doesn't hold up on a render. The board
    was already DOM-only before this (`hud/board-cards.tsx`); `cards-3d.tsx`'s
    `CommunityCards` was already dead code and stays untouched.
  - `scene/fake-shadows.tsx` — one shared soft-edged disc
    (`THREE.MultiplyBlending` + `premultipliedAlpha: true`, verified
    against `WebGLState.js`'s actual blend-func mapping rather than
    assumed from the constant's name), instanced once per resting chip
    pile and once per seat's hole-card group. `lib/game3d/shadow-decal.ts`
    is the pure sizing/opacity math. This is what grounds chips and cards
    now that neither casts or receives a real shadow — see the next
    bullet for why, and the "Performance notes" section below for the
    trade this makes.
  - `scene/demand-loop.ts` — `useDemandFrame`, the one hook every
    per-frame writer in the two bullets above goes through. See
    "Performance notes".
  - `hud/action-hud.tsx` + `game3d.module.css` — crisp HTML overlay
    (pot, message, Fold/Call/Raise). A CSS module so the numbered global
    cascade is untouched. (The repo does not use Tailwind; the module
    fills that role.)
- `app/game3d/page.tsx` — looping scripted demo; your seat's actions
  branch the script.
- **The published artifact** is `node scripts/build-game3d-artifact.mjs`
  → `dist-artifact/game3d.html`. Its CSP allows no fetches at all, so the
  six seat renders must travel *inside* the page:
  `demo/artifact-sprites.ts` imports them explicitly (esbuild's dataurl
  loader only sees real imports — `spriteSrc` builds its path from a
  template string, which no bundler can follow) and registers them via
  `setSpriteSourceResolver`. Importing that module is the whole API; drop
  the import and the demo renders a table of empty chairs. Verify a build
  by loading `game3d-preview.html` headlessly and asserting **zero**
  non-`file:`/`data:` requests — a missed asset is otherwise invisible
  until the page is published.
- **The floor and the camera-side light are part of the grounding.** The
  seats are MeshBasic and take no scene light, so the old warm
  `directionalLight` — commented as being there "so near faces aren't
  silhouettes" — had been lighting nothing but the floor in *front* of
  the table since the sprite turnaround. That is exactly the band the
  near players dissolve into, and washing it grey turned their falloff
  into a visible flat cut. It is faint and aimed high now, and the floor
  disc is darker to match.

## Performance notes

DPI capped at `[1, 2]`; one 1024px shadow map (for the table/seats/dealer
button — chips and cards are excluded, see below); low segment counts
throughout.

**Chips and cards are instanced, not one-mesh-per-prop.** Every chip
denomination draws as one `InstancedMesh` (6 total, however many chips —
resting or in flight — currently exist), and every hole card draws as
instances of a single atlas-backed `InstancedMesh` (1 draw call for up to
12 cards, replacing what was one material bind per unique card). Both
write their GPU buffers from one place per frame — see `chips/chip-
instanced-layer.tsx` and `scene/cards-instanced.tsx`'s headers for why a
single writer is required once a buffer is shared. `frustumCulled={false}`
on both: the working volume (felt + chip-flight arcs) sits fully inside
this room's fixed camera framing at every supported viewport, so there is
nothing culling would ever remove, and skipping three's automatic
bounding-sphere recompute after every `setMatrixAt` pass is a real cost
saved, not just a risk dodged.

**Chips and cards render shadow-free; `scene/fake-shadows.tsx` grounds
them instead.** They're this room's only *moving* geometry — the table
and seats are static — so a real shadow map would need to re-render on
every chip flight and every dealt card. A flat, unlit, `MultiplyBlending`
disc costs one more instance of one already-shared draw call and zero
shadow-map work. The spotlight's real shadow map stays on for everything
that doesn't move (`Table3D`, `DealerButton`, the seats).

**The Canvas runs `frameloop="demand"`.** It renders only when something
calls `invalidate()`, not on a bare `requestAnimationFrame` tick — no
fan, no battery drain, while the table is idle between hands. An ordinary
React-driven change (a new `SceneModel` prop, a mounted/unmounted child)
already wakes it for free — verified against `@react-three/fiber`'s own
reconciler, which calls `invalidateInstance()` on every commit it makes.
What does NOT wake it on its own is imperative per-frame work: writing an
`InstancedMesh` buffer, or stepping a chip along its flight curve, never
touches the reconciler. `scene/demand-loop.ts`'s `useDemandFrame(callback,
active)` is the one hook that closes that gap — while `active` (a chip
flight in the air), it calls `invalidate()` on every tick it runs, which
schedules the next tick, so the loop self-sustains for exactly as long as
there is real animation and falls silent the instant there is not.
Resting-pile and hole-card updates don't need it at all: they arrive as
ordinary props and ride the reconciler's own auto-invalidate.
