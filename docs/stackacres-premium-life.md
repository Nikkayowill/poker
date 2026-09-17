# StackAcres premium life: design

Written 2026-09-16 after research into Phaser 3.90's source, Stardew Valley's decompiled lighting and
critter code, other pixel-art games, iOS WebGL limits and this repo's hooks. It follows Kayo's direction
in `art/stackacres-td/PIPELINE.md` ("Depth through movement and polish"): texture is done, so life comes
from motion, light and expression, run in the engine, never at the cost of what a young player has to tap.

## Status

2026-09-16, branch `feat/stackacres-rich-art`, uncommitted: phases 1-4 are built and checked in the real game on
a memory-mode dev server (review page: https://claude.ai/artifact/PWYF1hH66dMH6nEr9311Kg). Cloud shadows are built
but off (`scene.setCloudShadows`) until Kayo decides. Portraits (phase 5) are next.

Dev previews: `window.__stackacres.scene.setClock(hour)` pins the time of day; `setCloudShadows(true)` shows clouds.

## Ground rules

- **In the engine, not in baked frames.** No new pre-rendered ground frames. The only baked animation
  stays the 4 water frames that already ship. Everything else is sprites, a fixed pool of them, created
  once per area. iOS Safari kills a tab around 224-256 MB of canvas memory, and StackAcres has already
  run an iPhone 14 out of memory once (baked canvases, not draw calls).
- **Whole art pixels.** Every moving thing is snapped to art pixels, like the farmer and the camera
  already are. No rotation (NEAREST rotation makes pixels crawl), no blur, no soft gradients.
- **Real time, not frames.** iOS Low Power Mode throttles to 30fps without telling the page, and Phaser
  pauses its loop in a hidden tab. Motion is driven by elapsed milliseconds; the time of day reads `Date`.
- **WebGL first, Canvas safe.** `Phaser.AUTO` can fall back to Canvas, where post-FX and pipelines don't
  exist. Every effect here is a plain sprite or rectangle with a blend mode, so the fallback is the same
  object at a lower alpha or simply off.
- **Readability.** Tap targets never move. Ambient motion stays out of a 24px ring around every tagged
  prop, NPC and the player's crops and hens, and draws below cue bubbles. Night never darkens so far that
  a tap target loses contrast, and window light makes the yard warmer, not harder to read.
- **Reduced motion.** `prefers-reduced-motion` turns off sway, critters, falling leaves and drifting
  shadows (WCAG 2.2.2 exempts only essential motion). The day/night tint stays (it changes minutes apart),
  and so do cues, the walk and action animations.
- **One owner per concern**, each reading numbers from a pure module, like the isometric layer did
  (`docs/stackacres-atmosphere-and-audio.md`).

## The pieces

| Concern | Owner (components/arcade/stackacres-td/) | Pure data (lib/stackacres-td/) |
|---|---|---|
| Day/night grade, window and lantern glow | `daylight-layer.ts` | `daylight.ts` |
| Wind sway of canopies, reeds, flowers | `wind-sway.ts` | `wind.ts` |
| Grass that rustles as the farmer walks through | `wind-sway.ts` | `wind.ts` |
| Butterflies, dragonfly, birds and their shadows, fireflies, falling leaves, fish jumps, chimney smoke | `ambient-life.ts` | `ambient.ts` |
| Drifting cloud shadows (behind a flag until Kayo signs off) | `ambient-life.ts` | `ambient.ts` |
| NPC idle breathing and blinking, turning toward the farmer | `scene.ts` via the rig's new `idle` tag | `ambient.ts` (blink cadence) |
| Hens pecking and turning in place | `scene.ts` | `ambient.ts` |
| Emotes over people | `scene.ts` + a new world-contract method | `ambient.ts` (emote list) |
| Dialogue portraits | the shell's dialogue components | a portrait rig in `art/stackacres-td/rich/` |

### Day and night

The clock already exists: `timeOfDay()` in `lib/audio/stackacres-music.ts` (day 6-18, dusk 18-21, night
21-6, local time), which the shell pushes to the map every minute through `setWildlifeTimeOfDay` (a no-op
in the top-down scene today). The grade needs a continuous curve, so `daylight.ts` maps a `Date` (or a
dev override hour) to keyframed values, interpolated minute by minute:

- dawn 5-7: warm pink lift fading in; day 7-17: neutral; golden hour 17-19: warm amber;
  dusk 19-21: violet; night 21-5: cool blue.
- Stardew's lesson: night is a blue *subtraction* (its evening colour removes red and green), deepened
  gradually over two hours, never a snap. Our darkest multiply is capped well above Stardew's 0.93.
- Lamps (Stardew's light map): window, porch lamp and barn lantern positions are exported per area as
  light points. At dusk and night each gets a small pixel-art glow sprite in ADD, alpha tied to darkness,
  inside the god-ray budget that already shipped once (`GOD_RAY_MAX_ALPHA` 0.08 as the day ceiling).

The grade is one full-screen rectangle fixed to the camera in MULTIPLY, drawn above props and people
and below cue bubbles (which are UI). Canvas fallback: the same rectangle in NORMAL at a lower alpha.
Previewing: a dev-only `window.__stackacres.setClock(hour)`, since the Chrono harness only scales timers.

### Wind

Stardew doesn't sway its trees (mods add it), but it does shake grass when you walk through it, and
that player-caused motion is the part that reads as premium. Both, crisp:

- Export splits every broadleaf tree, spruce and bush into a trunk frame and a canopy frame. The canopy
  image moves 1 art pixel left and right on a slow sine (3-5 s), phase-shifted per tree, with gusts
  that ripple across the map from west to east. Reeds, tall grass decor and flowers get the same.
- Walking within a few pixels of tall grass or reeds plays a short 1px shake on that sprite.

### Ambient life

A fixed pool (at most 20 sprites per area), placed only in exported "ambient" regions: open grass and
the pond, minus the 24px ring around tap targets. Rare and tied to time of day, like Stardew's critters:

- day: 2-3 butterflies drifting on noisy paths, a dragonfly darting over the pond, a bird crossing now
  and then with a shadow offset on the ground, a fish jump with a ripple ring;
- golden hour and dusk: leaves falling from broadleaf trees on gusts;
- night: a handful of fireflies over the meadow and pond (small ADD glow, blinking).
- chimney smoke becomes rising, fading puffs instead of 4 baked frames.

Cloud shadows: Kayo removed the isometric map's soft cloud-shadow "sweeps" twice (commit 30d41a24).
These are different (hard-edged, dithered pixel shapes, MULTIPLY at low alpha, drifting slowly), but
they stay behind a flag and ship only after he sees them.

### People and hens

- The rig gets an `idle` tag appended after `shoot` (so STANDING frames 1/5/9/13 don't move): a 1px
  breath (head and torso, feet planted) and a blink frame. Played with irregular holds, blinks every
  3-4 s, so the cast never breathes in sync. NPCs turn to face the farmer when he comes close.
- Hens are tap targets, so they never leave their spot: they peck, turn and fluff in place.
- Emotes: small bubble icons (heart, exclamation, question, music note, sleep, sweat, sparkle) from the
  common atlas, over a person's head for about a second and a half. A new world-contract method lets the
  shell trigger them from dialogue and gifts. Stardew's emote set is the reference.

### Portraits

Stardew uses 64×64 portraits with a standard set of expressions. The traveler dialogue already has a
portrait slot (`stackacres-story-dialogue.tsx`, 48px, pointing at old full-body webps), and Ray's welcome
has a 104px one. Plan: a portrait rig in `rich/` drawing 64×64 busts for all 14 people from their rig
roles and ramps, in neutral, happy, sad, surprised, thinking and love, shown at integer scale.

## Order

1. **Foundation:** export the rich Homestead, Old Fields, characters and the game's common sprites
   (soil tiles, crops, hens, cues) into `public/stackacres-td`, and compress them.
2. **Light and air:** daylight grade and lamp glows, wind sway and grass rustle, smoke puffs, the
   reduced-motion switch and the dev clock.
3. **Critters:** butterflies, dragonfly, birds, fireflies, falling leaves, fish jumps; cloud shadows
   behind their flag.
4. **People:** idle breathing and blinking, facing the farmer, hens in place, emotes.
5. **Portraits** and their dialogue wiring.

Each phase is checked in a real browser at phone size before the next starts.

## Sources

- Stardew lighting and critters: decompiled `Game1.cs` (1.5.6), `Grass.cs`; stardewvalleywiki.com
  (Animals, Modding:NPC data, Multiplayer/Emotes).
- Eastward colour LUTs (Pixpil devlog), Sea of Stars and Kingdom lighting write-ups.
- iOS canvas memory limits and resize leaks (Apple developer forums 112218, 668999); Low Power Mode
  rAF throttling (WebKit bug 168837).
- WCAG 2.2.2 and 2.3.3 (motion), technique C39 (prefers-reduced-motion).
- Phaser 3.90 source: `Config.js` (pixelArt forces NEAREST), `CreateRenderer.js` (Canvas fallback),
  `BlendModes.js`, `Game.js` (pause on hidden), `PipelineManager.js`.
