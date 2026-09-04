# StackChips — Claude Context

## Project

StackChips (`stackchips.app`) is a Next.js 16/React 19/strict TypeScript six-max Hold'em app. The server is authoritative. Supabase supplies persistence, Realtime, Auth linkage, and Storage; absent env vars, stores use memory.

## System map

`components -> app/api -> lib/game -> lib/server -> memory | Supabase`

Realtime carries only versioned invalidations; `components/poker-app.tsx` refetches the filtered snapshot. Browser requests contain intents only.

## Read first

- App/client: `app/layout.tsx`, `app/page.tsx`, `components/poker-app.tsx`
- Lobby/table: `components/lobby/lobby.tsx`, `components/table/poker-table.tsx`
- Game routes: `app/api/games/`, especially `[id]/actions/route.ts` and `[id]/advance/route.ts`
- Rules: `lib/game/engine.ts`, `lib/game/types.ts`, `lib/game/evaluator.ts`
- Data: `lib/server/game-store.ts`, `lib/server/profile-store.ts`, `lib/server/supabase-admin.ts`
- Auth: `middleware.ts`, `lib/server/session.ts`, `lib/auth/client.ts`
- Realtime: `lib/game/table-channel.ts`
- DB/env: `supabase/migrations/`, `supabase/config.toml`, `.env.example`
- Product constraints: `docs/game-loop.md`, `docs/launch-checklist.md`, `docs/security-audit.md`
- Farm (StackAcres, formerly "Homestead" — DB objects still say `homestead_*` on purpose):
  `lib/stackacres/`, `components/arcade/stackacres/`, `app/api/stackacres/`

Subsystem-specific gotchas moved out of this always-loaded file into where they load on demand:
`lib/scene/CLAUDE.md` (2D table), `lib/scene/chips/CLAUDE.md` (chip system), `app/styles/CLAUDE.md`
(styling contract), and the `deploy-checklist` skill (pre-merge/deploy).

## Rules

- Mutate through server routes + engine; never accept client-owned game truth.
- Keep game reads write-free and mutations version-checked/atomic.
- Never leak service-role secrets or private aggregate state; preserve RLS.
- Append migrations; preserve numbered CSS order.
- `river_*` cookies/module names and Sentry slugs are legacy compatibility IDs; do not casually rename them.
- Test changed rules/layout. Run: `npm test`, `npm run lint`, `npm run build`; use `npm run test:e2e` for flows/UI.
- Preserve unrelated work; `.claude/` may be locally untracked.
- **This checkout is shared by several concurrent sessions. Do your work in your own worktree**
  (`git worktree add -b <branch> .claude/worktrees/<name> origin/main`), never on a branch in the
  primary tree. Branch-level and destructive git there (checkout/switch/merge/rebase, stash/reset/
  clean/restore, `git add -A`, `git commit -a`) is refused by `.claude/hooks/guard-shared-worktree.sh`,
  because those land under whoever else is mid-task rather than staying local. Reads are always fine;
  `ALLOW_SHARED_TREE=1` in the command is the deliberate override.
- Commit messages and PR descriptions: short and plain, like a person telling a coworker what
  changed. No em-dashes, no comma-chained "did X, Y, and Z" example lists. Say what changed and why
  in a sentence or two, not an essay. New code comments get the same treatment: a short "why" where
  it's non-obvious, not a paragraph. (Any attribution footer the harness itself appends is separate
  from this and not something to strip — this rule is about the words, not the footer. This history
  log below is the one deliberate exception on length — it's a dense project changelog by design, see
  its own note partway down — but PRs, commits, and code comments are not.)

## Active milestone

- No single tracked milestone or "current feature branch" — this repo runs many parallel sessions on
  many worktrees/branches at once (`git branch -a`, or `gh pr list` for what's open). Read the most
  recent dated entries below for what's actually in flight; don't trust this line to name it.

### StackAcres crops are watered, and drawn far bigger than the rest of the world (2026-09-04)
Two changes to the crop track, one loop and one visual. **Watering** is the deliberate mirror of the
livestock hunger mechanic that has existed since the first migration, built by copying its shape
rather than inventing a second one: `thirstMs` on the catalogue (crops only, `null` for livestock,
exactly as `hungerMs` is the reverse), `last_watered_at` on `homestead_units`, an
`isStackAcresUnitDry` guard checked beside `isStackAcresUnitHungry` inside
`isStackAcresUnitReady`, and a version-guarded `waterStackAcresUnit` write that pushes `ready_at`
forward by however long the soil stood dry. **The one deliberate divergence from hunger is the
load-bearing line: a crop that finished growing BEFORE its ground dried is never dry.** Mirroring
hunger exactly here was a real bug, caught by probing the case rather than by any test asking for it
-- a ripe, uncollected row went dry, stopped being collectable, and watering it then pushed `ready_at`
forward by the drought, UN-RIPENING finished produce and charging the player again for time already
waited. Hunger genuinely does behave that way (a ready cow that goes hungry must be fed before it is
milked) and it is defensible there, because a neglected animal stopping is the point; it is not
defensible for produce already grown. The test is `readyAt <= thirstyAt`, compared against
`thirstyAt` rather than `now` so it is a fact about the row settled once rather than something that
flips as the clock moves -- and so it cannot recurse into `isStackAcresUnitReady`, which calls it.
`withLocalClock` in the component carries the same carve-out or a ripe row flickers to dry between
refetches.

A `/code-review` pass caught three more, all real and all fixed. (1) **`collectStackAcresUnit`'s
permanent-restart branch never reset `last_watered_at`**, so a Gold-bought crop re-sowed itself dry at
progress 0 carrying the previous cycle's watering, and the only available fix -- one Water tap -- then
added the entire stale gap to `ready_at`, turning a 15-minute cycle into however long the unit had sat
ripe. It now re-waters on restart, keyed off the row's own value so the store needs no catalogue
import; `last_fed_at` deliberately still does NOT, and the asymmetry is the point (an animal can be
fed any time, a crop cannot be watered until it is actually dry). (2) **The migration backfill used
`started_at` and had to become `now()`.** Since `thirstMs` is under `durationMs` for both crop kinds,
`started_at + thirst` always precedes `ready_at`, so the ripened-before-the-drought carve-out could not
protect a single legacy row -- every already-ripe crop would have flipped to `dry` at deploy and
un-ripened itself on the first Water tap. Checked against the live table: all seven working crop rows
were already ripe, so that was 100% of the real data. The cost of `now()` is one free thirst window per
in-flight crop, once, which is the cheaper side by a wide margin -- the original comment arguing the
other way was wrong. (3) **`unitAt` now ranks an art hit above a ground-diamond hit**, because a ripe
crop's diamond doubled to 48 units in a 136x118 interior holding up to six of each kind; on depth alone
the front crop swallowed the tap target of everything behind it. Depth still settles hits of the same
kind, which is the case that rule was written for. Also: watering wet ground is a NO-OP rather than a
400 (a phone whose clock runs fast paints the Water button itself, and erroring on it is unactionable
-- nothing is written, so nothing can be farmed), and `FOOT_INSET` now measures to the bottom of the
INK rather than the path, since a stroke is centred on its own line and measuring to the path
over-corrected and buried the stem. Three things worth keeping: (1) **watering is free** --
it costs attention, not Bushels and not Gold -- so it touches none of the money-ordering rules and
has nothing to refund when its guarded write loses a race, which is the one way it differs from
feeding; the currency-wall test's route-action list was extended to say so out loud. (2) **A dry
crop's progress bar is read at the moment the soil dried, not at `now`** -- `progressOf` takes an
explicit `atMs` for this. Without it a frozen crop's bar creeps to full and then sits there looking
finished while readiness refuses it, which is exactly the "trains people to tap a unit that cannot
pay yet" failure `growthStage`'s own comment in `world.ts` warns about. Hunger does NOT do this and
was deliberately left alone (out of scope, and its bar is a smaller lie on a longer cycle). (3)
**`lastWateredAt: null` on a crop means "row predates the column", not "bone dry"** -- it falls back
to `startedAt`, since sowing waters the ground; reading it as dry would have frozen every crop in the
field the moment this shipped. Watering wet ground is refused (`400`) rather than treated as a
top-up, or the thirst clock could be reset for free all day.

**Crop sprites are now drawn well off the world's own scale**, and this is a deliberate break with
everything else on the map (which all draws at `1 / ART_SCALE`): a ripe carrot is a 12x16 unit box of
mostly leaf, and at the opening shot's zoom on a phone in landscape it is a few pixels of green
indistinguishable from a row sown a minute ago. Sprout 2.5x, mature 4x, seedling 1.6x (the third
number was not specified and is an interpolation -- leaving it at 1x next to a 2.5x sprout makes the
first frame invisible and the second look teleported in). The arithmetic lives in a new
`lib/stackacres/crop-visuals.ts` rather than in the scene, for the reason `units.ts`'s header already
states: vitest only reaches `lib/` and `app/`. Two non-obvious pieces there: a painter anchors at
(0.5, 1) and Phaser scales about that origin, so a frame whose ink starts above its own box's bottom
edge (carrot0/carrot1, whose leaves spring from y 15 in a 16-tall box) FLOATS once scaled --
`cropGroundOffset` pushes it back down by the growth in that gap, and is 0 for every frame already
drawn to its baseline; and the tap footprint (`unitFootprintHalf`, previously a flat 12 for crops)
now tracks the sprite but keeps 12 as a FLOOR, since 1.6x of a 6-unit half is 9.6 and shrinking the
target of the hardest crop to see would be exactly backwards. Verified live in memory-mode `next dev`
against a real browser, not just in tests.

**Migration applied 2026-09-04** (`stackacres_soil_watering`, remote version 20260904123755) --
verified by querying `information_schema` before and after, with a clean `get_advisors` security pass
(everything it reports is pre-existing: this app's deliberate service-role-only
`rls_enabled_no_policy` posture, and the known leaked-password warning). Applied BEFORE the code
merged, which is the safe direction *here and only here*: the column is additive and nullable, and
the deployed `UNIT_COLUMNS` names every column explicitly rather than selecting `*`, so a running
production build could not see it. Both column lists -- the old deployed one and this branch's -- were
run against the live table to prove it.

**It was closer than it should have been, and the lesson is worth keeping.** PR #303 was merged at
12:36:35Z while the migration was still being applied at 12:37:55Z -- an 80-second window in which
`main` held code selecting a column that did not exist. No outage happened only because Vercel's
production deployment for that merge was not created until 12:38:35Z, 40s after the column landed
(confirmed: zero ERROR/FATAL rows in `postgres_logs` across the window, live site 200, and
`/api/stackacres` returning its 401 access lock rather than a 500). The deploy-checklist rule "a
migration and the code that calls it are one change" means APPLY FIRST, THEN MERGE, and the gap was
luck rather than sequencing -- the merge was not this session's to time.

**Live schema drift found while applying this**: the remote carries a migration
`stackacres_units_fix_extra_slots_ambiguous` (version 20260904023339) with NO file in
`supabase/migrations/`. Someone applied a fix directly without committing it, so a database rebuilt
from this repo alone would not have it. Unrelated to this pass and deliberately left alone -- but it
wants its own file. See `[[reference_stackchips_migrations_not_auto_applied]]`.
### StackAcres got a soundscape: a synthesised ASMR bed, farm SFX, real animals (2026-09-04)
Kayo: "better sound effects and music... animal noises and just ambient noise around the farm thats
more ASMR like. not beats." The farm had **three music tracks and nothing else** -- every action on
the map, from collecting eggs to paying 60,000 Gold for a cow, answered with the app's one generic
chrome click, and there was no ambience at all.

**The ambience is SYNTHESISED at runtime, not looped from files, and that is the load-bearing
decision.** A ten-second ambience loop under a quiet game is heard inside a minute, and once a player
has found the seam they cannot unhear it -- which is the end of the calm the layer exists for. Five
continuous beds (`air`/`wind`/`grass`/`water`/`insects`) are filtered noise whose filter frequency and
level are driven by a **random walk, never an LFO**: an LFO at 0.05Hz repeats every twenty seconds,
which is well inside the time a player stands still on this map. Sparse cues fire on a **rolled gap
inside a range** rather than a period, which is the other half of "not beats" -- a cricket every 4.0s
is a metronome, one every 2.5-7s is a field. Same call as the art: this farm paints its pictures at
boot rather than downloading sprites, and now it makes its noises the same way. `lib/stackacres/
ambience-plan.ts` is pure and tested (16 tests) and holds every level and timing; `lib/audio/
stackacres-ambience.ts` owns only the graph and the clock; `lib/audio/synth-voices.ts` is the
instrument (23 voices). The mix follows **time of day AND district** -- the Ox Fields are the windiest
place on the map and the Wallow the wettest, asserted by test so the districts stay tellable apart by
ear -- and follows **the animals you actually own**: standing in Ox Fields with no cattle sounds like
empty ground, with three it sounds like you keep cattle (`livestockCue`, damped on a square root, so
a herd is one herd and not three soloists).

**Only six sounds are recordings, and the reason is the rule for adding more.** Higgsfield's free plan
had 10 credits and its CLI cost estimate is **wrong by ~10x** (quotes 0.1 credits, actually charges
~1), which was found the expensive way: a 32-prompt batch spent 6.5 credits, returned 6 usable files,
and the rest failed at submission. So the credits went where synthesis genuinely fails -- a throat, and
resonant timber under load: `cow-moo-near`, `hen-cluck`, `hen-fuss`, `sheep-bleat`, `gate-creak`,
`windmill-creak` (224KB total, denoised/trimmed/normalised, in `public/audio/stackacres/sfx/`). A
generated `rooster-crow` came back as flat noise and was **dropped rather than shipped**. Everything
made of tone and noise -- chirps, crickets, a struck bell, water drops, and every action sound -- is
synthesised, which is also better than a file for a cue heard two hundred times a session, because
every firing differs. **`pig` is a SHEEP** (`label: "Sheep Pen"`, yields Fleece) -- checked before
generating, or the middle livestock tier would have got an oink.

**Action sounds now say what happened.** `lib/audio/stackacres-sfx.ts` names them by intent the way
`ui-sounds.ts` does: sowing patters, collecting is the animal answering and then grain pouring, muck
is a wet scrape, the exchange window is the only place coins are heard, the scythe swishes (throttled
to one per sweep -- `mowSegment` runs on every pointer-move and unthrottled it was a machine gun).
**A refusal is a dull knock on wood, deliberately not a buzzer**: most refusals here are "you cannot
afford that yet", and a harsh tone on an ordinary event teaches a player to dread their own farm.

**Levels were measured, not guessed.** Rendered through a real Chromium `OfflineAudioContext`, the 23
voices spanned **22dB** at a nominal gain of 1 (`post-hammer` -11dBFS, `panel-slide` -32.7) -- so a
call site asking for "gain: 0.9" got whatever the recipe happened to produce. `VOICE_TRIM` brings
actions to ~-14dBFS and cues to ~-18, **spread now 8dB**, with cues sitting under actions by design.
Re-measure if a recipe changes.

Two bugs fixed in passing, both in code this pass touched: the HUD speaker **negated the toggle's
return value twice**, so it painted the state it had just left, and it never read the stored
preference, so a player who muted the farm came back to a speaker icon over silence -- now
`useStoredPreference`, the app's own idiom for a stored value driving a module outside React. And the
farm was calling `useArcadeSound({gameSounds: true})`, eagerly fetching the **poker table's ~450KB cue
set** on a route that plays none of it; the two calls needing it now have farm sounds of their own.

Mute is one switch (music + ambience together -- both are "the noise this place makes", and two
sliders is a settings screen); action sounds follow the app-wide SFX mute instead. The graph suspends
on tab-hide.

**The wind bed was mixed too loud and was caught by ear, not by a meter.** Kayo reviewed the whole set
from a click-to-hear bench (https://claude.ai/code/artifact/3d4922d5-7623-4ed7-8702-248d8c02521f,
which runs this branch's own compiled `synth-voices.ts`, so it is the real sounds rather than a
mock-up) and flagged wind alone. He was right and the cause was structural: wind's gust walk peaked at
**1.0 where every other bed tops out near 0.5**, so on the Ox Fields (wind x0.92) it sat ~5dB over the
rest of the mix. Now 0.09..0.55 -- **both ends scaled by the same 0.55**, since cutting only the
ceiling would have narrowed the gust from a 6x swing to a 3x one and cost the bed the variation that
makes it read as weather instead of a fan. Worth keeping as a rule: the per-voice trims were measured,
but the BED levels never were -- they are relative gains against each other, so the only instrument
for them is somebody listening.

Verified live, not just built: `next dev` in memory mode with a minted session and a real access
grant, driven in Chromium at 1280x720. AudioContext running, **zero console errors**, and the
soundscape provably changes with the clock -- at night 1 oscillator / 37 noise sources (crickets), at
a pinned midday 13 / 6 (birds), the exact inversion the plan describes. Full `npx vitest run`
2828/2829 (the one red is the pre-existing PR #163 `table-anchors` regression), `npm run lint` and
`npm run build` clean. Branch `feat/stackacres-audio`. **Still open:** the music itself is untouched
(the three tracks are ~3min each and regenerating one costs more than the whole credit balance), and
there is no duck, goose or rooster -- the pond has ducks on it that make no sound.

### StackAcres is tapped on the map itself; the sidebar became deep management (2026-09-04)
Removes the loop the district sidebar had become (tap a district -> panel opens -> find the row ->
press Collect). A tap that lands on a unit's own picture now collects, feeds or clears it where it
stands, and a tap on a district's bare fenced ground drops a small radial seed menu beside the
finger. `place` follows the finger instead of gating it, and **the drawer no longer opens on
travel** — the chrome pass above landed `sa-panel-tab`, a named peg on the right edge, and that
(plus the ring's own handoff) is the way back in; a `Manage` key in the zoom group was built for
this first and then deleted on the rebase rather than left beside the peg as a second door to the
same room. The drawer now leads with the Gold decisions (buy outright, expand capacity) rather than
the unit list. **The unit rows were deliberately NOT deleted** despite the drawer being reframed as
deep management: the canvas is `aria-hidden` and they are the only keyboard/screen-reader path to
what a tap does, plus they carry the one action a tap must never reach (retiring, which refunds
nothing). Five things worth keeping: (1) the hit test is **hand-resolved at pointer RELEASE inside
the scene's existing gesture pipeline, not `GAMEOBJECT_POINTER_DOWN`** — Phaser input is off
entirely here and a second input layer would double-handle every press, and a press-time hit would
collect a unit the moment a pan that happened to start on a hen began. Two regions per unit (its
sprite bounds, since a cow's body is drawn well above its feet; and its ground diamond, which makes
the ready-ring a target), padded by a fingertip in CSS pixels so the pad does not shrink with zoom,
topmost depth wins. (2) The squash-and-stretch is on the unit's **container**, not its sprite —
`update()` rewrites a walking animal's sprite scale every frame for gait and breathing and would
overwrite a tween there. (3) The floating "+4 Eggs" is authored in device pixels and scaled by
`1/(zoomL * DPR)`, which is what keeps it a constant CSS size and crisp at 5x; a local refusal
("Ready in 15m", "No feed left in the barn") floats immediately and never reaches the network,
while a reward floats from the remembered tap point once the server confirms. (4) The dismissal
scrim is rendered in `stackacres-farm.tsx` **before** the toolbelt/signpost/zoom keys rather than
inside the menu component — those are positioned siblings with no z-index, so DOM order is what
keeps the chrome live while the ring is up; a scrim inside the menu's own stacking context would
swallow them. (5) The ring is styled inside the `.sa-theme` carve-out the chrome pass established,
so it reaches for no `--brand-*`/`--neon-*` token and joins the four shared block lists (font,
press, focus, unlit) rather than restating that grammar — and its centring is `translate`, not
`transform`, because the shared press rule sets `transform` outright and would otherwise jump every
button half its own size on the way down. `lib/stackacres/tap-action.ts` (new) decides what a tap is
worth off the same `unitRowAction` the sidebar rows use, so the two surfaces cannot disagree;
`growAreaAt` (new, in world.ts) is deliberately narrower than `zoneAt` — seeding is offered on
fenced ground, not anywhere inside a district's generous box. Live-verified against a real
`next dev` in memory mode, before and again after the rebase onto the new chrome.

### The woodland became forest: a world-space field, bigger trees, lanes through it (2026-09-04)
Kayo, in two passes. First: the map read as empty "because trees aren't bundled together" and the
tree art was "complete dog shit" (grass too), all on the 4050. Then, on seeing the result: still
empty, trees "so small", "some need to be taller than others", and -- the part that changed the
design -- "IRL there's a ton of grass and then u get to a point where there's miles of just straight
forest ... gaps in between each set of trees like its a maze".
**Placement is now a WORLD-SPACE field, not a per-chunk roll** (`forestDensityAt`, lib/stackacres/
world.ts), and that is the load-bearing change. Two earlier versions both grew trees from each
chunk's own seeded RNG -- independent uniform points (confetti), then per-chunk groves and treelines
(clumps, but every one stopped at its own chunk). Neither can produce open country that runs for a
long way and then becomes unbroken forest, because neither knows anything outside its own 160 units.
Smooth value noise sampled in world units has no chunk boundary in it, so a stand spans as many
chunks as it likes. Three layers: a broad field (520-unit cells) roughened by a finer one and
thresholded into a mass; a threshold that falls with distance from the farm, interpolated not
stepped, so home keeps its air and the deep world closes in; and two families of winding lanes cut
back OUT of the mass where a second and third field cross their own mid-line -- those are the maze
gaps, they run for hundreds of units and they cross. Trees plant on a jittered 44-unit lattice
(uniform random points clump and leave holes at forest density), thinned by the field's own value so
an edge feathers instead of ending on a line. Conifer-vs-broadleaf is its own slow field, so a pine
stand is a place rather than a per-tree coin flip.
**Trees are much bigger and each its own height.** Grown twice in the same pass, on sight of each
result: `tree1/2/3` painter(24,30) -> (42,52) -> (64,80), `pine` (20,34) -> (34,58) -> (52,88),
`bush` (16,12) -> (20,15) -> (26,20). The barn is 74x62, so a tree now stands taller than it, and
both smaller sizes still read as scrub beside one. `FOREST_SPACING` grew with them but deliberately
by less (34 -> 44, against roughly 1.5x on the trees), so the canopy closes up rather than merely
keeping pace: fewer planting points per chunk, far more cover. `SceneryItem` carries a `scale`
(0.78x-1.36x per tree, litter near 1) that the scene applies to the sprite AND its shadow. The drawn
fallbacks are authored in their original 24x30-era boxes and scaled into whatever box the painter now
declares by `grown()` rather than re-typed coordinate by coordinate; `sceneryShadowScale`'s tree
default tracked the canopy, 0.9 -> [2.05, 1.75].
**Art**: `tree1/2/3`, `pine`, `bush` are FLUX-generated PNGs behind `spriteBacked`, same trade the
animals took, drawn painters kept as the SSR/first-paint/404 fallback. The three broadleaves were one
`treeRound` shape in three ramps; a PNG cannot be recoloured, so the variety moved into the art as
three different canopies -- which is why stackacres-sprites.ts's module doc no longer opens by
holding the trees up as the case FOR painters. Assets were RE-FITTED from the 816x1024 renders when
the boxes grew, never upscaled. **Grass**: `bakeGrass` draws a generated seamless tile when the scene
preloaded one, at its own pixel size repeated 2x2 inside the bake canvas rather than stretched --
that repeat is what sets the scale; stretched to the full 256-unit canvas the tufts would stand ~8
world units against a 30-unit tree. Falls back to its own five passes untouched.
Pipeline at `~/.local/share/flux-sprite-test/task-trees/` (not in git, same as the earlier batches);
the asset-prep and seamless-tiling traps that cost real attempts are in
`[[reference_stackchips_flux_texture_and_cutout_prep]]` -- worth reading before the next texture,
particularly that a ground pad TOUCHING the subject defeats every blob-based strip, and that a tile
must not be rolled by half.
Verified live at three zooms on a real dev server in memory mode, plus vitest/lint/tsc/build. The
world.test.ts density caps were replaced by tests of what now matters: that dense wood AND open
ground both exist across a 25x25 chunk sweep, and that lanes actually return the field to zero inside
otherwise-wooded country. The one `lib/scene/table-anchors.test.ts` red is the pre-existing heads-up
geometry regression, untouched. Branch `feat/stackacres-tree-clusters-flux-art`, off
`feat/stackacres-bounded-world-visuals`. Not committed -- working tree only.
### StackAcres' chrome is its own visual world now, not Neon Marquee over grass (2026-09-04)
Kayo's brief: the farm's GUI "looks too much like a flat, generic web app sidebar" and wants the
chunky, tactile feel of a casual mobile farm game. It was literally that -- every panel, pill and
button on the map came from the app's violet-black chrome tokens, laid over a lit cartoon farm.
`52-stackacres.css` is now **the second documented carve-out from the styling contract, alongside the
felt**, and its header says so: inside `.sa-theme` surfaces carry a 3px outline (a hairline ban the
rest of the app keeps), radii are the farm's own two, and nothing reaches for `--brand-*`/`--neon-*`.
The materials are not invented -- they are `art-palette.ts`'s own three-tone ramps (wood, cream,
muck, corn, leaf, roof, carrot), which is what decides what "chunky" MEANS here: a button's thick
bottom edge is the material's own `rim` face, and a press travels the block down onto it by exactly
`--sa-lift`, the same height that face is drawn at. One primitive, one grammar, three physical states
(raised / pressed / unlit-disabled). Also: **Baloo 2 is self-hosted** (`app/fonts/`, ~33KB latin
variable, next/font/local via `stackacres-font.ts`, applied on the `.sa-theme` wrapper in the route's
own page) -- the first webfont in the app, deliberately route-scoped; the outlined-SVG rule for brand
marks is untouched. Layout moved with it: the toolbelt is a two-key dock bottom-left (the right edge
now belongs to the district drawer), the drawer is closed by default behind a named wooden peg on the
right edge, and the signpost rail gives up the drawer's column via `.sa-field[data-drawer]` -- without
that, five signs do not fit beside a 320px drawer on a phone and the one that fell off the end was
Ray's, the only way into the store. Two live-verified fixes worth keeping: the shell now paints
`--sa-grass` (the safe-area padding was showing the app's violet-black `body` as a 6px bruise along
the top of a farm), and `ico-look` was repainted out of Neon Marquee lilac into brass-and-sky. Copy:
the orientation gate said "The StackAcres is available in landscape mode", a leftover reading straight
through the old "The Homestead". The detector's bounce-easing warning is knowingly overridden -- the
elastic open curve is the brief's own pin, and it is spent on the way in only.

### StackAcres drops the plot grid: districts hold stock, not plots (2026-09-03)
Kayo didn't want visible plot patches at all -- "I select an area and the sidebar reflects what I can
do within that area. So if I wanna buy more cattle they'll appear within that area." Confirmed over
several rounds of questions rather than assumed, since the pen-zoning pass immediately above this one
had already gotten a similar-sounding ask backwards once: **plot ownership is gone outright**, not
hidden -- you buy an animal or crop directly (Bushels to grow one, Gold to buy one outright), it just
appears in whichever district its kind lives in (unchanged mapping: hen@Farmstead, crops@Long Meadow,
sheep@Wallow, cattle@Ox Fields). Travelling to a district (the signpost, unchanged) IS the selection;
a fixed DOM sidebar there (`stackacres-district-panel.tsx`'s `StackAcresUnitRows`/`StackAcresBuySection`)
lists what's standing there with the one action each row affords, and what can be bought. Concept
approved from a working HTML mockup before any code changed (Kayo's standing rule for map/UI
direction) -- https://claude.ai/code/artifact/dda84511-9c53-4100-b584-47bbdc6efb2b.

**The old land-purchase step (buy a plot, then plant it) is replaced by a per-KIND capacity ladder**,
not removed outright -- Kayo's call when asked. Each of the five stock kinds gets its own free base
cap of 3 (unchanged number) independent of the others, extendable up to +3 by Gold at a flat per-kind
price (`stackacresCapacityPrice`, `lib/stackacres/catalogue.ts`). This is a genuine, deliberate
economy change worth restating: the old cap was *shared* across all three livestock kinds (an
artifact of the single-grid era), so total possible concurrent livestock rises from 3 to as much as
18 fully expanded -- the honest consequence of kinds having been physically separate places since the
pen-zoning pass, not an oversight.

**A unit is a row with no position**, `lib/stackacres/units.ts` (successor to `plots.ts`): `working |
hungry | ready | mucked`, no `locked`/`empty`/`purchasable` at all, since a unit only exists once
bought. `homestead_plots` is left in place, inert, same posture as the `payout` column two migrations
ago; the new `homestead_units` table backfilled the 4 real working rows production held at migration
time (one of them -- a cattle row -- had been stocked before pen-zoning ever existed and sat on a grid
position that never matched its kind's district; dropping position entirely made that stale mismatch
moot rather than something to reconcile). **A mucked unit still counts toward its kind's cap** -- this
was a real bug caught only by driving the actual UI, not by the test suite: the first cut counted only
`working` rows (mirroring the old plot trigger, which needed to since a mucked PLOT still physically
held a tile), so a mucked unit stopped costing anything at all once units had no tile to hold hostage
-- buy a fresh one instead of ever paying the fee, and muck's whole purpose (the cost of turning ground
over) would never actually cost anything. Fixed same-day in both the server (`countOccupiedStackAcresUnits`)
and the DB trigger (`homestead_units_enforce_stock_shape`, migration `20260903190000`, applied same day
as the table it patches).

**Server actions drop `plotIndex` for either nothing (buying) or `unitId`** (acting on an owned unit).
`buy-plot` is gone; `expand-capacity` replaces it as the Gold sink. `stock`/`buy-stock` are now a
single INSERT (no more "claim an empty plot, then stock it" two-step) -- `createStackAcresUnit` is
born already working. A clean, non-permanent collect **deletes the row** rather than emptying a plot
back to `empty`; a mucked, non-permanent unit's `clear` also deletes it, once the fee is paid -- there
is no "back to empty" state to return either kind of row to any more.

**The Phaser scene surgery (`stackacres-scene.ts`, 2,868 lines) was the highest-risk piece and was
delegated to a background agent with an exhaustive, explicit keep/delete/add spec** rather than
attempted freehand, given the size and that camera/rendering work in this codebase already has its own
higher verification bar. Deleted outright: the whole per-plot cell system (`CellNode`/`buildCell`,
fence-merge/`groupNeighborOwned`, the ghost-drag-to-plot placement system, the tool-sweep gesture, and
plot screen-position tracking for the old floating detail card -- there is no floating card any more,
the sidebar is a fixed dock). Added: one `UnitNode` per owned unit (one sprite per unit now, not the
old 2-3 decorative critters standing in for a whole pen's stock), a `Critter`-driven wander box for
animals (`growAreaInterior(stockZone(stock))`) or a deterministic fixed spot for a crop (`cropSpot`,
seeded off the unit's own id via a new `seedFromId` hash -- no server-stored position needed), and one
static straw-and-fence boundary painted once per district instead of a per-plot merged fence. Verified
by an actual `next dev` + minted session + admin grant run (`localhost`, not `127.0.0.1`, or
middleware's origin check silently 403s every POST while GETs keep succeeding -- lost real time to this
before remembering it), not just `tsc`/build: real hen and cow sprites wandering their district's
fenced diamond, the sidebar updating live across buy/collect/feed/clear/retire, zero console errors.

**Other real bugs surfaced only by that live run, both fixed same pass:** the capacity-expand button
in the buy section was showing even on a district with room to spare (checked only whether extra
slots were maxed, not whether the base cap was actually the thing in the way -- `district-panel.test.ts`
had a real coverage gap here, since every existing test happened to pair a full or empty cap with the
condition under test rather than crossing the two); and Grandfather Ray's one-time welcome modal still
said "you buy your acreage from me," a stale reference to the deleted land-purchase step.

**Migrations applied same day, in order**: `20260903180000_stackacres_units.sql` (`homestead_units`,
`homestead_capacity` + `adjust_homestead_capacity` RPC, the stock/cap/ceiling trigger, harvest-ledger
columns) and `20260903190000_stackacres_units_cap_counts_mucked.sql` (the mucked-counts-as-occupied
fix above). Both verified against the live constraint/trigger definitions before writing, not assumed
from the original `homestead_plots` migration -- a CHECK constraint passes on NULL by default, which
made a first draft's belt-and-suspenders constraint rewrite on `homestead_harvests.plot_index`
unnecessary once checked.

Full `npx vitest run` 2,807/2,808 (the one red is the pre-existing PR #163 `table-anchors`
dealer-shoulder-room regression), `npm run lint` and `npm run build` clean.

### The pens moved out into the districts: each animal has its own place on the map (2026-09-03)
First cut of this got the ask backwards -- Kayo: "the zoning was meant to make the user have to visit
each section we made... not to zone the middle part of the land." The four districts (Farmstead, Ox
Fields, Long Meadow, Wallow) already existed from the map pass earlier the same day, mostly as
scenery; the real ask was to stand each animal's actual pens IN its own district, so tending cattle
means travelling to Ox Fields the way it would on a real farm, not just fencing a row back at the
farmhouse. An abandoned first attempt zoned the OLD single grid by row instead (four rows, one kind
each, all still at the Farmstead) -- reverted before it shipped; the real fix below replaces it, not
sits beside it.

**The plots are four separate physical blocks now, one per district, not one 4x4 grid.**
`lib/stackacres/world.ts`'s `plotPenZone(plotIndex)` still names a plot's kind (unchanged API,
`tools.ts` and the server routes needed no changes at all), but `cellOrigin`/`plotIndexAt` now place
and hit-test each kind's own 2x2 block inside the district that kind lives in
(`PEN_GROUP_ORIGIN`): plots 1-4 are **Hen Coops at the Farmstead** (the free starter tier, so the
cheapest way in costs no trip), 5-8 are **Crop Fields at the Long Meadow**, 9-12 are **Sheep Pens at
the Wallow**, 13-16 are **Cattle Pens at Ox Fields**. The two districts that already had an ambient,
unownable wild herd (oxen at Ox Fields, hogs at the Wallow) had that herd retired outright -- Kayo's
call, confirmed directly: the player's own pens are that district's life now, not a second thing
beside it (`zones.ts`'s `HERDS` is an empty record, kept as a type for a future district that wants
ambient life with nothing to tend yet). `zoneToolPolicy`'s four plot tools (`plant`/`harvest`/`feed`/
`clear`) go from farmstead-only to all four districts, since a plot can be anywhere now.

**The fence-merge idea survives from the abandoned row version, generalised from 1x4 to 2x2.** An
unstocked pen-zoned plot is still straw-and-rails from the moment it's bought rather than bare lawn.
The shared rail between two OWNED plots in the SAME block still drops (`world.ts`'s `plotNeighbor`,
`stackacres-scene.ts`'s `groupNeighborOwned`) -- but a 2x2 block has four possible interior edges, not
one row of three, so all four of a plot's rails (north/south/east/west) are independently conditional
now, not just east/west. A block's own outer edge -- there being no neighbour past it -- never drops,
which is what keeps four Cattle Pens reading as one paddock with rails only around the outside.

**Real geometry collisions, found by the existing path/prop tests, not by screenshot.** Ox Fields' own
road (`oxRoad`) and the Wallow's own track both run straight through the first-choice pen positions;
`paths.test.ts`'s "keeps every path clear of the plot square" caught both before a screenshot was even
taken, and the blocks moved (cattle 560,70 -> 680,70; pig -300,-390 -> -320,-390) until the whole suite
was clean. The one thing only a screenshot caught: Ox Fields' own **approach point** (the camera's
arrival framing) was still centred on the road's own end, not the new pen block 120 units east of it,
so the Cattle Pens arrived crowded into the corner of the window -- moved to 720,150, centred on the
block itself. `zones.ts`'s three district blurbs were also stale ("the oxen that cut them", "the hogs
that will not leave it") and got rewritten for what's actually standing there now.

Verified: full `npx vitest run` (2834/2835, the one red is the pre-existing `table-anchors`
dealer-shoulder-room regression, confirmed unrelated), `npm run lint` and `npm run build` clean, and
screenshotted end to end in memory mode across all four districts with real land and stock bought in
each -- the Hen Coops at the Farmstead, Crop Fields at the Long Meadow, Sheep Pens at the Wallow, and
Cattle Pens at Ox Fields, each framed correctly on arrival, each animal confirmed standing in its own
district via the scene's own dev hook. Branch `feat/stackacres-pen-zoning`.

### App-wide loading screen lands, ported onto AppShell (2026-09-03)
An older branch (`feat/app-loading-screens`) built the pieces before `AppShell` existed and before the
3D table was deleted; this pass ported the surviving state (its own gathered-table-scene redesign was
already tried and reverted on that branch, and stays reverted here) onto current main. New:
`useMinHoldFade` (`lib/loading/min-hold-fade.ts` + a React wrapper at `components/loading/
use-min-hold-fade.ts`) drives every fade in this system through one hidden/visible/hiding state
machine with a minimum hold, so a fetch fast enough to beat the network can't skip the loading state
entirely — the whole reason it exists, argued in the pure module's own header. `LoadingScreen`
(`components/loading/loading-screen.tsx`) is the full-screen "preparing your seat" beat, styled on
Claira's existing cutout (`DEALER_ART_SRC`) under moodier lighting, PlayPokerGO-referenced per Kayo's
original ask; `FadeSwap`/`Skeleton` (`components/loading/`) crossfade a skeleton into real content
once a panel's own fetch resolves, now wired into `RankStrip`, `MissionsPanel` and `Leaderboard`'s row
list (`RankStrip`/`MissionsPanel` gained a real skeleton where they used to `return null` until data
existed — see their own doc comments for why that was backwards). `table-loading-splash.tsx` (now at
its post-3D-deletion path) was refactored to reuse `useMinHoldFade` instead of its own hand-rolled
phase state machine, keeping its 11s auto-hide backstop as a local override of `active` layered on top.
New stylesheet `54-loading.css` (47 was already taken by `47-site-info.css` on current main).

**Mount point, decided fresh rather than ported**: the old branch mounted `LoadingScreen` inside
`Lobby`'s own `!profile` branch, replacing an early-return that unmounted it before its own fade could
run (a bug that branch found and fixed in place). `AppShell` (`components/shell/app-shell.tsx`) didn't
exist yet when that branch was written and now owns exactly the signal this needs —
`profile`/`profileLoading`/`profileError` — computed once, above every route it wraps. Mounted there
instead, gated on `profileLoading && !profile` (both terms matter: `profile` alone never clears for a
genuinely signed-out visitor once the fetch settles, and `profileLoading` alone would flash the
overlay over a returning tab's own cached profile, which `AppShell`'s `profile` already serves
instantly from sessionStorage). This makes the cold-boot cover genuinely app-wide — a deep link into
`/games/*` or `/leaderboard` before the first `GET /api/profile` settles gets covered too, not just a
visit to `/`. `Lobby`'s own pre-existing `if (!profile)` fallback is untouched underneath it, now just
rendered behind the overlay rather than being the only thing covering the gap.

Verified: full `npx vitest run` (2823/2824 — the one red is the pre-existing PR #163 `table-anchors`
dealer-shoulder-room regression, unrelated), `npm run lint` and `npm run build` clean.

### Gold finally buys something in StackAcres; daily ceiling 5k -> 15k (2026-09-03)
Kayo: "if I were a regular user I'd feel frustrated I couldn't use the Gold I won from skills, ante up
and poker tables." He was right -- Gold bought acreage and nothing else, so a player arriving with a
season of winnings could buy an empty field and then had to grind Sprout Rows at 8 Bushels a cycle to
put anything on it. Now every animal and crop is buyable outright for Gold at **one rule: 100 Gold per
Bushel of its seed price** (Sprout 1,000 / Hen 2,500 / Cash Crop 6,000 / Sheep 15,000 / Cattle
60,000). Deliberately NOT scaled by how many you own -- an earlier draft did that and made "how much
is a cow" unanswerable without knowing your own farm, which is exactly the anxiety this design avoids.
Land went flat at 10,000 a plot and is now buyable **in any order**: the old doubling ladder
(2,500 -> 5.12M) was the only reason strict order existed, since without it a cheap tile could strand
under a dear one. Bought stock is **permanent** -- it re-sows itself at collection, never empties,
never mucks -- which is what makes 600 Bushels and 60,000 Gold honest prices for the same animal: one
buys a cycle, the other buys the cow. Feeding still costs Bushels, so the tending loop survives.
Each district sells its own shelf (cattle at the meadow, pigs at the wallow, cash crop at the ox
fields, seed and hens in the yard), which is what finally gives the roads a destination. `retire`
exists so three permanent cattle filling the pen cap is not a trap; it refunds nothing and says so
twice before acting.

**The rule that changed, and it is the one to read before touching this again.** `stackacres-service.ts`
and the actions route both carried "there must never be a third Gold path -- a Gold->Bushels round trip
would launder Gold through the capped window." That reasoning only holds when the inbound rate is at
least as good as the outbound one. At 100 Gold/Bushel in against 2 Gold/Bushel out, every round trip
returns under 10% on every tier (`market.test.ts` holds it). **The invariant is the DIRECTION, not the
count: a new path that SPENDS Gold is a sink, a new one that PAYS Gold is the change to stop over.**
The existing tripwire test that counts `spendGoldByProfile`/`creditGoldByProfile` call sites fired when
this broke it, which is what it was for -- it was updated deliberately, not silenced.

**Ceiling raised 5,000 -> 15,000/day** (migration `20260903130000`, APPLIED to prod 2026-09-03 along
with `20260903120000`). The original 5,000 was sized against the other faucets because the farm had
nothing to spend Gold on; now that a Cattle Pen is 60,000 it is a net sink for anyone building one, and
5,000/day made payback long enough that buying looked irrational. **Flatness is still the invariant --
it must never scale with land, stock, Bushels held, Gold held, or trading skill.** Honest arithmetic:
3x per player per day, ~5.5M/yr for someone who maxes it daily and never misses. Safe to apply before
the code deployed because `p_ceiling` can only tighten -- the old build passes 5000 and keeps the old
limit until replaced. Also fixed in passing: `homestead_harvests.stake` would have recorded a notional
600-Bushel seed cost nobody paid on bought plots, understating the farm in any economy dashboard; it
cannot be 0 (`check (stake > 0)`), so a `permanent` flag travels on the ledger row instead.

### Four generated sprites ship as images; the rest of the farm is still drawn (2026-09-03)
Kayo's call after a FLUX.1-schnell bake-off on the laptop's own GPU
(https://claude.ai/code/artifact/78d2c1a4-cc71-41fc-bc29-e51a099efa9c): put **all four** in --
`cow`, `hen`, `barn`, `windmill` -- knowing the trade, which the artifact measures. They are off
`RAMPS` (11 of 24 dominant colours sit >deltaE 10 from the nearest ramp tone), they carry gradients
where the rest of the farm is flat, and **they cannot be recoloured**, so nothing here is a template
for a variant: a new animal in a new colour is a painter, not a fifth PNG. The win is silhouette --
the drawn cow and hen were circles with rounded-rect legs. These are the **first files StackAcres
fetches**; everything else is still drawn at boot.

**The discovery worth keeping: two of the four never reach the world.** The 2026-09-03 isometric pass
replaced the barn, silo and windmill with Phaser Graphics volumes (`drawIsoWalls`/`drawIsoGableRoof`),
so the `barn` and `windmill` PAINTERS are no longer drawn on the map at all -- they now only appear on
the play-screen cover and in store/HUD icons. That is also why substituting them into the world would
be wrong rather than merely unfinished: the generated barn is a **straight-on elevation** and the
world is isometric, so it would be the one object in the scene not in perspective. `cow` and `hen` DO
reach the world, as pen animals.

Plumbing, all through one seam: `stackacres-sprites.ts` holds the registry and a DOM image cache, and
`spriteBacked()` in stackacres-art.ts wraps each of the four painters so it draws the image once the
image is here and its own shapes until then. **No draw site changed** -- every surface already drew a
painter into a 2D context (`bakeTexture` for the world, `paintIcon` for icons, the cover art), so all
three picked the sprites up for free, and the drawn version remains the SSR/first-paint/404 fallback.
The scene gained its first `preload()` so the world never bakes a painter cow and then swaps it.
Boxes (`w`/`h`/`ax`/`ay`) are unchanged and the assets were fitted TO them, so `PROP_SIZE`,
`PROP_SHADOW`, `WINDMILL_HUB`, `propRect` and props.test.ts's cross-check all still hold.
`bakeSpriteTexture` still bakes through a power-of-two canvas for the same mipmap reason
`bakeTexture` does -- an unmipped 192x144 cow shimmers at the zoomed-out farm's ~6x minification.

Asset prep (`prep_assets.py`, kept with the venv at `~/.local/share/flux-sprite-test`) has two
non-obvious rules. **The silhouette is a background flood-fill, not distance-to-white**: alpha from
distance-to-white makes a near-white subject near-transparent, and the cow and hen rendered as ghosts
the moment they stood on grass rather than on a white page -- invisible in every check done against a
white background. **The baked shadow and the windmill's turf pad are stripped BEFORE that fill**, not
after: the shadow seals the gap between the cow's legs, so a fill that runs first treats the gap as
enclosed and leaves a white slab behind when the shadow goes. Stripping matters because the scene
draws its own `shadow` pool under every prop from `PROP_SHADOW` -- a baked one doubles up.

Verified end to end in memory mode at 1280x800: hens rendering in a real stocked Hen Coop on the
game's own single shadow, the seed strip's hen and cattle icons showing the generated art beside the
still-drawn sheep, and the cover art carrying the generated barn, cow and hen. Full `npx vitest run`
2768/2769 (the one red is the pre-existing PR #163 `table-anchors` regression), `npm run lint` and
`npm run build` clean. Branch `feat/stackacres-generated-sprites`.

### Homestead is renamed StackAcres everywhere, and the map got four districts (2026-09-03)

Kayo: "isolate this into mainly nailing the map design so the world doesnt feel empty... change
everything and the routes to stackacres. its not homestead." Two passes in one branch
(`feat/stackacres-map-zones`).

**The rename is the plumbing one this codebase kept deferring** -- `stackacres-farm.tsx`'s own doc
comment used to say "a display rename only... that's a bigger, deliberate pass of its own". Done:
~1,600 identifiers across 70 files (`HOMESTEAD_` -> `STACKACRES_`, `Homestead` -> `StackAcres`,
`homestead` -> `stackacres`, CSS prefix `hs-` -> `sa-`, which had zero collisions outside the
feature), every directory and file (`lib/homestead/` -> `lib/stackacres/`, `components/arcade/
homestead/` -> `.../stackacres/`, `52-homestead.css` -> `52-stackacres.css`, `public/homestead/` and
`public/audio/homestead/`), and every route: **`/games/homestead` -> `/games/stackacres`,
`/api/homestead[/actions]` -> `/api/stackacres[/actions]`, `/api/admin/homestead-access` ->
`/api/admin/stackacres-access`.**

**The DATABASE deliberately did not move**, and this is the thing not to "finish" later:
`homestead_plots`, `homestead_inventory`, `homestead_harvests`, `homestead_feed`,
`homestead_exchanges`, `profiles.homestead_access` and the four RPCs keep their names. They are live
objects in a production schema, and renaming them is a data migration to fix a caption -- the same
call `catalogue.ts` already makes about the `pig` stock id, and the rule this file states for the
`river_*` legacy identifiers. Two traps hit while doing it, both worth knowing for the next mass
rename here: (1) a sentinel that CONTAINS the string being replaced is not a sentinel -- the
`@@DB_homestead_plots@@` guards were themselves rewritten to `@@DB_stackacres_plots@@` and the
restore pass then matched nothing, silently renaming every DB identifier; (2) a
`git ls-files | grep` rename loop caught **`supabase/migrations/*.sql`**, whose filenames are part of
the applied migration history and must never change. Both were caught by auditing for leftovers
rather than by trusting the script. Also worth catching by eye afterwards: a blind sed rewrites
sentences ABOUT the old name into nonsense -- the play screen shipped reading "StackChips
StackAcres" (the exact double-branding Kayo had already rejected), and half a dozen comments
recording "replaced StackChips Homestead" started claiming they replaced themselves.

**The map: four districts, hung off the three roads that already left the yard and ended in trees.**
The world had been unbounded and procedurally wooded since 2026-09-02, which is precisely why it felt
empty -- panning any distance found more of exactly what was already on screen. `lib/stackacres/
zones.ts` (pure, 35 tests) adds `farmstead` (the existing farm, its rect pinned equal to `FARM_ZONE`
by a test so the two can't drift), **the Long Meadow** south down the lane, **the Ox Fields** east
along the road, and **the Wallow** north-west at the end of the track. No road was invented: two
short connector specs (`meadowLane`, `oxRoad`) fork out of existing path bodies, and the track
already ended inside the Wallow. Connectors are separate `PathSpec`s rather than extra points on
`lane`/`road` because `pathBounds` bakes a spec's whole polyline into one texture and paths.test.ts
caps that at 512 units a side -- one continuous road to the ox fields would span ~730 and blow
through it. `chunkScenery`'s exclusion list gained `inOuterZone`, so the woodland never grows inside
a district; each district grows its own furniture instead (`zoneScenery`), on the same chunk lattice
so one grow and one prune covers both.

Things that had to be got right and were only discovered by looking at it:
- **District ground is Phaser Graphics diamonds, never a baked rectangle.** The known open gap about
  the path/pond bakes still being flat squares is survivable at a path's width and would be the most
  obviously broken object on the map at a district's.
- **A contrasting second ground colour is a chessboard, not mottling.** The first cut dealt `alt` at
  real contrast to a third of the tiles and the Wallow rendered as a literal checkerboard. `alt` now
  sits within a shade of `base`; a separate small always-on `mottle` roll does the grain.
- **Do not overlap translucent tiles.** Oversizing each diamond by 0.75u to hide seams composited the
  alpha twice in every overlap and drew a bright lattice over each district -- the tile grid made
  visible by the thing meant to hide it. They abut exactly now.
- **An alpha ramp around a rectangle still reads as a rectangle** (a vignetted stage with square
  corners). The outer band is now also punched through at random, so the boundary breaks up. Corner
  tiles fall under the drop threshold and vanish entirely, which needed the inset ramp to be squared
  rather than linear.
- Ground-hugging art (furrows, mud pools) is only scattered well inside a district, or it lands out
  on bare lawn in the feathered border and reads as a dropped plank.

**The scythe is the first tool whose target is the GROUND rather than a plot**, so it is the first
one needing `zoneToolPolicy`/`isActionValidInZone` -- every earlier tool is farmstead-only for free
because `plotIndexAt` returns null elsewhere. The meadow is a density field (0-3 per 16-unit tile,
each level a different painter), not a scatter, because it is the one piece of the map the player
changes; `mowStroke` samples the segment so a fast swipe cuts an unbroken swathe rather than a dotted
line. A drag mows only when the scythe is held AND the press began on standing grass -- gating on the
tool alone would make the meadow un-pannable. Regrowth is capped at the tile's own base density so
mowing flat and waiting cannot erase the field's grain. **Mowing is deliberately visual: it yields
nothing.** Cut hay flowing into the barn as a sellable item is a new inventory item, a new action and
a ceiling review, and it belongs in its own pass rather than riding along with a map -- `mown` is
client-side and resets on reload, which is the honest cost of that choice. The oxen and hogs reuse
`stepCritter` unchanged, in absolute world space rather than cell-local: a new picture, not a new
system.

Chrome: `stackacres-destinations.tsx`, a signpost rail ordered outward from the farm, tapping which
eases the camera to that district's *gate* (a fixed-size window on the approach point, so a big
district and a small one both arrive at a readable zoom). It sits top-left under the masthead --
bottom-left was tried first and `.sa-tool-hint` is centred on the bottom edge and ran straight
through it. Its swatches are `--sa-zone-*` tokens cross-checked against `zones.ts` by a test, the
same guard `props.test.ts` puts on `PROP_SIZE`.

**Still open, unchanged by this pass:** the first-run "four red rings" (Plant held with no seed) is
now the first thing a new player sees on a map with a signpost on it, and it looks worse for the
company. The Ox Fields and the Wallow have no action of their own -- they are places with life in
them, not places you do something, and giving them one means touching the economy.

Verified: full `npx vitest run` 2768/2769 (the one red is the pre-existing PR #163 `table-anchors`
dealer-shoulder-room regression, untouched here), `npm run lint` and `npm run build` clean, and
screenshotted end to end in memory mode at 900x460 -- all four districts, the signpost, the oxen and
hogs walking, and a real mown swathe cut through the meadow with the actual pointer. Preview built
before the build per Kayo's own standing instruction for map/camera changes:
https://claude.ai/code/artifact/e6d5b113-3e78-4c1d-8c1e-7bc268d9f79c

### StackAcres camera went isometric: real depth, not just repositioning (2026-09-03)
Kayo: the farm "looks like basic poly" and "the camera is still overtop 2d," expecting "2d5 with
depth like farmville" -- two references given, a FarmVille screen and a mobile isometric farm game
screenshot. Both complaints are the same root cause: a building only reads as three-dimensional once
the camera actually views it from an angle, and the camera was a dead flat bird's-eye view (plots were
axis-aligned rectangles, buildings were plan-view icons). Before building, a slider-driven Canvas
mockup was published and approved (classic 2:1 isometric, the FarmVille/Clash-of-Clans tile ratio) --
https://claude.ai/code/artifact/7dc4bdfc-7be4-4a2c-a1c6-1d9df882c996 -- **build a preview before moving
forward** is Kayo's own instruction here, worth reusing whenever a camera/projection change is on the
table again.

**The architecture that made this safe: `lib/stackacres/world.ts` never changed.** A plot is still a
CELL-square at `cellOrigin(index)`, `plotIndexAt` is still a plain divide, `stepCritter` still walks a
rectangle -- none of it knows the camera tilted. The isometric shear is a new, pure, tested seam,
`lib/stackacres/iso.ts` (`isoProject`/`isoUnproject`, exact inverses, additive by construction so a
container at a projected origin composes correctly with children placed at their own projected
cell-local offsets). Every world-space number `stackacres-scene.ts` reads goes through `isoProject`
before becoming a Phaser position or a depth key; every point Phaser hands back (a pointer's world
point) goes through `isoUnproject` before it is allowed near `plotIndexAt` or any other world.ts
function. Depth sort needed no new mechanism: projected y is monotonic in (worldX + worldY) by
construction, so the existing "depth = y of feet" convention is still exactly right, just fed a
projected y now (`depthAt`). One real per-frame bug this caught: `sortPen`'s within-pen depth
comparator sorted by `state.y` alone, correct only under the old flat camera -- now sorts by
`state.x + state.y`, the real isometric key.

**What got redrawn, not just repositioned:** a square texture repositioned onto a diamond footprint
still renders as a square floating at the wrong angle, so the four flat ground-plate painters
(mown/soil/straw/muckbed) became diamond Graphics fills (`paintGroundDiamond`, colours lifted from the
flat painters of the same name so a plot reads as the same material, just tilted); the barn, silo and
windmill -- the three biggest "basic poly" offenders -- became real isometric volumes drawn straight
with Phaser Graphics (`drawIsoWalls`/`drawIsoFlatRoof`/`drawIsoGableRoof`, one-sun three-tone shading:
roof lightest, left wall medium, right wall darkest) rather than baked painters; fence rails and the
pen gate are rotated to the diamond's own two edge directions (`ISO_EDGE_ANGLE`, derived from the
projection itself, not eyeballed) instead of lying screen-horizontal/vertical. Selection/afford rings
became diamond outlines (`tracePlotDiamond`) instead of rounded rects; the progress bar stays a plain
screen-flat UI bar anchored under the diamond's nearest corner, deliberately not sheared -- a mini
progress bar reads as UI everywhere else in this codebase, and a tilted one would look like a bug.

**What shipped repositioned but still visually flat, on purpose -- the honest remaining gap, same
shape as the 2026-09-02 "art volume" entries below:** the baked path and pond shore textures, and every
smaller yard prop (well, wheelbarrow, crates, log pile, mailbox, signpost, lamps, flower bed, stone
wall, scarecrow, the thicket/woodland trees). Their anchors are projected so they sit in the right
place; their own shape is not yet redrawn for the tilt. Small round/symmetric things (a tree canopy, an
animal, a rock) read fine under repositioning alone -- nothing here reads as obviously wrong -- but a
future pass giving them the same volume/rotation treatment as the barn is the next honest step toward
the FarmVille bar, not a correctness gap.

Verified: `iso.ts`'s round-trip/additivity/edge-angle properties in `iso.test.ts` (11 tests), the full
existing 121-test stackacres suite unchanged and green (world.ts's own contract never moved), full
`npx vitest run` (2732/2733 -- the one red is the pre-existing PR #163 `table-anchors` dealer-shoulder-
room regression, confirmed unrelated), `npm run lint` and `npm run build` clean. Screenshotted in
memory mode end-to-end, including stocking a real Hen Coop through the actual toolbelt+canvas flow (not
just the empty farm): fence rails trace the diamond correctly, hens scatter inside the pen footprint,
depth sorts correctly. Branch `feat/stackacres-2-5d-visuals`, PR not yet opened at the time this entry
was written.

### StackAcres collecting was also broken in production, same Phase 2 landing (2026-09-02)
Immediately after the stocking fix below unblocked stocking, collecting hit the same class of bug:
"Could not collect from that plot: Could not find the 'yieldQuantity' column of 'homestead_plots' in
the schema cache." `collectStackAcresPlot`'s Supabase `.update()` in `lib/server/stackacres-store.ts`
hand-lists its columns, and every other field in that object correctly uses the DB's snake_case name
(`started_at`, `ready_at`, `muck_fee`) except one: `yieldQuantity: null` instead of `yield_quantity:
null`, left over from copy-pasting the in-memory `cleared` object's JS field name into the Supabase
payload. `stockStackAcresPlot`'s own update already had it right, so only the collect path was broken.
PostgREST rejects an unknown column outright, so the loop was stock -> wait -> collect fails, since
Phase 2 shipped. Fixed by renaming the one key; the memory-mode suite (167 stackacres tests) can't
catch this class of bug either, same lesson as the stocking fix. No Gold/Bushels/produce at risk --
the write throws before anything is credited.

### StackAcres stocking was broken in production since Phase 2 landed (2026-09-02)
Kayo hit "Could not stock that plot" live. Root cause: `20260901180000_homestead_inventory.sql`
made `payout` inert (collections yield produce via the new `yield_quantity` column, not Gold) and
re-pointed the stocking trigger's ceiling at `yield_quantity` -- but missed the original migration's
CHECK constraint, `homestead_plots_stock_matches_status`, which still required `payout is not null`
for a working plot. Nothing has written `payout` since that day, so every stocking UPDATE has set
status = 'working' with payout still null and the CHECK rejected it outright -- **every stock attempt
has failed since 2026-09-01**, never caught by the memory-mode suite (it doesn't exercise a real SQL
CHECK) and apparently never actually attempted in production until now. No Gold/Bushels were at risk:
`stockStackAcres`'s catch block already refunds the seed cost when the database throws. Fixed by
swapping the constraint's dependency from `payout` to `yield_quantity`
(`20260902130000_fix_homestead_plot_stock_check.sql`), applied directly to production and verified
there with a self-cleaning insert/delete against a real row before landing the file. Also fixes a
smaller trap for next time: a verification INSERT wrapped in a `WITH ... AS (INSERT ... RETURNING)
DELETE ... WHERE id IN (...)` CTE did not actually delete the row it inserted (left one real test row
on a real player's profile, caught and cleaned up by hand) -- for a self-cleaning check against a real
table, verify the leftover count directly rather than trusting the CTE's own RETURNING silently
returning nothing.

### StackAcres: paths, a pond and yard props close out the art-volume gap (2026-09-02)
The "still open" line at the end of the StackAcres premium pass entry below named the honest gap to
the FarmVille bar as "art volume (paths, water, props, a character)". Paths, water and props are done
here; **a character is deliberately deferred** — Kayo's call: it makes no sense to draw a farmhand
before the map itself is settled. `art-paths.ts`/`lib/stackacres/paths.ts` lay a dirt road and a lane
with damp rims and a worn centre band; `art-water.ts`/`lib/stackacres/water.ts` add a pond (lily pads,
reeds, a dock, wandering ducks, rippling); `art-props.ts`/`lib/stackacres/props.ts` scatter a windmill,
well, wheelbarrow, crate stack, log pile, mailbox, signpost, three lamps, a flower bed, a broken stone
wall and a scarecrow through the yard, plus woodland litter (fallen logs, mushrooms, boulders) in the
open world beyond the farm. All three new art modules follow the existing painter conventions (one
sun / lit-mass shading, POT-safe `bakeTexture` baking) rather than inventing their own.

A 2-agent review pass (correctness + polish-vs-CLAUDE.md-aesthetic) caught one real timing bug and one
drift risk, both fixed: `pokePlot`'s crop-tap guard set `juiceUntil` to a flat 460ms, but the actual
chained squash-tween for a field's last plant (row 3, col 4) runs to 180ms delay + 340ms of tweening =
520ms — a re-tap in that 60ms gap started a second squash tween fighting the first's yoyo-back for a
frame, a visible jitter on fast re-tapping. Now `this.now + 520`, with the geometry spelled out in a
comment so a future field-size change doesn't quietly reopen the gap. Second: `PROP_SIZE`
(`lib/stackacres/props.ts`) hand-restates each prop's painted box that `art-props.ts`'s `PROP_PAINTERS`
already carries as its own `w`/`h` — nothing enforced the two agreeing, the exact "drifted hand-written
copies" pattern this file's own history has hit before (STAKES_TIERS, the wager ladders). Added a
one-off cross-check in `props.test.ts` (test-only import of the painter module, not a production
dependency) so a future resize that forgets the matching row fails loudly. The barn roof's inline
light/dark-split-plus-shingle-course draw duplicates the shared `roof()` helper's geometry by hand —
left alone: the two aren't actually pixel-identical (different overlay alphas, shingle-line count, and
the barn's own diamond ridge finial vs the helper's line highlight), so unifying them would change the
rendered art for a nit-level dedup, not a free win.

**Still open, unchanged by this pass:** the wild-plot tint (`wild` painter in `stackacres-art.ts`) still
reads as a flat grey rectangle when zoomed out — confirmed byte-for-byte untouched by this diff, same
gap the premium-pass entry called out. The stocking CHECK-constraint bug this worktree independently
found in the same window is covered by the entry above -- it landed on main and production first, so
that copy is canonical; this branch's own copy of the migration was reconciled to match it on merge.

### StackAcres: the grid became a 2D sandbox viewport (2026-09-01)
Kayo's brief: "a major evolution", not a new game -- take the economics as they are (acreage, crops,
pens) and move them into a fluid world the player drags, zooms and places things in, with the menu
layer pinned to the screen. **Phaser is back for the StackAcres** (`phaser` 3.90.0, exact), which
reverses his 2026-09-01 "DOM grid, drop Phaser" call; that call was made when the field was a 4x4 of
buttons, this brief explicitly asks for Phaser scenes. Two layers that never mix: the world is ONE
Phaser scene (`components/arcade/stackacres/stackacres-scene.ts`) that fills `.sa-field` and moves when
dragged; the header, toolbelt, seed strip, detail card, store sheet and modals are all still DOM,
absolutely positioned over the canvas by `52-stackacres.css` -- a `<button>` is reachable by a screen
reader and a thumb, a Phaser Text is neither. The brief's "UIScene" is that DOM layer, not a second
Phaser scene. **Nothing on the server changed.** A plot is still `plotIndex` 1-16 bought in ladder
order; `lib/stackacres/world.ts` (pure, 22 tests) only decides WHERE index N is drawn (a 5x5-tile
square, 4 across, inside a 4-tile forest ring), which plot a world point hits, how far the camera may
roam, and how the animals wander. "Place the coop anywhere" is therefore "drop it on any empty plot":
a chip dragged out of the seed strip becomes a ghost that snaps to the empty plot under the finger
(`setGhost`), and dropping it fires the same `stock` action a tap would. "Buying acreage expands the
map" is literal -- `acreageBounds` fences the camera to owned plots plus the one for sale plus a ring of
forest, so a purchase pushes the border out and the camera glides to the new land. Animals are real
sprites inside fenced pens (3 hens, 2 sheep, 2 cows) driven by `stepCritter`, a pure state machine
that cannot walk one through a fence (tested over 5,000 steps); hungry pens stand still and grey.
State/affordance rings, progress bars and the harvest burst are all drawn in the canvas in the same
colours the CSS used. Things worth keeping: (1) `import * as Phaser` -- the package's ESM build has no
default export, and `import Phaser from "phaser"` fails only at bundle time; (2) Phaser's own input
system is switched off entirely (`input: {mouse:false, touch:false, keyboard:false}` in
`stackacres-world.tsx`) and every gesture is read off native `pointerdown/move/up/cancel` listeners
bound straight to the host element instead — two input layers on one surface would double-handle
every press; (3) the detail card is a popover hung beside the selected plot -- the scene reports the plot's screen
rect every frame it moves (`trackPlot`) and `placeDetail` positions the node directly, no state --
because at phone zoom the map is barely wider than the screen and any fixed corner panel covers plots
that can never be scrolled out from under it; a `ResizeObserver` re-places it when its own content
grows (a bought plot's card gets taller on the same spot). Keyboard/screen-reader path is
`StackAcresPlotList`, sixteen real buttons hidden until focused. The whole packed Tiny Farm sheet
ships as `public/stackacres/tilemap_packed.png` (CC0); frame meanings are `FRAME` in `world.ts`.
Verified with the memory-mode harness from `[[project_stackchips_homestead_farmhand_adoption]]`
(`next dev` + minted cookie + admin grant; `localhost`, not `127.0.0.1`, or middleware's origin check
403s every POST) at 844x390 and 1280x800: tap, drag-place, pan, wheel/button/pinch zoom, buy, reload.
**Not verified live: ready/hungry/mucked rendering** (needs a 15-minute clock); the code paths are
the same `buildCell` switch. Open: `suggestedTool` lands a fresh farm on Plant with no seed, so the
first thing on screen is two red "blocked" rings -- pre-existing behaviour, now more visible.

### StackAcres premium pass: mipmaps that actually exist, one sun, tap juice (2026-09-02)
Kayo brought a five-file Phaser "mandate" (EngineConfig / PremiumCameraController /
DynamicGridManager / TactileJuiceEngine / StackAcresViewportScene, plain `.js` under a `src/` tree
this repo does not have) plus a FarmVille 3 screen recording as the bar, with "don't take everything
I provide as law." None of the five files was dropped in: the config half was already in
`stackacres-world.tsx` (`pixelArt: false`, `antialias: true`, `roundPixels: false`), and the rest
would have re-opened bugs this branch had already closed -- the camera controller runs on Phaser's
own pointer bookkeeping (the phantom-finger pinch bug from Kayo's iPhone), its `wheel` listener is on
`window` with `preventDefault` and never removed, its inertia is `v *= 0.9` per frame (twice as fast
on a 120Hz phone; ours is `pow(decay, dt/16)`), it has no pinch at all, `transparent: true` is the
"platform floating in the sky" bug from 2026-08-31, the grid manager loads a texture atlas that does
not exist against a no-downloads rule, and the juice engine's guard sets `isDeDeforming` (typo) so it
never guards. What was real in it was built properly in the existing TypeScript. **The finding worth
keeping: `mipmapFilter: "LINEAR_MIPMAP_LINEAR"` had been silently doing nothing.** Phaser 3.90 only
calls `gl.generateMipmap` when `IsSizePowerOfTwo(width, height)` (`WebGLTextureWrapper.update`),
and `WebGLRenderer.init` requests a plain `webgl` context, which cannot mip NPOT textures at all;
every painter was baked at `ceil(w*8) x ceil(h*8)`, so none qualified and the zoomed-out farm
(6x minification at zoom 0.6) sampled roughly one texel in forty. `bakeTexture` now pads every
canvas to a power of two (`powerOfTwoCeil`, tested) and registers the painted region as
`ART_FRAME`; every `add.image`/`setTexture` in the scene names that frame. Verified on the live GL
wrappers through the dev handle, not assumed: every texture reports `LINEAR_MIPMAP_LINEAR`. Art: one
sun, high and upper-left, applied everywhere (`litMass` clips a radial light onto any mass; the
`shadow` painter is anchored at its own centre so a caller placing it at a thing's feet puts the pool
UNDER the feet, offset right -- before, `ay: 1` hid most of every shadow up behind the trunk); tilled
soil with lit lips and clods; a cream dotted lot marker on empty plots; eave shadow, shingle courses
and a lit ridge on the barn; broad faint sun sweeps in the grass tile; a screen-pinned vignette with
a warm sun corner (scrollFactor 0 still zooms, so it is centred on the camera and sized `view/zoom`).
Motion: a per-pen depth sort by y (`sortPen`, permutes only the contiguous sprite block so the near
fence stays in front), idle breathing out of phase per animal, and `pokePlot` -- volume-preserving
squash-and-stretch on a tap, hop through a tweened `lift` because update() owns y, one bounce at a
time. Still open and deliberately not touched: the tiers of the wild-plot tint block read as a hard
grey rectangle when zoomed out; the first-run "four red rings" (Plant held with no seed) noted in the
2026-09-01 entry; and the honest gap to the FarmVille bar is now art volume (paths, water, props, a
character), not engine settings.

### StackAcres art went vector and the map went open-world (2026-09-02)
Kayo's brief: "it's 2026, Gameboy graphics aren't it" -- better graphics, keep the smoothness the
racetrack has, nothing downloaded. Every sprite on the map and every icon in the chrome (toolbelt,
seed chips, HUD purse/feed, store barn rows) is now a Canvas2D painter
(`components/arcade/stackacres/stackacres-art.ts`), baked into a Phaser texture at boot and rendered at
the browser's own device pixel ratio -- smooth at every zoom, nothing is a pixel and nothing is a
downloaded asset. `tilemap_packed.png` (the Kenney Tiny Farm sheet) is deleted; the cut PNG tiles under
`public/stackacres/tiles/` stay on disk only because another branch's lobby card reads `cattle.png`
directly, and nothing in these components references them any more. The map also became genuinely
open-world: the camera is no longer fenced to the acreage plus a forest ring. Roaming past the farm in
any direction grows procedural scenery in `STACKACRES_CHUNK`-wide chunks (`chunkScenery`, deterministic
per chunk so it regrows the same trees on return), denser near the farm and thinner far out, with a
`FARM_ZONE` rectangle kept permanently clear so nothing can grow inside the plot ladder or lean over
its fence. `lib/stackacres/world.ts`'s `acreageBounds` is renamed `ownedBounds` and lost its role as a
camera fence -- it only frames the opening shot and "back to the farm" now; zoom limits became fixed
constants (`STACKACRES_ZOOM_MIN`/`MAX`) instead of a function of the roamable area, since there is no
longer a roamable area to fit. The plots, the economy and every server rule are untouched -- this pass
touched only where things are drawn and what draws them. One trap worth keeping, found shooting the
QA screenshots: Phaser hears pointer events on the *window*, so a drag that starts on a seed chip and
then crosses the map would pan the camera out from under its own drop target if it were handled
through Phaser's own input. Rather than patch that with a target/pointer-id check layered onto
Phaser's events, `bindInput()` (`stackacres-scene.ts`) switches Phaser's input off entirely and reads
every gesture -- including its own pointer-id bookkeeping, since a stray third finger must be
rejected and capture/cancel handled by hand -- off native pointer events bound to the host element
directly. This *replaced* an earlier target-check design built on Phaser's own pointer bookkeeping,
the same shape of bug as `[[reference_stackchips_phaser_canvas_dom_overlay]]` one layer up -- it isn't
layered on top of it.

### Blackjack orphaned-round lockout closed; the "never exercised in prod" claim was stale (2026-09-01)
A money-path audit queried the live DB rather than trusting this file's own claim that Blackjack's
Supabase persistence branch had "never been exercised by a real hand in production" — it was stale: 55
rows, 3 distinct real profiles, 53 staked, back to 2026-08-11. Real exercise surfaced the real bug the
claim wasn't there to predict: `blackjack-service.ts` had no resign/abandon action, so a round abandoned
between the deal and the player's first action (tab closed, connection dropped — an ordinary mobile
event) sat `active` forever, and `blackjack_rounds_one_active_per_profile` then permanently locked that
profile out of Blackjack. Found live: two such rows, real players "Grilly" (1,000 Gold, stuck since
08-14) and "Hugol" (5,000 Gold, stuck since 08-11, 47 minutes after account creation — plausibly their
first hand ever), both `version: 1`, never touched since the deal. Fixed by hand first (refunded via
`credit_gold_by_profile`, rows force-settled), then the root cause: `resign()` in the engine (forfeits
the stake, same as every other staked game's resign) plus a 30-minute staleness sweep in
`blackjack-service.ts` that force-resigns an abandoned round on the next read, keyed off the DB row's
own `updated_at` rather than a new engine-level clock — the engine's own header rule ("nothing here
reads a clock") stays true. See `[[project_stackchips_blackjack_orphaned_rounds]]` for the full incident
record. Same pass also closed a second, unrelated gap: Nonogram shipped without its tiers ever being
added to `ante_up_attempts_enforce_wager_ceiling` (the DB-side wager-ceiling trigger), so it had no
database backstop, only the TypeScript check — fixed, plus a test that reads the trigger's live
definition off the migration files and fails if a future game's TS ceiling and DB ceiling ever drift
apart again.

### The StackAcres is being rebuilt to match `jeremyckahn/farmhand` (2026-09-01)
Kayo brought that repo as the target -- "it matches what I want it to look like and how I want it to
be on mobile... I want our stackacres to adopt most of if not all of the game here". **Its code is
GPL-2.0-or-later and its art is CC BY-NC-SA 4.0; the NonCommercial term rules the art out outright
because StackChips sells Gold. Reimplement from the design, never copy a file.** Full teardown and
the phase plan: https://claude.ai/code/artifact/482f085c-851f-4941-8070-0715c3feddc7

**Economy, decided by Kayo:** two layers. Harvests will sell for an internal currency (**Bushels**,
working name) which never leaves the farm, and that is where all of farmhand's variance lives --
swinging prices, crafting margins, loans, cow breeding -- safely, because none of it is Gold. Gold
leaves only through **one exchange window with a flat per-player daily ceiling**: not a percentage,
not scaled by land owned, not scaled by trading skill. That invariant (**the farm's maximum Gold
output is a constant**) is what keeps this out of the category Ante Up was in when it printed money,
and it is the thing to defend in review. Collections will stop paying Gold entirely, so there is one
faucet rather than two stacked. Cosmetics pricing is deliberately parked.
Phases: (1) feel, (2) Bushels + inventory + shop, (3) the exchange window, (4) the market, (5) the
meta. **The ceiling lands before prices start swinging**, so the valve is closed and tested before
there is any variance behind it. Phases 1-3 are built (see below); phase 4 is next and now has a
closed valve in front of it.

### Phase 1 shipped the farmhand feel; Phaser is gone (2026-09-01)
Branch `feat/stackacres-farmhand-feel` off main. **The Phaser canvas and `iso.ts` are deleted** --
Kayo's call, reversing his own earlier "use Phaser.js and 2d elements" (which was made against a 3D
proposal, not against DOM). The field is now a plain CSS grid of buttons, one per plot, each a stack
of 16x16 pixel-art tiles under `image-rendering: pixelated`. That deletes the whole coordinate-twinning
arrangement `iso.ts` existed for: a canvas is invisible to a screen reader, so every painted tile had
needed an invisible DOM copy kept in sync. **The tile is the button now.** Also removes the `phaser`
dependency and its 1.2MB chunk.
Interaction is **tool-first**: hold a tool from the dock, and every plot it can act on lights up.
`lib/stackacres/tools.ts` owns all of it (`affordanceFor` returns `act | blocked | none`) so it is
testable; the components render what it returns and own no rules. **`blocked` is deliberately
distinct from `none`** -- a plot that IS the tool's target but lacks Gold, feed or a free slot lights
red, because collapsing it into "not tappable" hides the reason the farm has stopped.
Three things found by actually screenshotting it, none of which reasoning caught:
1. **State rings were invisible in the first cut.** An inset `box-shadow` paints above the element's
   background but BELOW its children, and both tile sprites are children at `inset: 0` -- so the
   gold "ready", amber "hungry" and brown "mucked" rings were painted over by the artwork and never
   appeared at all. State rings now live on `::before`, the affordance ring on `::after` inset by
   3px so the two nest concentrically.
2. **The affordance tint must not be green.** Green was the obvious farming-game choice and it
   vanished: every Kenney soil tile is a brown patch on a green lawn, so the tint disappeared into
   the art. It is violet now (`--accent-edge`/`--accent-glow`) -- highest contrast against grass and
   soil, and already the system's own accent spent as a ring and a glow rather than a fill.
3. **The plots needed a shared bed.** Sixteen sprites on the violet chrome read as islands; the grid
   now carries `--sa-grass: #84c669`, sampled from the tiles' own grass, so the 2px gap between
   tiles becomes lawn and the field reads as one field.
Art is Kenney's **CC0** Tiny Farm pack (`public/stackacres/tiles/`, see its `CREDITS.txt`);
`scripts/extract-stackacres-tiles.py` records which source tile became which file, so swapping packs
is a re-run. **The pack has no pig:** the middle tier keeps its `pig` stock id (it is on live rows;
renaming it would be a data migration to fix a caption) and is labelled **"Sheep Pen"**.

### The access code is gone; access is a switch in the admin portal (2026-09-01)
Kayo: "the code into stackacres is done. scrap it and just allow me to assign access to ppl in admin
portal" -- and, separately, "the code to get into stackacres doesnt even work", which is what a code
that was never set in the environment it shipped to looks like from outside. Both the code and the
account allowlist before it kept the guest list **in a deploy**, and both fail silently the same way:
an unset variable is indistinguishable from a broken feature. A row in a table cannot fail that way.
**`profiles.homestead_access`, one boolean per player, toggled from the admin dashboard** beside the
ban and unlimited-Gold switches it deliberately copies. Migration
`20260901200000_homestead_access.sql`, **UNAPPLIED** -- and it must land BEFORE the code, or the
gate's `select` throws and every StackAcres route 500s instead of refusing politely.
`POST /api/admin/stackacres-access` grants and revokes; `STACKACRES_ACCESS_CODE`,
`POST /api/stackacres/unlock`, the pass cookie and the code prompt are all deleted.
**Keyed on the profile, not the auth account**, because a profile is what the dashboard lists, what a
session cookie resolves to, and what a guest has -- so a guest can be let in exactly like a
registered player. Fail closed: the column defaults false, so nobody is in until somebody is named,
**including Kayo** (grant yourself first).
Two ordering rules, both live again and both tested: the gate **costs a database read**, so it runs
AFTER the rate limiter (gating first hands an unauthenticated flood a query amplifier), and it reads
the session cookie with `readSessionToken`, **never** `readOrCreateSessionToken` -- a refusal must not
hand a prober an identity, and a freshly minted token could never be on the list anyway. That also
removes the read route's old tokenless preview of the farm: with no cookie there is no profile a
grant could have been made to. `stackacres-access.test.ts` still walks `app/api/stackacres` so a route
added tomorrow cannot skip the gate, and now also asserts no route mints a session at all.
The locked page shows the visitor **their own player id**, because granting means finding them in a
dashboard whose search box matches exactly that string.
Verified over real HTTP in memory mode: anonymous 401, a real ungranted profile 401, a locked POST
sets **no** session cookie, the admin route 404s without the admin cookie, granting flips one profile
to 200 while another stays 401, the page renders the farm for the granted and the ask-for-access card
otherwise, revoking shuts it again, and granting a nonexistent profile is refused.
**`next start` cannot run memory mode**: it forces `NODE_ENV=production` and
`readSupabaseRuntimeConfig` treats an empty config as an error there rather than as memory mode, so
local HTTP verification without Supabase credentials has to be `next dev`.

### SUPERSEDED by the entry above: the account allowlist became an access code (2026-09-01)
Kayo: "just [make] it available in the UI but u can only get in through a code." Replaced
`STACKACRES_ALLOWED_USER_IDS` with **`STACKACRES_ACCESS_CODE`** — one shared code, entered at
`/games/stackacres`, traded for a pass cookie at `POST /api/stackacres/unlock`. The allowlist worked
but made "let a friend look at it" a deploy; a code is what was actually wanted.
**The cookie holds an HMAC of the code, never the code**, which buys three things at once: a stolen
cookie is worth no more than the code it came from, **rotating the code revokes every pass with no
revocation list** (the expected value is recomputed from the live code per request), and forging one
needs the code. Keyed on `SESSION_SECRET` when set and on the code when not, because an unset
optional secret must never be a second way a feature goes dark (session.ts's own rule).
**The rate limit IS the security, not the code's length** — 8 attempts / 10 min, and it runs first;
a code short enough to say out loud is brute-forceable at HTTP speed and these routes move real Gold.
Answers **401 now, not 404**: the old 404 hid the feature's existence, and a tile on the floor
announces it, so hiding the route only makes a locked door look broken.
**The tile is `live` and got its own floor section, "Keep something growing", under a new
`kind: "idle"`.** Not `wager`: that section's own note promises you can lose the Gold you stake, and
the StackAcres has no stake and no losing branch, so filing it there would make the note false about a
row beneath it. It is deliberately **left out of the hub tile's "N free every day" count** — free of
Gold but behind a code, so counting it promises something most readers cannot open. Opening the game
to everyone is now deleting one variable; no catalog edit.
Verified over real HTTP against a built server: locked routes 401, wrong code 401, right code 200 and
issues a cookie **containing no substring of the code**, page renders the gate rather than a 404, a
locked POST sets **no** session cookie, and a guessing run gets cut off at the 8th attempt.
`findUserIdBySessionToken` in `profile-store.ts` is now unused — it existed only for the allowlist.

### Phase 3: the exchange window, the farm's one Gold outlet (2026-09-01)
Same branch. **Bushels -> Gold at 2 Gold each, capped at a flat 5,000 Gold per player per UTC day**
(Kayo's numbers, signed off). The cap is the feature; the rate is not. A generous rate only means a
player reaches the ceiling sooner and banks the rest, which is the shape to keep when phase 4 starts
moving prices. Sized against the faucets that already exist rather than against what the farm can
grow: daily grant 1,000 x2.5 streak, ads 500x6, backstop 1,000/12h, and below the ~7,500/day the
pre-Bushels StackAcres paid uncapped.
**The invariant, and the whole review question: the ceiling is a constant.** Not a percentage, not
scaled by acreage, bankroll or trading skill. Skill decides how fast the day's bucket fills, never
how big it is. `lib/stackacres/exchange.ts` holds it as a bare number on purpose, and
`exchange.test.ts` asserts it is one; a service test drains the window on a bare farm and on a
six-plot one and asserts both get exactly 5,000.
**Gold now moves in exactly two places** (`buyStackAcresPlot` spends, `exchangeStackAcresBushels`
pays) and a source-scanning test counts the `spendGoldByProfile`/`creditGoldByProfile` call sites so
a third fails rather than ships. A second test pins the route's action list, because the change that
would actually break this is a Gold->Bushels action: a round trip turns a ceiling into a laundry.
Ordering is rule 1 with the currencies swapped -- **Bushels leave, then the day is reserved, then
Gold lands** -- and a refused reservation refunds. The rate is read at exchange time, NOT snapshotted:
unlike a planted plot nothing was agreed in advance.
Migration `20260901190000_homestead_exchange.sql`, **UNAPPLIED**: `homestead_exchanges`
(profile_id, day, gold), PK `(profile_id, day)`, one RPC. **It needs no advisory lock and the reason
is worth knowing** -- unlike `admob_ssv_receipts_enforce_daily_cap`, which counts rows in the table
it is inserting into and so can miss an uncommitted sibling, the number here lives IN the row being
written and the conflict target is the primary key, so `insert ... on conflict do update ... where
gold + p_gold <= ceiling` re-evaluates against the winner's committed row. **The RPC carries its own
hard copy of the ceiling and takes `least(p_ceiling, hard_ceiling)`**, so application code can only
ever tighten it -- raising the farm's Gold faucet costs a migration.
UI is a gold-edged block at the BOTTOM of the supply store sheet (everything above it is the farm's
own money going round; this is where it leaves, and it should be a thing you go and do). One bug the
screenshots caught again: **the allowance bar filled as the day was spent, which put a full gold bar
directly above the words "0 of 5,000 Gold left today"**. It drains now. Also fixed in passing:
`.sa-group-label` had no CSS rule at all, so phase 2's three store headings rendered as body copy.

### Phase 2: Bushels, produce and the store (2026-09-01)
Same branch. **Every StackAcres table was verified EMPTY in production first** (`homestead_plots`,
`homestead_feed`, `homestead_harvests` all 0 rows -- nobody has ever played it, since the gate allows
nobody), which is what made a free reshape of the economy possible; re-verify before applying the
migration anywhere that has since been played.

**The loop is now farmhand's.** Harvesting no longer pays anything -- it puts PRODUCE in a barn, and
selling that produce at the supply store is what earns **Bushels**. That split is not cosmetic: a
market can only swing a price if there is something you are holding while it swings, which is exactly
what phase 4 needs. `collectStackAcres` moves no money at all now, and nothing should ever add money
back to it.

**Currency wall, and the thing to defend in review: only `buy-plot` moves Gold.** Seed, feed, muck and
produce are all Bushels or items, and they never leave the farm. Land stays Gold (Kayo's call) so the
2,500-doubling ladder survives as a sink and Gold has a reason to enter at all. Several service tests
assert a Gold balance is *unchanged* across an action purely to catch a second Gold path being added.
New farms get `STACKACRES_STARTING_BUSHELS` (150) exactly once via
`grant_homestead_starting_bushels` -- `INSERT ... ON CONFLICT DO NOTHING` makes the **primary key the
idempotency guard**, so a player who spends it all does not get another by refreshing.

New migration `20260901180000_homestead_inventory.sql`, **UNAPPLIED**: one `homestead_inventory`
(profile, item_id, quantity) table holding produce AND Bushels behind ONE row-locking RPC -- one
function is one EXECUTE grant to get right, and that grant has shipped wrong twice here. Two columns
change meaning: `homestead_plots.stake` is Bushels now, and `payout` is **inert** (kept, since
migrations are append-only) replaced by a new `yield_quantity` snapshot. The stocking trigger's
ceiling was denominated in Gold payouts and is re-pointed at `yield_quantity`, which is the real last
line before a faucet: inflated yield -> produce -> Bushels -> phase 3's exchange -> Gold.
**`bushels` shares a table with produce, so the `sell` action's item enum is the only thing between a
request and infinite money** -- there is a test for exactly that.

### StackAcres migration applied, and a revoke that wasn't revoking (2026-09-01)
`20260831150000_homestead_plots.sql` is **applied to production**, verified against real Postgres with
a self-rolling-back `DO` block rather than trusted from the memory-mode tests (which cannot exercise a
SQL CHECK at all): payout ceilings, both caps of 3 counted separately, the guarded collection paying
once and never tripping the stocking trigger, the feed RPC refusing to go negative. Applying it
exposed a real hole. The migration revoked EXECUTE `from anon, authenticated` but **not `from
public`**, and both roles inherit the default PUBLIC grant, so the revoke was a no-op and
`adjust_homestead_feed` sat callable on `/rest/v1/rpc` -- SECURITY DEFINER, taking the profile id as a
parameter rather than reading the caller's session, so any anonymous caller could move any player's
feed balance, and feed is bought with Gold. Exactly what
`20260813170000_revoke_pvp_trigger_function_execute.sql` exists to fix; that makes twice. The idiom is
`from public, anon, authenticated` and all three names matter -- copy it from `credit_gold`, and check
`proacl` afterwards rather than re-reading the migration (a correct one has no bare `=X/postgres`).
Supabase's advisor catches the SECURITY DEFINER case, so run `get_advisors` after applying anything
that adds a function. Also this pass: `50-stackacres.css` renumbered to **52** (main's Nonogram and
Othello took 50 and 51 while the branch was open).

### StackAcres ships to prod gated on one account, by env not by code (2026-09-01)
Kayo wants it on production but visible only to his own account. The gate is an allowlist of Supabase
auth account ids in **`STACKACRES_ALLOWED_USER_IDS`**, checked in `lib/server/stackacres-access.ts`.
**Ids, not emails:** the session cookie already resolves to `profiles.user_id`, so an id costs a
lookup we make anyway, where matching an email would mean a Supabase auth-admin call on every read.
**Env, not committed:** `Nikkayowill/poker` is a PUBLIC repo -- an email is personal data and an
account id names one real person -- so there is no default and **unset allows nobody, including
Kayo**; forgetting the variable is indistinguishable from the feature being broken, so say so wherever
it deploys. Needed `findUserIdBySessionToken` in `profile-store.ts` because `publicProfile()`
deliberately drops `userId` (`isRegistered` is derived from it), so nothing player-facing can name a
specific account. **The PAGE is genuinely gated this time, which the admin version could not manage:**
the player session cookie is `path=/`, so a server component reads it via `next/headers` and calls
`notFound()` -- the admin cookie's `path=/api/admin` was what forced the old "render for anyone, let
the API refuse" compromise. Still 404 everywhere, never 403. **The rate limiter now runs BEFORE the
gate, reversing the old order**: the admin check was a free signature check worth running first, but
this one costs a database read, and gating ahead of the limiter hands an unauthenticated flood a query
amplifier. `stackacres-access.test.ts` walks `app/api/stackacres` so a route added tomorrow cannot skip
the gate, and asserts the gate precedes `readOrCreateSessionToken`. That ordering test **failed on its
first run against correct code**: it string-matched bare names, and the comment explaining the
ordering names the very function whose position it measures -- it now strips comments and matches
calls (`name(`). Releasing means flipping `status` to `live` AND clearing the variable; either alone
still hides it.

### The staff gate is gone; the StackAcres is unlisted, not closed (2026-09-01)
Reverses the entry below, on Kayo's call: "scrap the whole admin access. just let me look at it." The
gate worked but made the game hard to even open -- `ADMIN_SESSION_COOKIE` is per-origin, so the prod
passcode does nothing on a preview deploy, and `ADMIN_SECRET` is scoped per Vercel environment, so a
Preview build without it locks staff out along with everyone else. Deleted `lib/server/staff-gate.ts`
and its test; routes moved back to `/api/stackacres[/actions]` (the cookie path no longer constrains
where they live), page to `/games/stackacres` beside every other game, and the "Admin session required"
locked state went with them. `ArcadeGameStatus`'s fourth value is renamed **`staff-only` ->
`unlisted`**, because with no gate left the old name was a lie. **Know exactly what `unlisted` buys:
`splitArcadeFloor` still shows only `live` rows, so it stays off the floor -- and that is ALL it does.
The routes are open and move real Gold, so anyone with the URL can play it.** That is the same
"a catalog row is not a lock" lesson `lib/arcade/retired.ts` records, now running in the other
direction: unadvertised, never unreachable. Flipping `status` to `live` is the whole release. If it
ever has to be genuinely closed again, the route must refuse -- that is a separate thing to build, not
a status value. Also worth keeping: **`npm run dev` cannot verify this page at localhost.**
`next.config.ts`'s `allowedDevOrigins` pins a stale `192.168.2.144`, so the page server-renders and
then no client component mounts -- dead canvas, dead buttons, nothing in the console. Build and
`next start` instead; see `[[reference_stackchips_local_testing]]`.

### SUPERSEDED by the entry above: the StackAcres was staff-only under /admin (2026-09-01)
Kayo: finished but not for the public yet, reachable only through the admin portal. New
`ArcadeGameStatus` value **`staff-only`** -- a fourth state, not a flavour of the other three: built,
mounted, moving real Gold, just not offered. `splitArcadeFloor` shows only `live` rows so it never
reaches the floor, and per `lib/arcade/retired.ts`'s lesson the routes carry their own gate rather
than relying on a hidden catalog row. **The load-bearing discovery, found by curl and not by
reasoning:** `ADMIN_SESSION_COOKIE` is scoped `path=/api/admin`, so mounted at `/api/stackacres` the
gate could not see the cookie that authorises it and 404'd staff as well as strangers. Widening the
cookie to `/` was rejected (the narrow path is what keeps an admin credential off ordinary traffic,
the same reasoning that moved admin auth off a request header) -- the game moved instead:
`/api/admin/stackacres[/actions]`, page at `/admin/stackacres`, catalog href to match. The PAGE is
deliberately ungated and cannot be gated, for the same path reason; it matches how `/admin` already
works -- renders for anyone, API behind it refuses, stranger gets a locked state. Everything answers
**404, never 403**: a 403 confirms the feature exists. `staff-gate.test.ts` walks
`app/api/admin/stackacres` on the filesystem so a route added tomorrow cannot skip the gate, and
asserts the gate runs before `readOrCreateSessionToken` (or probing it hands the prober a session
cookie). Verified live: anonymous 404s on every surface including the old public URLs, admin session
gets 200 and the real service runs.

### Nonogram rebuilt to compete with the picross apps (2026-09-01)
Kayo: make it compete with "the main nonogram games out there" and include everything that makes it
enjoyable. The v1 shipped the day before was a correct nonogram nobody would choose to play: **boards
were 58% uniform random noise**, so solving one revealed static rather than a picture -- the reveal is
the entire reward of the genre and it was missing -- and **every single square was its own HTTP round
trip**, which on a 625-square master board is 625 sequential requests inside a 40-minute clock. Both
are fixed. Boards are now **drawings**: 65 hand-authored pictures at 5x5/10x10/15x15 (cat, anchor,
crown, penguin, guitar...), each one **verified line-solvable by `nonogram-pictures.test.ts` upright
AND mirrored** -- that test is the gate that lets art ship, since ambiguity in a nonogram is invisible
to the eye and this stakes real Gold. Mirroring is the only transform used (a rotated cat is not a
cat, and the reveal is the point). 20x20/25x25 are past what hand art can carry, so they are **grown**:
a mirror-symmetric half-grid smoothed by a majority rule into blobs, then repaired to solvable by the
same strictly-increasing-fill argument the old generator used. The library is `server-only` behind the
new `nonogram-deal.ts` and the engine takes a *dealt* board rather than importing one -- the
arrangement `connections.ts` has with `connections-puzzles.ts` -- because `nonogram.ts` is
client-imported and the library is the answer key; verified absent from `.next/static` after a build,
not assumed from tree-shaking. Gameplay: **strokes** (`markNonogramCells`, one request per drag,
axis-locked client-side) that **stop at the first wrong fill**, so a drag past the end of a run costs
one mistake rather than one per square; **auto-cross** (chosen at deal, stored on the round, sound
because a mark can only ever be a *correct* fill so marks matching a clue mean that line is finished);
**undo** (bounded 20 strokes, never unfills a square the board has proved, never refunds a mistake);
**hints** that cost a mistake and refuse to spend the last one (a free hint on a no-guess board is a
free square, and enough of them is a board that pays without being played). Plus per-clue-number
strike-off (`nonogramClueProgress`, in the engine so it is testable and cannot drift from the
component), a row/column crosshair, zoom, a Pan tool (squares are `touch-action: none` so a finger
paints; Pan is what hands the drag back to the scroller), full keyboard play, a progress bar, a
localStorage personal best, and the finished picture revealed clean with its name. Real CSS bug found
and fixed while shooting screenshots: **`--ng-clue-step` was declared on `.ng-match`, so its
`calc(var(--ng-cell) * .66)` resolved against that element's 24px fallback and never against the
per-rung `--ng-cell` set inline on `.ng-grid`** -- descendants inherited the already-resolved value --
which silently clipped the top number off every two-deep column clue; see `app/styles/CLAUDE.md`.
**Still open: the tiers were not retuned and should be.** They were set against random-noise boards
that almost nobody finished; drawings with real runs in them plus drag-painting move the win rate up
by an unmeasured amount, and expert/master pay 3.2x and 5x. `ANTE_UP_NONOGRAM_TIERS`' own header now
says so. Solve-rate data from real attempts is the honest input; `ante-up-stakes.ts`'s ceilings bound
the damage until then.

### The Mint became the StackChips Homestead: crops, feed, muck, three times of day (2026-08-31)
Kayo's expansion spec (his own, written in the stackacres branch's register) plus the rename:
`sovereign-mint` -> `homestead` (renamed again to `stackacres` on 2026-09-03),
`mint_plots` -> `homestead_plots`,
node types `pulse|core|matrix` -> `hen|pig|cattle`. Free to do because the migration was still
unapplied; after it lands this is a data migration, not a find-and-replace. Five plot states now
(`locked|empty|working|hungry|ready|mucked`) across two tracks with **separate caps** -- 3 pens and 3
fields -- because crops sharing the livestock budget makes them just a cheaper animal.
**Three corrections to the spec, all load-bearing.** (1) Its flat maintenance fee is arithmetically
impossible here: at 20% muck and a flat 1,500, a Hen Coop's +50 net becomes **-250 a cycle**, so the
tier new players start on is a guaranteed loser. `muckFee` is now 2x the tier's net bonus, holding
expected muck cost at 40% of what the plot earned on every tier -- there is a test asserting exactly
this. (2) Its `#1A1A1D`/`#222226` are the stackacres demo's near-black stage, which Kayo had already
ruled out ("DONT COPY THE BACKGROUND"); states map onto our dusk palette instead. (3) **A 20% roll
cannot be computed on read.** Everything else here is a pure function of timestamps, which is why the
feature needs no background jobs; a dice roll evaluated on read re-rolls on every refetch and a player
rerolls muck by pulling to refresh. It is rolled once in `rollMuck`, server-side, inside the guarded
settlement write, and stored. **Hunger freezes rather than kills** (Kayo asked whether animals should
die; the blocker is that per-plot push is not buildable on this stack, so a feed deadline is one the
app is structurally unable to warn about): a hungry pen stops, and feeding pushes `ready_at` forward
by the time spent hungry, so neglect costs time and never Gold. That is also why readiness is no
longer a pure function of `started_at` and the row has to remember `last_fed_at`. Feed is a per-player
consumable behind a row-locking RPC (`adjust_homestead_feed`), same posture as `credit_gold`. Only
Pig and Cattle can ever go hungry -- a Hen's hunger window is deliberately longer than its own cycle,
so the cheapest tier stays fire-and-forget. World gained `morning|dusk|night` tones picked from the
player's own device clock at boot; only colour and light change, because re-lighting from a different
angle would mean re-authoring every prop's shading three times. Supply store is a sheet off a HUD
button. 35 new tests.

### The Mint's diorama became an outdoor farm; landscape CSS was measurably wrong (2026-08-31)
Kayo, on the first cut: "why is the platform floating in the sky?" -- and it was, literally. The
scene drew a violet slab on a `transparent: true` canvas, so the app's own dark ground showed through
underneath and the whole treasury read as a platform in a void, while the panel beside it talked
about surveying the grounds and crews tending nodes. The whole static world now lives in
`mint-world.ts`, painted once into ONE canvas texture at boot (Canvas2D, not `Phaser.Graphics`: real
gradients and soft radial shadows, and one quad instead of a command list re-walked every frame).
**Land runs off all four edges** -- there is no platform to fall off. Distance is a hazy hedgerow
along the top rather than a sky, because the grid already spans y 67..441 of a 470-tall stage and a
real horizon band would have had to shrink tiles that are already near the touch-target floor in
landscape. Three rules worth keeping: (1) **owned plots are the warmest thing in the frame** -- the
first cut had bright green scrub for LOCKED plots against violet-grey soil, so twelve unusable tiles
were the most inviting thing on screen; warm turned earth vs. cool dark scrub is also the grid's only
real colour contrast on a phone. (2) Crops are **violet while growing, gold only when ripe**, drawn
as two faces meeting at a ridge -- filled triangles with a lighter triangle inside made every ripe
plot look like it was on fire. (3) Cloud shadows sit ABOVE the plot layer (`DEPTH_CLOUD` 800): the
plots cover the field bed completely, so a shadow underneath disappears the moment it reaches the
field. Only plot tweens are tracked for removal; Phaser does not kill a tween when its target is
destroyed. **The landscape breakpoint was broken and the number was the bug**: `calc(100dvh - 128px)`
assumed 128px of chrome where the real total (safe area, floor bar plus its `clamp()`ed margin,
scoreline, two shell gaps) measures ~160px at 844x390, hanging the diorama 30px below the fold on the
exact device the breakpoint exists for. The shell is now a fixed-height flex column and the stage
takes what is left, no magic number. Its `@media` block **must stay last in `52-stackacres.css`** -- it
overrides base rules at equal specificity, and it silently lost every panel rule while it sat above
them. Node cards go 2x2 grid there (name/terms, yield/button); three portrait cards are ~300px
against ~260px of height, and a wrapping flex row broke each card at a different word. Verified by
screenshot at 900x900 and 844x390, populated via a route-intercepted fixture, plus reduced motion.

### Sovereign Mint: an idle treasury of staked, timed Gold nodes (2026-08-31)
Built from a GameDesigner-agent GDD Kayo brought in, after an engineering review rejected its
economy outright (guaranteed 150-200% ROI with no cap: the Ante Up money printer with the variance
removed). The shipped frame is deliberate: **flat net bonuses, never percentage ROI** (Pulse 1,000
stake -> +50 in 15min, Core 10,000 -> +600 in 4h, Matrix 50,000 -> +2,500 in 24h) plus a
**3-concurrent-node cap**, so max guaranteed income is ~7,500/day (rewarded-ads territory) and
cannot compound with bankroll; plots 5-16 are a pure sink (2,500 doubling per tile), and owning
more plots is never more income. Kayo's renderer call: **Phaser 2D, no 3D** ("dont use 3d") --
`phaser` pinned 3.90.0, entering the bundle only through `mint-canvas.tsx`'s dynamic import (a
1.2MB lazy chunk referenced by no page manifest; verified). Server mirrors Ante Up exactly:
`lib/mint/` (tuning + pure derivation), twin-branch `mint-store`, `mint-service` restating the
money-ordering rules, `payout`/`matures_at` snapshotted at plant (the wagerLadder rule), harvest a
single guarded UPDATE (version + status + `matures_at <= now`) that pays at most once, plus an
append-only `mint_harvests` ledger. Migration `20260831120000_mint_plots.sql` follows the
trigger-not-CHECK lesson (fires only when a row turns growing, advisory-locked cap count) --
unapplied, see `[[reference_stackchips_migrations_not_auto_applied]]`. Client: canvas is pure
paint; input/a11y is a DOM overlay of real buttons sharing coordinates via `iso.ts` (canvas is
invisible to screen readers). Two rules enforced by tests caught real bugs while building: GET
`/api/mint` must use `readSessionToken` not `readOrCreateSessionToken` (session-minting.test.ts),
and the catalog row's `entryCost` is 0 so a broke player is never wallet-gated away from their own
ripe harvest. No XP on plant (a riskless stake must not feed progression), no missions, no
leaderboard. Deliberately deferred with the GDD's blessing withdrawn: per-node push (infra can't),
monuments/adjacency boosts/cosmetic grid skins (purchased-cosmetic yield amplifiers touch the
gambling-law posture and need Kayo's own call).

### Ante Up copy pass, plus Nonogram and Othello (2026-08-31)
Kayo: the Ante Up heading ("Eleven more ways in.") "makes no sense and is old", every card blurb
needed rewriting, and the heading had to match the other tabs. It now follows the house head shape
every other floor already used (kicker / short noun phrase / one line): **Ante Up / "Every game
beside the table."** The old line counted the catalogue through a number-to-words table (`spell()`,
deleted) -- a count baked into a sentence goes stale the day a game ships, which is the rule
`lib/arcade/games.ts`'s own header records three times and which broke three more places found in
this pass: the hub tile shipped reading a literal **"0 free every day"**, the first-run strip
literally read **"0 puzzles are free every day"** (both counted `kind: "puzzle"`, a bucket empty
since the 2026-08-21 move of every brain game to `kind: "wager"`), and the same strip said "Ten more
games" against a catalogue of thirteen. Blurbs described the *price* rather than the game, so three
cards said the identical "Wager Gold, or play free — any time" and two more said "1v1, winner takes
the pot", while the stake line directly beneath said it again; every blurb now names its own
mechanic. Section heads: "Ante up" (colliding with the tab of the same name) -> **Beat the board**,
"Staked in Gold" (true of all three sections) -> **Against the house**, "Player vs. player" -> **Head
to head**. The floor's how-it-works modal opened "Every Ante Up game can be played completely free",
untrue of Blackjack and the five duels; now scoped to the solo boards, and carrying Nonogram's rules
(Kayo asked for them there specifically).

**Nonogram** (12th solo game, `/games/nonogram`) and **Othello** (5th duel, `/games/othello`) shipped
in the same pass. Nonogram runs 5x5 to 25x25 on five rungs (easy/medium/hard/expert/master), and its
generator carries the same no-guess guarantee Minesweeper's does, by the same reasoning: a puzzle
needing a guess is a coin flip and this stakes real Gold. `lib/arcade/puzzles/nonogram.ts`'s line
solver is a two-pass DP over (position, run), not an enumeration of arrangements -- a 25-wide line
with six runs has thousands. **The generation loop provably terminates rather than merely usually
terminating**: when line logic stalls, the repair *adds* a filled square, which strictly increases
the filled count, and the all-filled grid (every clue a single run the width of the board) is
trivially solvable, so it cannot run past `size * size` repairs. In practice it is a handful or none
-- 25x25 generates in ~2ms, worst case ~7ms, measured. Only a wrong *fill* is scored; a cross is
player notation and free, which is what lets the mistake budget be small (3 at 5x5 up to 6 at 25x25).
The board does not shrink to fit a phone the way Minesweeper's does -- 625 squares at a tappable size
will not fit, and `.ng-frame` scrolls in both axes instead. Othello was picked over Connect Four for
one reason: **Connect Four is solved**, and a player who has memorised the first-player win would farm
every opponent they got seat 0 against, for real Gold. Its two rules worth knowing are in the engine
header (a move must flip something; a player with no legal move passes and does not lose, and only
when neither side can move is it over -- which is usually but not always a full board). No draw or
repetition rules: every move fills a square, so it cannot loop. Balance conservation verified live
end to end (4,000 Gold across two players before and after). Migration
`20260831140000_othello_leaderboard.sql` adds 'othello' to `global_leaderboard_entries()` and is
**unapplied**; see `[[reference_stackchips_migrations_not_auto_applied]]`.

### StackAcres districts became unlockable sectors; land has a price and an upkeep again (2026-09-04)
Three of the four districts now start under wild growth, and the ground itself is back on the Gold
ladder for the first time since the 2026-09-03 pass deleted the 16-tile plot grid. That deletion left
the map with four districts that were simply all there from the first minute, three of them full of
pens nobody could afford, so the east half of the world read as content that had failed to load. New
`lib/stackacres/sectors.ts` holds the whole layer, pure: the ladder (`SECTOR_LADDER`, Long Meadow ->
the Fold -> Ox Fields at 15k/45k/100k Gold, ordered by STOCK TIER rather than by
`zonesByDistance`'s walk), the requirement checklist, the upkeep curve, and `sectorOvergrowth`.
`SectorId` is `ZoneId` itself, not a parallel id space. Four things worth keeping: (1) **unlocks are
DERIVED, not just stored** -- `unlockedSectors(cleared, units)` counts any district the player
already keeps stock in, so every live farm mid-cattle-cycle keeps Ox Fields with no backfill to get
right and a lost row cannot cost somebody land they visibly own; the migration deliberately has no
backfill for exactly this reason. (2) **Nothing is greyed out.** A locked district paints no ground
wash, no grow-area floor, no fence and no ghost outline -- there is no farm there yet to grey out, so
what stands there is wild growth (`sectorOvergrowth`, dealt per district rather than per chunk since
a sector is bounded and has to be destroyed in one go when cleared) plus a barely-there haze;
`zoneScenery` gained a `locked` set so a plough or an ox trough can never stand on unclaimed ground.
Discovery is therefore entirely on the tap, which is why `onLockedSectorTap` fires anywhere in
`zoneAt` rather than in the narrow `growAreaAt` box a cleared district uses. (3) **The upkeep ledger
is raise-to, not insert-once**: a day's bill is not fixed when the day starts (buy a capacity slot at
noon and it rises), so `raise_homestead_upkeep` raises today's paid total to a target and settling
charges the DIFFERENCE -- insert-once would miss the rise, add-to would charge the whole new bill on
top of the old. Curve is `8 * 1.2^(plots - 3)` Bushels/day, ~59 at all four sectors cleared and ~916
at every slot bought, against a few thousand Bushels a day of gross. (4) It is a **soft** gate: an
unpaid farm can still collect, feed, sell and exchange -- only GROWING is blocked -- and yesterday's
unpaid bill lapses rather than compounding, so the fee can never be a debt trap. Charged off mutating
actions, never a read (reads stay write-free) and never a background job (this subsystem has none).
Gold asymmetry untouched: `clear-sector` is a third SINK, nothing new pays Gold out, and the
currency-wall test's call counts moved 2->3 / 3->5 deliberately. Verified live end to end against a
memory-mode `next dev` (wild -> modal -> clear -> crop field appears, Gold 402k->387k, the day's
20-Bushel fee showing in the HUD). Migration `20260904130000_stackacres_sectors_and_upkeep.sql` is
**unapplied**; see `[[reference_stackchips_migrations_not_auto_applied]]`.

### Word Stack and Connections now carry their payout ladder (2026-08-27)
Closes the gap left open by the Ante Up economy fix earlier the same day. Both games computed their
payout from a module-level multiplier table *at settlement*, and both are once-a-day boards that can
be opened in the morning and finished at night, so a retune landing in between paid the player at a
rate they never agreed to. That was not hypothetical: the same-day retune moved Word Stack's
six-guess rung 1.5x -> 0.7x and Connections' three-mistake rung 1.5x -> 0.6x, either of which flips a
board already in progress from a profit into a loss. `StoredWordStackRound`/`StoredConnectionsRound`
now carry an optional `wagerLadder` copied in at open and never re-read from the module, the same
rule `AnteUpAttempt.multiplier` and `AnteUpMinesweeperAttempt.timeLimitMs` already state in their own
doc comments; `lib/arcade/ante-up-ladder.ts` holds the shared lookup. Stored only when `wager > 0`
(a free round has no payout to protect) and carried forward on every guess, not just at open. Rounds
written before the field existed fall back to the live table, which is the best answer available and
exactly what they would have got anyway. **Memory Match has the same defect and was deliberately left
alone** — its multiplier is a range function rather than a lookup map, so snapshotting it means
converting the if-chain to a rung array, and its exposure is minutes (one sitting, one-active-per-game)
rather than a whole UTC day.

### Ante Up was a money printer; wager ceilings + a payout retune (2026-08-27)
Kayo reported real farming ("my gf was easily farming coins"), and it was the design working as
written, not an implementation hole. Two compounding bugs: **no maximum wager existed anywhere in the
app** (every route `z.number().int().min(0)`, the only bound being the player's balance), and
**near-certain wins paid well above 1x** — easy Sudoku gave 15 minutes on a guaranteed-solvable grid
for 1.5x, and Memory Match had *no* winning turn count that paid under 1x. Stake everything on the
safest board, win, restake: at 1.5x with the 10/game/day cap, 100k compounds to ~19B in a day across
three games. Fixed both halves. Ceilings live in one new `lib/arcade/ante-up-stakes.ts` (Sudoku easy
5k → expert 500k; Minesweeper beginner 5k → expert 500k; the three games with no difficulty axis get
25k flat), enforced in all five `open*`/`start*` services before any Gold moves. Payouts retuned down
across all five games; the slow rungs at Memory Match, Word Stack and Connections now deliberately
**pay back less than the stake**, so clearing a board is not by itself profit. Sudoku's clock ladder
also ran backwards (easy 15 min, expert 5) and now grows with the grid. Memory's turn cap 20 → 16.
Three things worth keeping: (1) the DB guard is a **BEFORE INSERT trigger, not a CHECK constraint** —
a CHECK re-evaluates on every UPDATE, and since every settlement here is an UPDATE that *throws*, one
pre-deploy over-ceiling attempt would have been permanently unsettleable, 500ing its page forever
while the one-active-per-game index blocked any new attempt (verified rollback-safe against the live
DB; a legacy 10k row still settles cleanly under the trigger). (2) `ANTE_UP_MEMORY_MAX_TURNS` is now
**snapshotted onto the attempt** (`maxTurns`), since a retune of a forfeit condition otherwise takes a
wager for a move that was legal when made — Sudoku/Minesweeper already did this, Memory was the odd
one out. (3) Every board keyed its win celebration off `payout > 0`, which sub-1x rungs made a lie
(1,000 staked, 600 back, rendered "+600 Gold" under a gold bloom); `lib/arcade/ante-up-result.ts` now
computes net once for all five. **Still open:** Word Stack and Connections compute payout from the
live table at settlement, so a daily round opened before a retune and finished after is paid at the
new rate — land retunes at a UTC day boundary, or snapshot the multiplier into the round (its own
pass). Migration unapplied; see `[[reference_stackchips_migrations_not_auto_applied]]`.

### Cribbage sync moved off its fixed 2s poll onto Realtime, same pattern as duels (2026-08-27)
Follow-up to the PvP duel Realtime migration (below) — Kayo asked for cribbage on the identical
pattern, named `crib`. Two channels, not one: `crib:lobby`, a single global channel every browser on
the open-table join screen shares (GET `/api/cribbage` lists open tables across every stake with no
per-viewer filter, unlike a duel's own challenge list, so there's no narrower key to give it), and
`crib:<tableId>` once seated. Both fired by a new `broadcast_crib_signal()` trigger on writes to
`cribbage_tables` **and** `cribbage_table_players` — the latter matters because `claim_cribbage_seat()`
(joining) only ever writes the seat table, never `cribbage_tables` itself, so a trigger on just the
table would silently miss every join and the open list's seated-count would never update. Real bug
caught writing the trigger: `NEW`/`OLD` are unassigned records (not null-valued rows) for the
row-trigger operation that doesn't apply, so a naive `coalesce(new.table_id, old.table_id)` on the
DELETE-only-for-leaves table raises "record is not assigned yet" — fixed by branching on `TG_OP`
explicitly instead. Same shell changes as the duel branch: keyed on `tableId` (a primitive) rather than
the table object so a move's version bump doesn't tear down and resubscribe the channel, a 15s backup
poll alongside the channel (no other seated human's turn-clock tick to notice a stale socket the way
poker has), no fallback poll when Supabase isn't configured (same posture the duel branch settled on
after Kayo asked for its own fallback to be removed), and the same 429/Retry-After backoff
duel-shell.tsx carries. Migration applied 2026-08-27 (`crib_realtime_signals`, verified via
`list_migrations` and a clean security-advisor pass).

### PvP duel sync moved off the fixed 2s poll onto Realtime (2026-08-27)
Resolves the "known open item" below (now stale where it's still quoted). `duel-shell.tsx`'s own
comment had called the 2s poll deliberate, judging Realtime "a bigger change than these games need" —
Kayo asked for it anyway. New per-profile channel `pvp:<profileId>` (`lib/pvp/duel-channel.ts`), fired
by a `broadcast_pvp_signal()` trigger on every write to `pvp_challenges`/`pvp_matches` naming that
profile — mirrors `table-channel.ts`'s invalidation-ping contract, but keyed per-player rather than
per-game since a challenge has no match id yet to key on. Carries no version (unlike the table
channel): a challenge and a match don't share one monotonic counter, so the payload is empty and any
broadcast just triggers a full lobby re-fetch. A slow 15s backup poll still runs alongside the channel
as a safety net against a stale-without-erroring socket — poker's realtime has the turn-clock's own
deadline pull to fall back on; a 2-player duel has no other seated human to notice for it. No fallback
poll otherwise (removed after Kayo asked for it): when Supabase isn't configured (memory-mode dev) or
this browser's own profile id isn't known yet, the effect just doesn't subscribe, same posture
`poker-app.tsx` already takes. Migration applied 2026-08-27 (`pvp_duel_realtime_signals`, verified via
`list_migrations` and a clean security-advisor pass) — the general "verify before trusting a historical
note" caution below still applies to older entries; see
`[[reference_stackchips_migrations_not_auto_applied]]`.
- History below is a dense changelog, not the discovery narrative — one paragraph per pass covering
  what shipped and what's still load-bearing or still open. Full reasoning for any decision is
  recoverable from `git log`/PRs on the branch each entry names. Every pass listed was verified with
  the full `npx vitest run` + `npm run lint` + `npm run build` (`tsc` clean) before landing; recurring
  pre-existing failures are `safe-area.spec.ts` and (until fixed 2026-08-26) two
  `multiplayer.spec.ts`/`table-scene.spec.ts` reds — see Known open items. This file periodically gets
  compressed like this to stay under budget (2026-08-26 pass cut it ~101KB → current size) — when
  redoing this, cut narrative/verification boilerplate, never a fact or an open gap.

### Seat-art roster grown to character29; the 2026-08-25 renumbering wasn't recorded here (2026-08-26)
Four new characters added (`character26`-`29`, all rare-tier, continuing the Gold ladder's constant
second-difference sequence — delta grows by 10,000 each rung — up to 3,530,000). Also surfacing a gap:
the roster was renumbered from a gappy `character13-41` set down to a clean `character1-25` on
2026-08-25 (same day as the "roster to 41" entry below), closing a pricing discontinuity the
`character29`/`31`-`34` deletions had left — but that renumbering was never logged as its own entry in
this file, only in `catalog.ts`'s own comment block. **Any reference below this point to
`character##` above 25 refers to the old, now-dead numbering** — resolve a specific character by name,
not by id, when reading older entries. The live top of the roster is `character29`, not `character41`.

### Sit & Go: a 6-max poker tournament, StackChips' first (2026-08-26)
Single-table Sit & Go, not a scheduled multi-table event — every staked PvP format here is deliberately
human-only, and a 6-max table just waits for real registrants rather than risking an MTT field that
never fills. Entry fee and starting stack both equal an existing `STAKES_TIERS` tier's buy-in; blinds
escalate on a hand-count schedule at turbo pace; winner-take-all. Reuses the poker engine directly
(`GameState.tournament`) rather than forking it — busting throws on rebuy, forfeits the seat instead of
handing it to a bot, and an idle tournament seat auto-folds forever rather than ever going to bot fill.
A `/code-review` pass caught two severe bugs the test suite structurally couldn't (memory-mode tests
never exercise a real SQL CHECK constraint): both new CHECK constraints were written before the RPCs
that violate them and made every deal/cancel attempt hard-`FALSE` against a real Postgres — fixed by
narrowing both to what's actually invariant. Also fixed: an eliminated player's table-row was never
cleaned up, so they read as "still registered" and got bounced back into the game they'd already lost.
A follow-up optimize pass fixed a redundant double-profile-resolve on the open-table lobby poll and
serialized-should-be-parallel head-to-head writes on settlement (cribbage's route has the identical
redundant-resolve shape, deliberately left alone as out of scope). PR merged into main alongside the
3D-table deletion below; migration unapplied — see `[[reference_stackchips_migrations_not_auto_applied]]`.

### The WebGL 3D table is deleted outright (2026-08-26)
Resolves the "scrap under consideration" question that had been open since 2026-08-19 — Kayo's call,
stated directly: "kill it... scrap all of it," with one carve-out: keep the 2D seat-art roster
(`character1`-`41`, never 3D-room code) exactly as-is. Nothing was left half-copied in the live tree —
the whole subsystem was snapshotted under a pushed tag, `archive/webgl-3d-table`, before deletion;
recover any file from there rather than re-deriving it. Deleted: `lib/game3d/` (63 files),
`components/game3d/` (36 files), `app/game3d/`, the 3D bridge component, every GLB asset, four
asset-pipeline scripts, and the `three`/`@react-three/*` npm dependencies — plus a second, fully
separate 3D-only cosmetics slot (`CHARACTERS_3D`, `character3DCosmetics`, `avatar3d` on
`EquippedCosmetics`) that existed only for the 3D room's own characters. Two files under a
`game3d`-named path were moved rather than deleted because the racetrack table depends on them too:
`table-shape.ts` (stadium-curve geometry math) → `lib/scene/`, `table-loading-splash.tsx` →
`components/table/`. **M17 (chip cosmetics), parked "until the 3D sim is finished," needs Kayo's own
re-decision now that there is no 3D sim left to finish** — not resolved by this deletion.

### Classic portrait table deleted outright; racetrack is the only table (2026-08-25)
Kayo's call: the 2.5D racetrack is the sole table, the 3D room stays around disabled for later,
"players will just have to turn their phones." Deletes the dead `canvas_2d` code itself (it was
already unselectable since 2026-08-17): `table-scene.tsx`, `projection.ts`, `felt-art.ts`, the classic
dev chip bench, `near-seat-bet.spec.ts`. `TableRenderer` narrows to `"webgl_3d" | "racetrack_2d5"`;
`ActionBar`'s variant renamed `"classic"|"3d"` → `"flat"|"3d"`. Trimmed rather than deleted where
classic-looking code is still load-bearing: `table-geometry.ts` (racetrack's own fallback + the 3D
room's DOM seat cutouts), `seat-ring.ts` (kept `seatAngle` only) — surfaced a real dangling-default
bug in `ChipScene`'s constructor, fixed. `12-responsive.css`'s portrait media query was deliberately
NOT split apart — it interleaves dead classic-table CSS with live lobby portrait rules and untangling
it wasn't worth the regression risk for CSS that already has zero effect. `lib/scene/CLAUDE.md`
rewritten (it still described pre-racetrack reality).

### Leaderboards are PvP-only; Memory Match's board removed (2026-08-24)
Rule, restated three times by Kayo: every PvP game gets a leaderboard, poker keeps its own (hands
won/biggest pot), Ante Up SOLO games get none — per-difficulty boards rejected as "too much" screen
cost. Memory Match predated the rule; fixed to match via migration: `recordMetricResult`/
`average_metric`/`lower_better` and the `metric_sum`/`metric_count` scoring machinery are deleted
entirely (the columns stay, migrations are append-only); `global_leaderboard_entries()`'s SQL no
longer special-cases `'memory-match'`. `isHeadToHeadGame` is now registry membership, not
`kind === "win_loss_record"`. Old `game_leaderboard_stats` rows for memory-match are left in place,
inert.

### Ante Up: Minesweeper, first of a 12-game solo+PvP expansion (2026-08-24)
Kayo's ask: 10 more solo games + PvP versions, one game at a time, fully built before the next starts
— see `[[project_stackchips_ante_up_catalog_expansion]]`. Minesweeper shipped: every board is
guaranteed solvable with no forced guess (mines placed after the first reveal, board re-rolled through
a logic solver) — this is why there's a per-tier clock, since a no-guess board has no natural risk
otherwise. A mine and a resignation both settle as attempt status `lost` (don't add a `resigned`
status — the DB CHECK constraint doesn't have one); the UI tells them apart via `board.explodedAt`. No
leaderboard, no migration needed (the `game` column on `ante_up_attempts` is already free-form text) —
same rule applies to the remaining nine games.

### Web Push re-engagement notifications (2026-08-24)
Built from scratch (no push infra existed): `push_subscriptions` table, VAPID keys (real pair
generated and handed to Kayo directly, not committed — nothing works until they're in env),
`lib/push/copy.ts`'s rotating PlayPokerGO-style copy pool. v1 trigger is only "come claim daily Gold,"
asked as part of account creation (a real user gesture), not a later prompt. Daily cron fires at one
fixed UTC hour with no per-player timezone — a known gap, not a fix. See
`[[project_stackchips_push_notifications]]`.

### Seat-art roster to 41; first two-angle characters; duplicate bot faces fixed (2026-08-25)
`character36`-`41` added (rare tier, 0/20deg only per Kayo's call — no 40deg plate for these).
`slice-seat-sheet.py` gained plate-polarity auto-detection and automatic no-gutter panel splitting.
Real bug found and fixed: bots could duplicate a seat-art face table-wide because uniqueness was only
enforced on tag/avatarPreset, not the resolved seat-art character — added `takenFaces` to
`pickBotIdentity`'s filter. Don't fix this by sizing the bot tag pool to the roster — they're meant to
grow independently.

### Seat-art roster to 35; character22-31 caught facing the wrong way (2026-08-22)
`character32`-`35` added. Also caught: `character22`-`31` (added the day before) were facing
screen-right, the wrong direction per `seat-art.ts`'s un-mirrored-plate contract — fixed by flipping
the 9 already-cut plates and rebuilding, not by branching the app. There is still no automated facing
check (a torso/centroid heuristic false-positived on 3 known-good characters) — verify a new batch's
widest panel against `character16`/`17` by eye, every time; see
`[[reference_stackchips_seat_sheet_slicing]]`.

### Ante Up split: Sudoku/Memory unlimited, Word Stack/Connections keep the daily gate (2026-08-21)
Same-day correction to the entry below: Kayo wanted a wager chosen before the game starts, with no
more daily limits *except* on Word Stack/Connections. Sudoku and Memory Match lost their daily gate
entirely — `/games/sudoku` and `/games/memory` now are what `/games/ante-up-sudoku|memory` already
were (unlimited wager-or-free replay). Word Stack/Connections keep exactly one gated attempt/day, but
the wager choice now gates *opening* that attempt instead of unlocking a second unlimited sibling —
their old separately-repeatable Ante Up routes are deleted. A wager replaces (does not stack with) the
free path's daily completion bonus.

### Ante Up unified: one section, four brain games (2026-08-21)
Word Stack, Connections, Sudoku, Memory Match merged into one "Ante Up" section (all `kind: "wager"`)
— first play/day is the shared daily puzzle (pays a skill-scored bonus via `daily-puzzle-bonus.ts`,
replacing the old flat "Complete one brain game" mission, which is disabled via migration not deleted),
then unlimited free replay or repeatable Gold wagers on fresh rounds. `ante_up_attempts` generalized to
all four games (added a `game` column; `tier` replaces Sudoku-only `difficulty`). Memory Match had no
loss condition to hang a wager on, so `ANTE_UP_MEMORY_MAX_TURNS = 20` invents a turn cap for wagered
play only. Superseded same-day by the entry above for Word Stack/Connections' daily gate.

### One dealer on the 2.5D table: Claira (2026-08-21)
Kayo's girlfriend, replacing the 3-dealer rotation outright (not reduced to a roster of one —
`dealerForHand`/`HANDS_PER_DOWN`/`DEALER_IDS` deleted). Blackjack's dealers (Loki & Finn, the dogs) are
untouched — two different dealer identities on two surfaces, a deliberate split. `prepare-dealer.py`
now auto-detects plate polarity and never upscales past the source image's own resolution. The name
badge in the shipped art reads "ELENA" — flagged for Kayo, nothing in code keys off it.

### Seat-art roster to 15 then 21; sheets are now sliced by script (2026-08-21)
Kayo switched to supplying one labelled 3-up JPEG turnaround sheet per character instead of pre-cropped
files; `slice-seat-sheet.py` cuts and keys them (floods at luma<=6, not `prepare-seat-art.py`'s <=1,
since JPEG ringing defeats the stricter threshold). `character13`-15 shipped as a new EARNED tier
(`price: null`, unlock at 250/750/1,500 lifetime hands won) — bots are excluded from this tier.
`character16`-21 followed on the Gold ladder instead of growing the earned tier (Kayo: keep the earned
tier at exactly 3 rungs). One supplied sheet was rejected outright — boxed-scene panels with no plate
to key against.

### Nine characters were facing the wrong way; the cast now uses gamer tags (2026-08-21)
`character13`-21 all turned screen-right, the wrong convention; fixed by flipping the source art (not
branching the code) and adding `slice-seat-sheet.py --mirror` for future sheets. Separately, Kayo:
every seat (bots included) should read like a real player's gamer tag now, not a first name —
`botProfiles` renamed in place (never reordered — identity indices are persisted per seat) and grown
18→30 entries. `characterAvatarOffers` (the store catalog) uses tags too but is a deliberately
separate list from the bot pool — nothing maps a store character to a bot identity. Blackjack's
dealers stay real names (they're staff, not opponents). See
`[[feedback_stackchips_gamer_tag_register]]`.

### Friends leaderboard: a head-to-head record per opponent (2026-08-20)
New `head_to_head_records` (profile, opponent, game), written in mirrored pairs by one RPC so a "me
vs. them" read never needs to flip anyone's win into a loss. Fed by the same settlement call that
writes the world leaderboard — no second call site. Migration backfills history from existing
`pvp_matches`/`cribbage_tables`. Membership is `isHeadToHeadGame`; poker and Memory Match are never
written (no single named opponent). See `[[project_stackchips_friends_head_to_head]]`.

### The five retired casino games are deleted outright, not just blocked (2026-08-20)
Roulette/Video Poker/Coin Flip/Baccarat/Hi-Lo (retired 2026-08-12, code left mounted) fully deleted per
Kayo's explicit follow-up — engines, services, routes, components, CSS (38 files).
`casino-round-service.ts` (their shared wallet path) went too, confirmed dead by grepping importers
first. `lib/arcade/retired.ts`'s guard mechanism stays as the documented way to retire a *future* game
without a same-day deletion — an empty `RETIRED_ARCADE_GAMES = []` is its normal resting state, don't
assume it's unused-and-safe-to-delete.

### Daily Wordle renamed to Word Stack (2026-08-19)
Trademark cleanup — every identifier/route/CSS class renamed (`daily-word-stack`,
`/games/word-stack`). Tile colors: correct/present stayed green/gold, `absent` recolored from
greenish-grey to blue-grey. Answer pool grown 751→1,119, mechanically verified against the existing
guess dictionary. See `[[project_stackchips_word_stack_rebrand]]`.

### Public-launch readiness pass (2026-08-19)
Corrected a stale claim in `docs/launch-checklist.md` (and repeated once in this file before being
caught): real Supabase Auth with cross-device account recovery already ships — verify auth/session
claims against `lib/server/link-account.ts`, not that doc. Real remaining gaps, in priority order:
rate limiting is process-local (in-memory Map, called from 77 routes) and needs a shared-store
refactor — deliberately left undone, it's a large payment-adjacent change that wants live review, not
an unsupervised pass; Realtime is capped at ~3,000 concurrent subscribers before needing Broadcast;
Supabase's "leaked password protection" advisor is off and now matters (toggle in Dashboard, no MCP
tool for it). Added OG/Twitter card metadata, `robots.ts`/`sitemap.ts`. A full marketing landing page
was deliberately not built — reversing the bare-sign-in-form is Kayo's call, not an inference. See
`[[project_stackchips_launch_readiness_assessment]]`.

### Cribbage: a 3-4 player free-for-all table (2026-08-18)
New parallel N-seat contract (`lib/cribbage/`) rather than a fifth 2-player duel — `pvp_matches` is
hardwired to exactly two seats at every layer. Full standard rules (deal 5, crib, pegging to 31, race
to 121); counting has no player decisions so it resolves automatically the instant pegging empties
every hand. Human-only, no bot fill (a bot winning a share of a real Gold pot was judged worse than a
table someone waits on). Resigning ends the whole table immediately, pot to the higher score — there's
no well-defined "the rest keep playing" the way a poker fold has.

### The avatar collection and the seat-art roster became one system (2026-08-17)
The 11-character seat-art roster replaced the old 20-entry illustrated avatar catalog outright, art
and catalog both — one id space now sells/equips a character, supplies every avatar image app-wide,
and is what's drawn at a seated opponent's own seat (`seat.avatarCosmetic` read directly instead of
always hashing). `botAvatarFor` repointed to the character-only cosmetic list so a bot can't land a
3D-only id in its 2D seat. An earlier same-day attempt at this got fully reverted mid-conversation for
landing uncommitted and half-finished — this is the real, complete version, confirmed with Kayo piece
by piece. See `[[project_stackchips_illustrated_avatars_retired]]`.

### Site footer + info pages (2026-08-16)
Kayo wanted the lobby to feel like "a genuine web platform." Added a lobby-only footer plus `/about`,
`/help`, `/how-to-play`, `/rewards` — the five existing `/legal/*` pages had nothing anywhere linking
to them. `/rewards` is wayfinding only (every "claim" link routes back to where the action already
lives) rather than a second claim surface, so money-ordering rules can't be duplicated wrong in a
second place. See `[[project_stackchips_site_footer_info_pages]]`.

### Economy/retention redesign, milestone 1: missions (2026-08-14)
Kayo's directive: redesign the economy around progression/collection/achievement, not monetization.
Missions shipped first (auto-credited, no claim button) via `lib/missions/events.ts` fanning a domain
event out to every mission it feeds. Milestone 2 (achievements/badges) has since shipped too. See
`[[project_stackchips_economy_retention_redesign]]`.

### Voluntary support payments replace Buy-Gold (2026-08-13)
The Gold storefront was removed; every support tier (one-time or monthly Stripe) grants nothing — no
Gold, no gameplay effect, matching the support disclosure exactly. Don't add a Gold/gameplay reward to
a tier without updating that disclosure first. Gold purchases were later reinstated (see
`[[project_stackchips_gold_purchase_reinstated]]`) — support payments run alongside them, not instead.

### The 2.5D racetrack table (2026-08-13)
Third table renderer, camera-led where the (now-deleted) classic table was CSS-led — `fitCamera`
solves a real perspective camera and the DOM follows anchors the scene projects, rather than a
hand-tuned CSS ellipse. Landscape-only by design (a 2:1 table has no usable portrait framing) — falls
back quietly, never blocks play. See `[[project_stackchips_racetrack_table_rebuild]]` for the full
geometry/dealer/board history.

### PvP duels replace the retired house-gambling games; misc fixes (2026-08-12)
Roulette/Video Poker/Coin Flip/Baccarat/Hi-Lo retired (server-guarded, not just delinked);
Chess/Checkers/Trivia Showdown/Word Race added as 1v1 winner-take-all duels with balance-conservation
as the safety invariant (no house edge). Every duel engine's `tick()` must return null when nothing
changed or it livelocks the optimistic-concurrency poll. Puzzle-answer banks must be `server-only` —
Word Race's wasn't at first and leaked its answer bank into the client bundle. Also this pass: three
distinct click sounds replacing one generic cue, three remount bugs fixed from `/games/*` routes
unmounting the whole app, and 3D-room avatar-load-gate/gesture-playback fixes.

### Rewarded-ad faucet (2026-08-11)
Wait moved 30s→5min, grant TTL 10→20min to compensate. Adsterra zone rotated.

### Repo-quality pass (2026-08-06)
Deleted the dead `lib/server/table-manager/` worker (2,563 lines, no entry point) and
`cash-game-session-store.ts`. `STAKES_TIERS` collapsed from three drifted hand-written copies to one
tuple.

### Money-ordering rules (every staked game — Blackjack, PvP duels, Cribbage, Ante Up)
1. Debit the stake before the thing it pays for exists; a failed creation refunds.
2. Credit a payout only after the version-guarded settlement write is confirmed.
3. Settlement is always a single credit (`stake + net`), never a second debit.
4. (PvP only) Escrow releases exactly once, via a status-guarded write returning the row at most once.
Each service restates these at the top of its own file on purpose — breaking one is a silent money
bug. `pvp-match-service.ts` centralizes them for every duel and `cribbage-service.ts` generalizes the
same shape to N players; Blackjack keeps an independent copy deliberately (live, moving real Gold, not
worth restacking). Version columns double as the settlement idempotency key — a lost race must return
null, and null must never pay out (this is what makes a double-clicked action, a retry, or two tabs
settle once).

### Bot / economy behavior
- Bots leave/return voluntarily between hands (`BOT_VOLUNTARY_LEAVE_CHANCE`, never below 3 funded
  seats; `TABLE_FUNDED_FLOOR` = 6) — forced to 0 whenever `VITEST` is set regardless of env override,
  since hundreds of tests reach this indirectly through `setupHand`.
- Bot personality (`MANIAC`/`ROCK`/`CALLING_STATION`, 35/45/20 weighted) is independent of bot
  identity and re-rolled on every reseat; `trashContinueChance` per personality is what actually
  varies preflop looseness (VPIP ~45%/26%/64%).
- `creditGold`/`spendGold` go through row-locking RPCs (`credit_gold`, `spend_gold`), never a plain
  read-then-write — `adjustGold` is a deliberate exception, documented as admin-only for that reason.
- Gold purchases exist again (reinstated after Buy-Gold's 2026-08-13 removal — see
  `[[project_stackchips_gold_purchase_reinstated]]`). Level rewards (every 5th level) and
  daily-streak multipliers (capped ×2.5 at 7 days) are kept small for progression pacing, not to
  protect a sale price — `[[project_stackchips_gold_economy]]`'s revenue-protection framing is
  superseded, don't cite it for a faucet number going forward.
- The faucet stack for reaching 0 Gold: `claimBackstopGold` (1,000 Gold, open to guests, 12h cooldown
  on repeat claims), the daily grant (`DAILY_GOLD_GRANT` × streak multiplier), and rewarded ads for
  registered players (`REWARDED_AD_GOLD` × up to 6/day). All three are sized off
  `TIER_CONFIG[CHEAPEST_TIER].minBuyIn` (1,000, the floor for every staked surface), not off a Stripe
  price.

### Known open items / gaps
- M17 (chip cosmetics) was parked until the 3D sim was finished — the 3D table is now deleted (see
  above), so this needs Kayo's own re-decision rather than staying silently parked.
- M16 (table invites) already shipped — private room-code tables only (`table_invites`,
  `/api/invites/*`, the Friends drawer's Invite button). Kayo declined extending it to public tables
  when asked directly; don't re-propose that as open work.
- `lib/server/game-store.test.ts`'s "does not prefer a populated table whose only human seat has gone
  quiet" is FLAKY, not red: it failed once in five runs at a pristine `origin/main` worktree, in
  isolation as well as in the full suite (measured 2026-09-04). Re-run it before treating a single
  red as a regression. `lib/scene/table-anchors.test.ts`'s dealer elbow-room test is separately and
  reliably red on main -- see `[[project_stackchips_headsup_geometry_regression]]`.
- `multiplayer.spec.ts`'s six-player test and two `safe-area.spec.ts` table tests fail identically at
  a pristine HEAD worktree, unrelated to recent work — reconfirm against a fresh worktree before
  treating a red run here as a regression (see `[[reference_stackchips_e2e_traps]]`).
- Several migrations named in the history above may or may not be applied to production yet — merging
  a PR ships code only. Verify current DB state by querying, never by trusting a historical note here
  or matching version stamps; see `[[reference_stackchips_migrations_not_auto_applied]]`.
- Rate limiting is process-local and needs a shared-store refactor across 77 call sites (see the
  2026-08-19 public-launch-readiness entry above) — a real gap, deliberately left for a live-reviewed
  pass rather than done unsupervised.

Update this section when scope changes; keep `CLAUDE.md` synchronized.
