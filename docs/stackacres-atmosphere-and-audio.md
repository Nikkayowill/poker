# StackAcres atmosphere: the visual "Ant Farm" layer and the audio engine

This document is the architecture write-up for two systems that make the farm
feel alive without a movable avatar: the micro-animations layered onto the
isometric grid, and the Web Audio soundscape underneath it. Both already
exist in the codebase, spread across several small, purpose-named classes
rather than one monolithic manager — the second half of this document says
why that split is the right shape and not just how it happened to land.

## 1. The visual layer: no single `AtmosphereManager`, five small ones instead

A single class that owned "every micro-animation on the isometric tiles"
would also own everything from wind sway to predator combat to weather
tinting — unrelated concerns that happen to all draw on a farm scene. This
codebase instead follows the same rule `WeatherOverlayManager`'s own header
states: a self-contained class per concern, each one owning its own
textures/GameObjects and reading numbers from a pure module rather than
deciding them itself, wired into `StackAcresScene`'s `create()`/`update()` in
two lines rather than folded into that file's own dense per-field state.

| Concern | Owner | Pure data it reads |
|---|---|---|
| Wind sway on standing crops | `StackAcresScene.sway()` (private method, not a separate class — see below) | none; a fixed amplitude/period band, randomised per node |
| The vertical "ready" bob | `StackAcresScene.bob()` | none |
| The Mature Pop (scale-bounce + gold sparkle) | `StackAcresScene.popUnit()` + `maturePopGlint()` | none |
| Tap feedback, crit shake/flash, barn-absorb flight | `GameJuiceManager` (`components/arcade/stackacres/game-juice-manager.ts`) | `lib/stackacres/juice.ts` |
| Frenzy Heat Combo streak effects | `FrenzyFxManager` (`frenzy-fx-manager.ts`) | `lib/stackacres/frenzy.ts` |
| Bouncy floating text ("+3 Eggs", refusals) | `StackAcresScene.floatAt()` | caller supplies the string |
| Bouncy Gold/Influence bursts from a sheet (Town Contracts, the Workshop) | `ContractPayout` (DOM component, `contract-payout.tsx`) | `lib/stackacres/juice.ts`'s `goldTickerValue` |
| Idle wildlife (peaceful creatures wandering, fleeing on interaction) | `WildlifeManager` (`wildlife-manager.ts`) | `lib/stackacres/wildlife.ts` |
| Weather tint, solar dust, rain streaks | `WeatherOverlayManager` (`weather-overlay-manager.ts`) | `lib/stackacres/weather.ts` |

Why `sway`/`bob`/`popUnit`/`maturePopGlint` are private methods on the scene
rather than their own class: they act directly on a `UnitNode`'s own
`container`/`sprite`/`tweens`, the same private per-unit state `growCrop`,
`destroyNode` and every other per-unit method already reaches into. Splitting
them into an external manager would mean either exposing that internal node
shape to a second class or duplicating it — the exact "two owners of one
private field block" problem `WeatherOverlayManager`'s own header explains
its separateness *from*. A concern gets its own class when it owns state
nothing else touches (a rain-streak pool, a predator's health); it stays a
method on the scene when it only ever mutates a `UnitNode` the scene already
owns outright.

### The four requirements, and where each one actually lives

**Wind Ripple Effect.** `StackAcresScene.sway()`: a slow rotation tween on
the crop *sprite* (not its container, so the shadow/soil collar underneath
does not tilt with it), amplitude and period both randomised per node so a
bed of ready crops doesn't move in lockstep. Runs alongside `bob()`'s
existing vertical lift; the two together read as a plant standing in a
breeze. Wired into both places a crop can reach `"ready"`: the smooth
in-place stage transition (`growCrop`, the common path during play) and the
full-node rebuild path (`buildUnit`).

**The Mature Pop.** `popUnit()` (pre-existing squash-and-stretch scale
bounce, reused rather than rebuilt) plus the new `maturePopGlint()` — three
to four motes of the sunlight system's own baked gold sparkle texture
(`bakeSparkle`, no new asset), scattering outward and fading. Fires exactly
once, on the frame a unit's `state` crosses into `"ready"` — both call sites
capture the *previous* state before it's overwritten so a crop merely
repainted for an unrelated reason (a muck cycle, a clock tick that changed
nothing about readiness) never re-fires it.

**Bouncy Economy Pops.** Two systems already covered this before this pass,
for the two different places Gold/produce is actually earned:

- A harvest has a tap position, so it answers in the *world*: `floatAt()`
  lifts, tilts and fades a produce line ("+3 Eggs") right out of the tapped
  unit. StackAcres does not pay Gold on harvest at all — produce goes to the
  barn, and Gold only comes from selling — so a "+250 Gold" float on harvest
  would misrepresent the actual economy rather than illustrate it.
- A sale or a contract is settled from inside a sheet, over a scrim, with no
  tap position to answer — `ContractPayout` (a DOM component, not a canvas
  effect, precisely because of that) renders a count-up Gold/Influence
  ticker plus a fourteen-mote particle burst anchored to the row that was
  pressed. This pass wired the same component into the Workshop's sell
  button, which previously only got a plain text toast; Town Contracts
  already had it.

**Idle Wildlife Spawners.** `WildlifeManager` already runs this: two
fixed-cost pools (peaceful creatures by day, predators by night, the same
"allocate once in `create`, never grow" rule `sunlight.ts`'s and `weather.
ts`'s own particle pools follow), wandering the grow area and fleeing when
approached or when their tile is worked. No placeholder-vs-final-art
distinction was made in the original ask, and none is made here — the
creatures are currently plain Phaser shapes (no butterfly/firefly art yet),
which is a content gap, not an architecture one.

## 2. The Web Audio Engine

Three layers, three files, none of them aware of the other two's internals:

```
lib/stackacres/ambience-plan.ts   -- pure data: bed mixes, cue tables, timing
        |
        v
lib/audio/synth-voices.ts         -- pure synthesis: every voice, as a graph builder
        |
        v
lib/audio/stackacres-ambience.ts  -- the one AudioContext, the scheduler, the mute switches
        |
        v
lib/audio/stackacres-sfx.ts       -- intent-named callers ("sowSound()"), one per gesture
```

`lib/audio/stackacres-music.ts` is a fourth, independent layer: three
recorded loops (`day.mp3`/`dusk.mp3`/`night.mp3`) played through a plain
`<audio>` element rather than the shared `AudioContext`, deliberately kept
separate from the synthesised ambience below it (see that file's own header
for the ASMR-not-music distinction). It was not touched by this pass.

### Ambient Bed

`Ambience` (the class inside `stackacres-ambience.ts`) holds three
continuous beds — `grass` (silenced, see its own comment for the three
separate times reinstating a wind-shaped bed was tried and cut),
`water`, `insects` — crossfaded on a 4-second ramp whenever the hour
(`AmbienceTimeOfDay`) changes. Every bed is *filtered noise driven by a
random walk*, never a loop: `synth-voices.ts`'s own header explains why a
file-based ambience bed is the one thing this layer cannot afford — a loop
under a quiet game is a seam a player will eventually hear, and once heard,
never stops hearing.

Sparse one-shot cues (birds, crickets, frogs, the two mechanical creaks) are
scheduled on a look-ahead clock booked against the *audio* clock, not
`setTimeout`, so nothing is subject to main-thread jitter from a district
rebuild. Each cue rolls a fresh gap inside its own min/max range after every
firing — a period would be a metronome, and the whole brief is "not beats."

### Contextual Audio Layers

Two independent axes, both added in this pass, both ramped on their own
dedicated bed rather than folded into the tod crossfade above:

- **Weather.** `setAmbienceWeather("rain" | "clear")`, driven by
  `WeatherOverlayManager.getActiveWeather()` (already existed, previously
  unread by anything) via a new `StackAcresScene.getAudibleWeather()`
  passthrough that also collapses to `"clear"` when the Greenhouse has
  hidden the visual rain, so audio never contradicts what's on screen. Rain
  fades in a `rain` bed (brown noise, wide highpass, no band-pass peak —
  broadband, unlike the other three) over 3 seconds, ducks `insects` to 20%
  of its usual level, and pauses (never fully stops) the birds/pigeon/crow
  cues until the shower clears.
- **The wet sector.** The original ask named "Sector 2 (The River Plot)" —
  that sector does not exist in this game (sectors are `farmstead`,
  `henhaven`, `oxfields`, `wallow`, plus four reserved-but-unbuilt
  districts; the only water feature, the Farmstead's own pond, is home
  ground and unlocked from the start). The closest real analogue is
  `wallow`, the one sector actually gated behind a Gold unlock. Clearing it
  now fades in a `river` bed — a higher, more restless cousin of `water`,
  same synthesis family, faster random walk — over 8 seconds, gated on
  `isSectorUnlocked("wallow", sectors)`. This is deliberately a *permanent,
  farm-wide* fact, not a "how close is the camera" one: the ambience mix
  stopped varying by district for a tested reason (`ambienceMix`'s own test
  file pins "does not vary by district: the mix is one property of the hour
  now"), and gating a bed on current camera position would be exactly that
  regression under a new name.

### Tactile Feedback (SFX)

`lib/audio/synth-voices.ts` synthesises every action cue from oscillators
and filtered noise rather than files — zero bytes fetched, and a voice
re-rolled slightly on every firing never wears out the way a fixed sample
would. This pass added three:

- **Planting** — `sow-seed` (the existing granular scatter) followed 160ms
  later by the new `dirt-pat` (a soft, heavily-damped low thump under a dark,
  lowpassed noise burst — no bright top end, which is what keeps it from
  reading as `post-hammer`'s knock).
- **Harvesting** — the new `leaf-snip` (a bright, swept cut transient plus a
  softer rustle release) now plays before `harvest-pour` on every crop
  collection, the same two-beat "the cut, then the produce landing" shape
  livestock collection already had with its animal call.
- **Prestige** — the new `prestige-chime` (a three-note chord, staggered and
  each note lightly vibratoed, plus a glassy high shimmer built the same
  inharmonic-partial way `farm-bell` is) now plays on a confirmed Prestige
  Reset, which previously had no sound at all.

### Loop safety and memory, end to end

- **No file ever loops.** The only recordings in the ambience layer (two
  mechanical creaks, four animal calls) are one-shot samples fired on a
  rolled gap, never `loop = true`; the only *looping* buffers are the
  10-second white/brown noise beds in `synth-voices.ts`, crossfaded at their
  loop point by design (see `noiseBuffers`'s own comment) specifically
  because noise has no recognisable event in it for a loop seam to betray.
- **Every transient node disconnects itself.** A cue's gain-and-filter chain
  is torn down `setTimeout`'d against its own computed `stopAt`; a sample's
  `AudioBufferSourceNode` disconnects `onended`. Nothing here accumulates
  across a long session.
- **Sample fetches are lazy and deduplicated.** `ensureSample` fetches one
  recording once, the first time it could plausibly be needed (an animal
  actually owned, a cue about to fire), tracked in a `Set` so a second call
  is a no-op — an empty farm fetches nothing.
- **The whole graph tears down on `stop()`**, including this pass's two new
  beds: every `RandomWalk`'s interval is cleared, every bed source is
  stopped, the buffer cache is dropped, and the `AudioContext` itself is
  closed rather than left running behind a component that has unmounted.
- **Two independent mute switches, on purpose.** The farm's own toggle
  (`StackAcresMusicToggle`) mutes the music track and the ambience bed/cues
  together, as one control; the app-wide SFX mute reaches only the farm's
  *action* sounds (`setFarmSfxMuted`) through a separate bus that hangs off
  the destination directly. Muting the birds should not also mute a tap
  landing, and muting a tap landing should not require finding a second
  button for the birds.
