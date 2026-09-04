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

### StackAcres has a farmhand: an NPC who walks out and does the job you just tapped (2026-09-04)
Kayo's ask was a FarmVille 3-style worker loop: an FSM, a global task queue, isometric movement, and a
code-driven squash-and-stretch instead of sprite sheets. Three premises in the ask no longer match the
code and are worth restating: there is **no farm grid array or tile data structure** (deleted 2026-09-03,
"districts hold stock, not plots" — a unit row has no position at all), the **sidebar is not the action
loop** any more (tapping the unit on the map is, since the direct-tap pass), and the actions are
collect/feed/water/clear/stock rather than Plant/Harvest/Feed/Clear. The isometric maths, the
delta-time loop and a distance-driven walk cycle all already existed (`iso.ts`, `depthAt`, `gait.ts`).
**He is presentation, and that is the load-bearing decision.** The tap has already reached the server
by the time he takes a step; he can never send, delay or cancel a write, so a closed tab mid-walk
loses nothing and the instant tap loop the direct-tap pass built stays instant. Two facts made
gating him the wrong call rather than merely a bigger one: the districts sit hundreds of units apart
(a trip to Ox Fields is most of a minute), and **`collect` is a SWEEP** — `settleHarvest` prices the
whole set and Bountiful Harvest is a property of that set, so a worker collecting one unit at a time
would silently forfeit the synergy on every harvest. He is therefore **Farmstead-only** and does not
auto-collect anything; both were Kayo's calls, and both are the conservative end of what was offered.
Brain in `lib/stackacres/farmhand.ts` (four states, plus the queue) and `farmhand-hop.ts`, pure and
tested, because vitest only reaches lib/ and app/. Three things worth keeping: (1) the hop is folded
into the same `setScale` call as the facing mirror rather than tweened, which sidesteps rather than
works around the trap `popUnit` documents (update rewrites a sprite's scale every frame, so a tween
there is overwritten mid-bounce); (2) **a mirror only ever buys two of the four diagonals**, so the
four iso directions need a second painter, not a second flip — `farmhand` and `farmhandBack`, each
mirrored, picked by the sign of (x + y) where the mirror is the sign of (x − y); (3) the standoff is
authored in SCREEN terms and is BESIDE the unit, not in front of it — the first cut put him a few
units toward the camera, which sorts correctly and hides the hen completely behind a man four times
its height, and only a screenshot showed it. Verified headed on the real GPU: headless Playwright
runs this scene at ~20fps and Phaser's smoothed delta then makes everything crawl, which looks
exactly like a movement bug and is not one. Branch `feat/stackacres-worker-npc`, no migration, no
server change.

**He is RIGGED, not a sprite, and that was Kayo's second call on this.** The first art pass shipped
one FLUX render per direction with a squash-and-stretch hop on it, and he called it immediately:
"the legs on the character arent moving like he a still png just bouncing around... stardew valley is
a pixel art and can pull this off." He is right twice over, and the second part is the useful bit:
**the bounce made it worse, not better**, because it put motion everywhere except the legs and so
pointed straight at the thing that was not moving. There is no vertical hop left anywhere.
`lib/stackacres/farmhand-hop.ts` is deleted; `farmhand-walk.ts` replaces it with a two-bone cycle
(hip swing, knee fold, and a small mid-stance rise), and the scene draws both legs into one Graphics
every frame from those angles. **A sprite sheet was not available and that is why this is a rig**:
the art is generated, and schnell has no identity control between generations, so N generated frames
are N different men in the same clothes. What is stable is ONE render — so the render is cut at the
crotch (`rig_farmhand.py`), the upper body stays as art because it does not deform in a walk, and
everything below the hip is drawn. The seam is invisible because the overalls are one continuous
denim from bib to ankle and the leg colours are sampled out of the render itself. Four things worth
keeping: (1) the torso painters' ANCHOR is the hip midpoint on the cut line, so placing one is just
"put the pelvis here" and the two views can carry their pelvis in different places inside their own
box (they do — the front's sits left of centre, the back's right of it); (2) **the hip stands
deliberately LOWER than a straight leg is long** — this is forward kinematics, so a rise on a fully
extended leg would lift the stance foot off the ground, and the slack is what pays for it; (3) the
rise peaks at MID-STANCE (`cos`, not `sin`) — half a cycle out is the difference between a walk and
a limp; (4) child order is shadow, legs, torso, so the hip joints vanish under the overalls instead
of showing as two rotating stubs. Judged on a cropped ten-frame filmstrip of one stride, which is
the only way to see a walk — a single screenshot cannot tell a walk cycle from a static pose.

**The art is FLUX-generated, same pipeline as Grandfather Ray.** Kayo saw the hand-drawn painter and
called it, so both views were regenerated through `~/.local/share/flux-sprite-test` (`task-farmhand/`,
byte-identical `STYLE` string to the animals so a new character lands in the same accidental look as
the shipped cast rather than drifting to its own). Runtime 3D was considered and not taken: the WebGL
room was deleted outright on 2026-08-26 and one NPC does not justify putting `three` back into a 2D
Phaser scene. Pre-rendering a Blender turnaround to sprites is the version of "3D" that would fit
here, and is worth it only if this ever wants a real 8-direction cast — every other thing on the map
is FLUX flat art, so a lone 3D render would be the one object not matching. **The seed pair was
chosen on COSTUME, not on the best single render:** schnell has no identity control across
generations, so what has to survive between two views is the outfit, and seed42 is the only pair
where it does. That is cheap here only because the back view has no face to disagree about. Three
prep findings worth keeping: (1) **`prep_new_assets.py`'s brown "mud" strip mask eats brown leather
boots** — it is `r-g>25 and r-b>40`, and since the boots are the lowest thing in frame, the
low-in-frame gate that protects a red shirt actively selects FOR them; the first run cut 24-34% of
the red-brown pixels and produced two men whose legs end at the ankle, invisible on the white page it
was cut against and obvious on grass (check art on GREEN, again). (2) **Facing is normalised in the
ASSET, not with an `ART_FACES` entry** — that constant is keyed by painter name and would flip the
drawn fallback underneath too, which already faces right. (3) Assets are fitted to CONTAIN the box
rather than to match its height, because `spriteBacked` stretches whatever it is handed to the
painter's own 20x40 box; a standing figure survives that squash, a walking one mirrored every time he
turns does not.

**Still open:** he walks through the pen fence rather than round to its gate, and there is one worker
at one district — a per-district base is the small follow-up if Kayo wants him elsewhere.

### StackAcres crops are watered, and drawn far bigger than the rest of the world (2026-09-04)
Crops now mirror the livestock hunger mechanic: a `thirstMs`/`last_watered_at` pair, and a free `waterStackAcresUnit` write that pushes `ready_at` forward by however long the soil sat dry. One deliberate divergence from hunger: a crop that finished growing *before* its ground dried is never marked dry — mirroring hunger exactly there was a real bug that un-ripened finished produce and re-charged the player for time already waited. A `/code-review` pass caught three more real bugs: the Gold-bought "restart" path didn't reset watering state, the migration backfill had to use `now()` instead of `started_at` or every already-ripe legacy crop would flip to dry on deploy, and a doubled hit-radius on ripe crops was swallowing taps on units behind them. Crop sprites now draw 1.6x-4x their nominal box size, since at world scale a carrot was a few indistinguishable green pixels. Watering itself is free and touches none of the money-ordering rules. Migration `stackacres_soil_watering` applied 2026-09-04 — applied about 80 seconds before the code merged, closer to violating "apply migration before merge" than intended, worth remembering as a near-miss. Live schema drift found in the process: a remote migration (`stackacres_units_fix_extra_slots_ambiguous`) has no matching file in the repo, flagged but not fixed here.

### StackAcres got a soundscape: a synthesised ASMR bed, farm SFX, real animals (2026-09-04)
The farm had three music loops and nothing else; every action fired the app's one generic chrome click. Ambience is synthesised at runtime rather than looped from files, since a looped bed becomes audibly repetitive inside a minute. Five continuous beds are filtered noise driven by a random walk, never an LFO, and sparse cues (crickets, birds) fire on a rolled gap rather than a fixed period. The mix follows time of day, district (Ox Fields windiest, the Wallow wettest), and the animals a player actually owns. Only six sounds are real recordings, since a throat and resonant timber are hard to synthesise convincingly; everything else, including all action sounds, is synthesised. Two real bugs fixed in passing: the mute toggle was double-negated so it always showed the wrong state, and the farm route was eagerly loading the poker table's ~450KB cue set. Branch `feat/stackacres-audio`. Still open: the music itself, and a few animal sounds (duck, goose, rooster).

### StackAcres went single-currency: harvest pays Gold in one step, plus synergies (2026-09-04)
Bushels are gone. Collecting used to fill a barn, the barn was sold at Ray's for Bushels, and Bushels
were queued at a daily exchange window for Gold; a harvest now values and pays itself in Gold in one
act. **The exchange window went; the ceiling behind it did not** -- `STACKACRES_GOLD_CEILING` (15,000
flat, per player, per UTC day, hard-mirrored in `reserve_homestead_exchange`) is now applied to the
harvest itself. That distinction is the whole safety story: the Bushel firewall only ever made the
farm's internal numbers cheap to get wrong, and it was always the flat ceiling that stopped the farm
printing money. **Every Bushel price was multiplied by 2** -- the exact rate the window paid -- so the
internal balance (seed against yield, muck at 40% of a tier's net, feed under a tenth of what eats it)
and the ceiling's calibration both survive untouched, and no price on the shelf moved
(`STACKACRES_GOLD_PER_SEED_BUSHEL` 100 -> `STACKACRES_SEED_MULTIPLE_TO_OWN` 50; a Cattle Pen is still
60,000). Deleted rather than converted: the 150-Bushel starting grant (every player already has Gold),
`homestead_inventory`'s use (table left inert, like `homestead_plots`), `sellStackAcresProduce` and
`exchangeStackAcresBushels`.

**Bountiful Harvest** (`lib/stackacres/bounty.ts`) is the one new mechanic: collecting is a SWEEP now,
and a synergy is a property of the set -- Mono-cropping (3+ of one kind, 1.05 rising to a 1.30 cap) or
Crop Rotation (both tracks present, minority share >= 1/3, up to 1.25). They cannot stack,
structurally: one kind cannot also be two tracks. A unit tapped on its own is a one-unit sweep and
earns nothing, which is what the new bottom-centre Harvest key is for.

**LAND MAINTENANCE WAS ALREADY HERE, in Bushels, from the sectors pass earlier the same day** -- this
merged with it rather than replacing it. What survived from that version is what it got right: the
charge base is **slots on cleared ground** (`unlockedPlotCount`), not units standing, or a player
could clear every district and pay nothing for the empty room; and the **first three plots are free**,
so a farm that has cleared nothing never sees a bill. What changed is the denomination and, more
importantly, the SHAPE: the fee is `25 * (plots - 3)^1.5` Gold, **netted out of what a harvest pays
and clamped at it**, so it can leave a harvest worth nothing and can never reach a balance. That is
the answer to `sectors.ts`'s own original objection that a Gold upkeep would "take real value out of a
player's balance on a timer" -- nothing is taken on a timer, and nothing is taken from a farm nobody
is harvesting. `landGate` went with it: gating growth on arrears existed because a Bushel debit could
go unpaid while the farm still earned elsewhere, and a farm producing no Gold has nothing to sink.
The ledger is main's own `homestead_upkeep` + `raise_homestead_upkeep`, reused as-is (raise-to-target,
because a day's bill rises when a slot is bought at noon); only the currency changed, and the
`bushels` column keeps its name as a legacy compatibility id like every other `homestead_*` object.

**Five things worth keeping.** (1) A harvest **reserves against the ceiling BEFORE settling any unit**
-- the reverse of rule 2 -- because a full day discovered after the crops are gone would consume a
harvest and pay nothing; the cost is `release_homestead_exchange`, which only ever subtracts and is
floored at 0. (2) **A smaller sweep can be worth MORE than the sweep containing it**: 3 cattle + 1
carrot earns nothing (one crop in four is below the rotation floor), while the same 3 cattle alone are
a Mono-crop worth 228 more. That is why the re-price after a lost race is capped at what was reserved;
`harvest.test.ts` pins the counter-example. (3) `creditGoldByProfile` is held to **exactly two call
sites** -- one `refundGold` helper and the harvest payout -- because counting credits stopped meaning
anything once every spend path gained a refund. (4) **`collect` lost its ban carve-out.** It was
exempt while it moved no money; it pays Gold now, so leaving it was the one way a suspended account
could earn. (5) **A crop left alone never ripens** now that watering shipped, which makes crops
useless as a passive test fixture -- the Hen Coop is the only tier whose hunger window is longer than
its own cycle, so it is the fixture for anything not about tending.

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

**Same day, second pass: still too loud.** Kayo flagged wind again by ear against the running `next
dev` instance after the 0.55-ceiling cut above had already shipped. Cut again to 0.05..0.3 -- the
likely reason the first cut wasn't enough is that wind's 400Hz bandpass sits directly on top of
`air`'s own 420Hz lowpass floor, reinforcing it in a way a same-bed-vs-other-beds ceiling comparison
doesn't catch. Confirms the rule above rather than replacing it: bed levels are ear-tuned, not derived,
and a fix that looks right on paper (ceiling now matches grass/insects) can still be wrong against the
whole mix playing at once.

Verified live, not just built: `next dev` in memory mode with a minted session and a real access
grant, driven in Chromium at 1280x720. AudioContext running, **zero console errors**, and the
soundscape provably changes with the clock -- at night 1 oscillator / 37 noise sources (crickets), at
a pinned midday 13 / 6 (birds), the exact inversion the plan describes. Full `npx vitest run`
2828/2829 (the one red is the pre-existing PR #163 `table-anchors` regression), `npm run lint` and
`npm run build` clean. Branch `feat/stackacres-audio`. **Still open:** the music itself is untouched
(the three tracks are ~3min each and regenerating one costs more than the whole credit balance), and
there is no duck, goose or rooster -- the pond has ducks on it that make no sound.
Migration `20260904150000_stackacres_release_allowance.sql` is **written and UNAPPLIED** (just the one
function; Land Maintenance needed no new schema). See
`[[reference_stackchips_migrations_not_auto_applied]]`. Branch `feat/stackacres-harvest-gold-upkeep`.
Verified after merging origin/main: isolated StackAcres suite 23/23 green, `tsc` clean, lint 0 errors,
`npm run build` clean, `tests/e2e/stackacres-harvest.spec.ts` green.

### StackAcres is tapped on the map itself; the sidebar became deep management (2026-09-04)
Replaced the tap-district → open-panel → find-row → press-Collect loop: tapping a unit's own picture now collects, feeds, or clears it directly, and tapping bare fenced ground opens a small radial seed menu at the fingertip. The sidebar drawer no longer opens on travel and now leads with Gold decisions rather than the unit list, but its rows stayed — the canvas is `aria-hidden` and the rows are the only keyboard/screen-reader path to these actions, and the only place retiring (which refunds nothing) can happen. The hit test resolves at pointer release inside the scene's existing gesture pipeline rather than via Phaser's own input system, which stays off entirely here to avoid double-handling every press.

### The woodland became forest: a world-space field, bigger trees, lanes through it (2026-09-04)
Kayo's feedback went through two rounds: first that the map read as empty and the tree art looked bad, then, after a redo, still empty, trees too uniform in size, wanting real forest with maze-like gaps between stands. The actual fix: tree placement moved from a per-chunk random roll, which can never produce a stand spanning many chunks, to a world-space noise field with no chunk boundary, plus winding lanes cut back out of the mass. Trees also grew substantially (roughly 1.5-2x per size tier) and each instance now scales individually instead of rendering identically. Art is FLUX-generated PNGs behind the existing `spriteBacked` fallback pattern; asset-prep traps are in `[[reference_stackchips_flux_texture_and_cutout_prep]]`. Branch `feat/stackacres-tree-clusters-flux-art`, not yet committed.

### StackAcres' chrome is its own visual world now, not Neon Marquee over grass (2026-09-04)
Kayo: the farm's GUI "looks too much like a flat, generic web app sidebar." `52-stackacres.css` is now the second documented carve-out from the app's styling contract alongside the felt table — inside `.sa-theme`, surfaces use a 3px outline and the farm's own two radii, and nothing reaches for the app's `--brand-*`/`--neon-*` tokens. The material language comes from `art-palette.ts`'s existing ramps rather than new colors: a button's thick bottom edge is literally the material's own "rim" face, and pressing it travels the block down onto that face. Baloo 2 is self-hosted as the app's first webfont, deliberately scoped to this one route.

### StackAcres drops the plot grid: districts hold stock, not plots (2026-09-03)
Kayo wanted no visible plot patches at all: select a district and a sidebar reflects what can be bought or tended there. Confirmed over several rounds of questions since a similar-sounding ask had been gotten backwards on the pen-zoning pass just before this one. **Plot ownership is gone outright**: you buy an animal or crop directly (Bushels to grow one, Gold to buy one outright) and it appears in whichever district its kind lives in (hen@Farmstead, crops@Long Meadow, sheep@Wallow, cattle@Ox Fields, unchanged mapping). Travelling to a district via the signpost is the selection; a fixed DOM sidebar (`stackacres-district-panel.tsx`'s `StackAcresUnitRows`/`StackAcresBuySection`) lists what's standing there and what can be bought. Concept was approved from a working HTML mockup before any code changed, per Kayo's standing rule for map/UI direction.

**The old buy-a-plot-then-plant-it step is replaced by a per-KIND capacity ladder**, Kayo's call: each of the five stock kinds gets its own free base cap of 3, extendable up to +3 by Gold at a flat per-kind price (`stackacresCapacityPrice`, `lib/stackacres/catalogue.ts`). This is a genuine economy change: the old cap was shared across all livestock kinds, so total possible concurrent livestock rises from 3 to as much as 18 fully expanded, an honest consequence of kinds having been physically separated since the pen-zoning pass. A unit is now a row with no position (`lib/stackacres/units.ts`, successor to `plots.ts`): `working | hungry | ready | mucked`, existing only once bought. `homestead_plots` stays in place, inert; `homestead_units` is the new table, backfilled with the 4 real working rows production held.

**A mucked unit still counts toward its kind's cap** — a real bug caught only by driving the live UI: the first cut counted only `working` rows, so a mucked unit stopped costing anything once units had no tile to hold hostage, letting a player buy a fresh one instead of paying the muck fee. Fixed same-day in both `countOccupiedStackAcresUnits` and the DB trigger `homestead_units_enforce_stock_shape` (migration `20260903190000`, applied same day as the table it patches). Server actions drop `plotIndex` in favor of nothing (buying) or `unitId` (acting on an owned unit); `buy-plot` is gone, `expand-capacity` is the new Gold sink, and `stock`/`buy-stock` collapsed to one INSERT. A clean collect now deletes the row rather than emptying a plot back to `empty`.

The Phaser scene surgery (`stackacres-scene.ts`, 2,868 lines) was delegated to a background agent with an exhaustive keep/delete/add spec given the size and this codebase's higher bar for camera/rendering work. Deleted: the per-plot cell system, ghost-drag-to-plot placement, the tool-sweep gesture, and the floating detail card (replaced by the fixed sidebar dock). Added: one `UnitNode` per owned unit, a `Critter`-driven wander box for animals or a deterministic `cropSpot` (seeded off the unit's own id, no server-stored position needed), and one static straw-and-fence boundary per district. Verified with a real `next dev` + minted session + admin grant run — must use `localhost`, not `127.0.0.1`, or middleware's origin check silently 403s every POST while GETs keep succeeding. That live run also caught the capacity-expand button showing even when a district had room to spare (a real `district-panel.test.ts` coverage gap) and a stale line in Ray's welcome modal still referencing the deleted land-purchase step; both fixed. Migrations applied same day: `20260903180000_stackacres_units.sql` (`homestead_units`, `homestead_capacity` + `adjust_homestead_capacity` RPC, the stock/cap trigger) and `20260903190000_stackacres_units_cap_counts_mucked.sql`.

### The pens moved out into the districts: each animal has its own place on the map (2026-09-03)
First cut got the ask backwards: Kayo wanted each district actually visited to tend that kind's animals, not the middle land zoned by row. The four districts (Farmstead, Ox Fields, Long Meadow, Wallow) already existed as scenery from the same-day map pass; the fix stands each animal's pens physically inside its own district instead of fencing rows back at the farmhouse. An abandoned first attempt zoned the old single grid by row (all still at the Farmstead) and was reverted before shipping.

**The plots are four separate physical blocks now, one per district, not one 4x4 grid.** `plotPenZone(plotIndex)` still names a plot's kind (unchanged API), but `cellOrigin`/`plotIndexAt` now place each kind's own 2x2 block inside its district (`PEN_GROUP_ORIGIN`): plots 1-4 Hen Coops at the Farmstead, 5-8 Crop Fields at the Long Meadow, 9-12 Sheep Pens at the Wallow, 13-16 Cattle Pens at Ox Fields. The two districts that had an ambient unownable wild herd (oxen, hogs) had that herd retired outright, Kayo's call: the player's own pens are that district's life now. `zoneToolPolicy`'s four plot tools go from farmstead-only to all four districts.

The fence-merge idea survives generalized from 1x4 to 2x2: the shared rail between two owned plots in the same block still drops, but a 2x2 block has four possible interior edges instead of one row of three, so all four rails are now independently conditional; a block's own outer edge never drops, keeping four pens reading as one paddock. Real geometry collisions were caught by the existing path/prop tests before any screenshot: Ox Fields' own road and the Wallow's track both ran through the first-choice pen positions, forcing the blocks to move (cattle 560,70 → 680,70; pig -300,-390 → -320,-390). Only a screenshot caught Ox Fields' approach point still centering on the road's end rather than the new pen block, moved to 720,150. Branch `feat/stackacres-pen-zoning`.

### App-wide loading screen lands, ported onto AppShell (2026-09-03)
An older branch (`feat/app-loading-screens`) built the pieces before `AppShell` existed and before the 3D table was deleted; this pass ported the surviving state onto current main. New: `useMinHoldFade` (`lib/loading/min-hold-fade.ts`) drives every fade through one hidden/visible/hiding state machine with a minimum hold so a fetch fast enough to beat the network can't skip the loading state. `LoadingScreen` (`components/loading/loading-screen.tsx`) is the full-screen "preparing your seat" beat styled on Claira's existing cutout, PlayPokerGO-referenced per Kayo's original ask; `FadeSwap`/`Skeleton` crossfade a skeleton into real content once a panel's fetch resolves, now wired into `RankStrip`, `MissionsPanel` and `Leaderboard`'s row list (both panels gained a real skeleton where they used to `return null`). `table-loading-splash.tsx` was refactored to reuse `useMinHoldFade` instead of its own hand-rolled phase machine, keeping its 11s auto-hide backstop. New stylesheet `54-loading.css`.

**Mount point was decided fresh rather than ported**: the old branch mounted `LoadingScreen` inside `Lobby`'s own `!profile` branch (a bug that unmounted it before its fade could run). `AppShell` didn't exist when that branch was written and now owns exactly the needed signal (`profile`/`profileLoading`/`profileError`) computed once above every route. Mounted there instead, gated on `profileLoading && !profile` — both terms matter, since `profile` alone never clears for a signed-out visitor and `profileLoading` alone would flash the overlay over a returning tab's cached profile. This makes the cold-boot cover genuinely app-wide, covering a deep link into `/games/*` or `/leaderboard` before the first profile fetch settles, not just `/`.

### Gold finally buys something in StackAcres; daily ceiling 5k -> 15k (2026-09-03)
Kayo pointed out that a player arriving with a season of poker/ante-up winnings could buy an empty field but had nothing else to spend Gold on, having to grind Bushels for everything else. Now every animal and crop is buyable outright for Gold at one flat rule: **100 Gold per Bushel of its seed price** (Sprout 1,000 / Hen 2,500 / Cash Crop 6,000 / Sheep 15,000 / Cattle 60,000), deliberately not scaled by how many you own since that made "how much is a cow" unanswerable without knowing your own farm. Land is now flat 10,000/plot, buyable in any order (the old doubling ladder existed only to prevent a cheap tile stranding under a dear one). Bought stock is **permanent**: it re-sows itself at collection, never empties or mucks, which is what makes 600 Bushels vs 60,000 Gold honest prices for the same animal — one buys a cycle, the other buys the cow. Each district sells its own shelf, giving the roads a destination; `retire` exists so a full permanent pen isn't a trap (refunds nothing, confirmed twice).

**The invariant that changed, worth rereading before touching this again**: the long-standing rule against a third Gold path was "a Gold→Bushels round trip would launder Gold through the capped window," which only holds when the inbound rate is at least as good as the outbound one. At 100 Gold/Bushel in vs 2 Gold/Bushel out, every round trip returns under 10% (`market.test.ts` holds it). **The real invariant is direction, not count: a path that spends Gold is a sink, one that pays Gold is what to stop over.** The existing tripwire test counting `spendGoldByProfile`/`creditGoldByProfile` call sites fired and was updated deliberately, not silenced.

Daily ceiling raised 5,000 → 15,000/day (migration `20260903130000`, applied to prod same day alongside `20260903120000`) — the old ceiling made a 60,000 Cattle Pen's payback irrationally long now that Gold has something to buy. **Flatness is still the invariant: it must never scale with land, stock, Bushels, Gold held, or trading skill** (honest arithmetic: 3x/day, ~5.5M/yr maxed daily). Safe to apply before code deploy since `p_ceiling` can only tighten. Also fixed: `homestead_harvests.stake` would have recorded a notional 600-Bushel cost nobody paid on bought plots; a `permanent` flag now travels on the ledger row instead, since `stake` cannot be 0.

### Four generated sprites ship as images; the rest of the farm is still drawn (2026-09-03)
Kayo's call after a FLUX.1-schnell bake-off on his own GPU: ship all four generated sprites (`cow`, `hen`, `barn`, `windmill`) knowing the tradeoffs. They sit off `RAMPS` (11 of 24 dominant colours >deltaE 10 from the nearest ramp tone), carry gradients where the rest of the farm is flat, and **cannot be recolored**, so a new animal in a new color stays a hand-drawn painter, not a fifth PNG. The win is silhouette over the old circle-plus-rounded-rect-legs painters; these are the first files StackAcres fetches, everything else still draws at boot.

**The discovery worth keeping: two of the four never reach the world.** The same-day isometric pass had already replaced the barn, silo and windmill with Phaser Graphics volumes, so the `barn` and `windmill` painters only appear on the play-screen cover and store/HUD icons, not the map — the generated barn art is a straight-on elevation while the world is isometric, so substituting it into the world would be wrong, not merely unfinished. `cow` and `hen` do reach the world as pen animals.

Plumbing is one seam: `stackacres-sprites.ts` holds the registry/DOM cache, and `spriteBacked()` wraps each painter so it draws the image once loaded and its own shapes until then — no draw site changed, so the drawn version stays the SSR/first-paint/404 fallback. Asset prep (`prep_assets.py`) needed a background flood-fill for alpha rather than distance-to-white (a near-white subject went near-transparent on grass), and the baked shadow/turf pad must be stripped before that fill or the shadow seals gaps and leaves a white slab behind. Branch `feat/stackacres-generated-sprites`.

### Homestead is renamed StackAcres everywhere, and the map got four districts (2026-09-03)
Kayo: nail the map design so the world doesn't feel empty, and rename everything including routes to StackAcres. Two passes landed in one branch (`feat/stackacres-map-zones`).

**The rename is plumbing this codebase had deliberately deferred.** ~1,600 identifiers across 70 files (`HOMESTEAD_`→`STACKACRES_`, CSS prefix `hs-`→`sa-`), every directory/file, and every route (`/games/homestead`→`/games/stackacres`, `/api/homestead[/actions]`→`/api/stackacres[/actions]`, `/api/admin/homestead-access`→`/api/admin/stackacres-access`). **The DATABASE deliberately did not move** — `homestead_plots`, `homestead_inventory`, `homestead_harvests`, `homestead_feed`, `homestead_exchanges`, `profiles.homestead_access` and the four RPCs keep their names, live objects in production, same posture as the `river_*` legacy identifiers this file already states as a rule. Two traps worth reusing on the next mass rename: a sentinel that contains the string being replaced isn't a sentinel (the restore pass matched nothing and silently renamed real DB identifiers until caught by audit); a naive rename loop caught `supabase/migrations/*.sql` filenames, which must never change since they're part of applied migration history.

**The map: four districts hung off the three roads that already left the yard.** `lib/stackacres/zones.ts` (35 tests) adds the Long Meadow, Ox Fields and the Wallow alongside the existing Farmstead, via two short connector path specs (`meadowLane`, `oxRoad`) kept separate from `lane`/`road` because `pathBounds` caps a spec's polyline at 512 units and one continuous road would span ~730. `chunkScenery` now excludes district interiors (`inOuterZone`) so woodland never grows inside one; each district grows its own furniture instead. Things only found by looking at it: district ground had to be Phaser Graphics diamonds, not a baked rectangle (too big to survive as a flat bake); a contrasting second ground color at real contrast read as a checkerboard, fixed by keeping `alt` within a shade of `base` plus a separate always-on `mottle` grain; overlapping translucent tile edges double-composited alpha into a visible lattice, fixed by abutting tiles exactly; and a hard alpha ramp around a rectangle still read as a rectangle, fixed with a randomly punched-through outer band.

The scythe is the first tool targeting the ground rather than a plot, needing `zoneToolPolicy`/`isActionValidInZone`; the meadow is a density field (0-3 per 16-unit tile) rather than a scatter since it's the one piece of map the player changes, and mowing is deliberately visual — it yields nothing (cut hay as a sellable item is its own future pass). Chrome: `stackacres-destinations.tsx`, a signpost rail easing the camera to each district's fixed-size gate window. **Still open:** the first-run "four red rings" (Plant held with no seed) now greets a new player on a map with a signpost; Ox Fields and the Wallow have no action of their own yet, just ambient life.

### StackAcres camera went isometric: real depth, not just repositioning (2026-09-03)
Kayo judged the farm as "basic poly" viewed from a dead flat bird's-eye camera and wanted real isometric depth like FarmVille. Before building, a slider-driven Canvas mockup (classic 2:1 isometric ratio) was published and approved — Kayo's own instruction to build a preview before any camera/projection change, worth reusing next time.

**The architecture that made this safe: `lib/stackacres/world.ts` never changed.** A plot is still a cell-square, `plotIndexAt` still a plain divide; the isometric shear is a new, pure, tested seam, `lib/stackacres/iso.ts` (`isoProject`/`isoUnproject`, exact inverses). Every world-space number the scene reads goes through `isoProject` before becoming a Phaser position or depth key, and every pointer point goes through `isoUnproject` before touching `world.ts`. Depth sort needed no new mechanism since projected y stays monotonic by construction — but one real per-frame bug surfaced: `sortPen`'s within-pen depth comparator sorted by `state.y` alone, correct only under the old flat camera, and now sorts by `state.x + state.y`, the real isometric key.

What got redrawn, not just repositioned: the four flat ground-plate painters became diamond Graphics fills; the barn, silo and windmill became real isometric volumes drawn with Phaser Graphics (one-sun three-tone shading) instead of baked painters; fence rails and the pen gate rotate to the diamond's two edge directions instead of lying screen-horizontal. **What shipped repositioned but still visually flat, the honest remaining gap**: baked path/pond textures and every smaller yard prop (well, wheelbarrow, crates, signpost, trees, etc.) — their anchors project correctly but their own shape isn't redrawn for the tilt yet. Branch `feat/stackacres-2-5d-visuals`.

### StackAcres collecting was also broken in production, same Phase 2 landing (2026-09-02)
Immediately after the stocking fix below unblocked stocking, collecting hit the same class of bug: PostgREST rejected an unknown-column error, `yieldQuantity` instead of `yield_quantity`, left over from copy-pasting the in-memory `cleared` object's JS field name into `collectStackAcresPlot`'s Supabase `.update()` payload in `lib/server/stackacres-store.ts`. Every other field in that call correctly used snake_case; `stockStackAcresPlot`'s own update already had it right, so only collection was broken. The loop had been stock → wait → collect fails since Phase 2 shipped; the memory-mode suite (167 stackacres tests) can't catch this class of bug either, same lesson as the stocking fix. Fixed by renaming the one key; no Gold/Bushels/produce were at risk since the write throws before anything is credited.

### StackAcres stocking was broken in production since Phase 2 landed (2026-09-02)
Kayo hit "Could not stock that plot" live. `20260901180000_homestead_inventory.sql` made `payout` inert (collections now yield produce via `yield_quantity`) and re-pointed the stocking trigger's ceiling accordingly, but missed the original CHECK constraint `homestead_plots_stock_matches_status`, which still required `payout is not null` for a working plot. Every stocking UPDATE since 2026-09-01 set status = 'working' with payout still null and got rejected outright — **every stock attempt had failed in production since that day**, never caught by the memory-mode suite (it doesn't exercise a real SQL CHECK) and apparently never actually attempted live until now. No Gold/Bushels were at risk since `stockStackAcres`'s catch block already refunds the seed cost on a database throw. Fixed by swapping the constraint's dependency from `payout` to `yield_quantity` (`20260902130000_fix_homestead_plot_stock_check.sql`), applied directly to production and verified there before landing the file. Also worth keeping: a self-cleaning verification `WITH ... AS (INSERT ... RETURNING) DELETE ...` CTE did not actually delete the row it inserted, leaving one real test row on a real player's profile — verify the leftover count directly rather than trusting a CTE's RETURNING.

### StackAcres: paths, a pond and yard props close out the art-volume gap (2026-09-02)
Closes the "art volume (paths, water, props, a character)" gap named in the premium-pass entry below. Paths and water and props are done here; **a character is deliberately deferred**, Kayo's call, since drawing a farmhand before the map itself is settled made no sense. `art-paths.ts` lays a dirt road and lane with damp rims and a worn centre band; `art-water.ts` adds a pond (lily pads, reeds, dock, wandering ducks, ripples); `art-props.ts` scatters a windmill, well, wheelbarrow, crates, log pile, mailbox, signpost, lamps, a flower bed, a broken stone wall and a scarecrow through the yard plus woodland litter beyond the farm. All three follow the existing painter conventions (one-sun shading, POT-safe `bakeTexture` baking).

A 2-agent review caught one real timing bug and one drift risk. `pokePlot`'s crop-tap guard set `juiceUntil` to a flat 460ms, but the field's last plant's actual chained squash-tween runs to 520ms, leaving a 60ms gap where a re-tap started a second tween fighting the first's yoyo-back — fixed to `this.now + 520` with the geometry spelled out in a comment. Second, `PROP_SIZE` hand-restated each prop's painted box that `art-props.ts`'s `PROP_PAINTERS` already carries, the same "drifted hand-written copies" pattern this file has hit before (`STAKES_TIERS`, the wager ladders) — a cross-check was added to `props.test.ts` so a future mismatch fails loudly. **Still open:** the wild-plot tint still reads as a flat grey rectangle when zoomed out, unchanged by this pass; the stocking CHECK-constraint bug (see the entry above) was independently found on this branch too and reconciled to match the canonical fix that landed on main first.

### StackAcres: the grid became a 2D sandbox viewport (2026-09-01)
Kayo's brief: a major evolution, not a new game — keep the existing economics (acreage, crops, pens) but move them into a fluid world the player drags, zooms and places things in, with the menu pinned to the screen. **Phaser is back** (`phaser` 3.90.0 exact), reversing the same-day earlier "DOM grid, drop Phaser" call, since that call was made when the field was a 4x4 of buttons and this brief explicitly asked for Phaser scenes. Two layers never mix: the world is one Phaser scene (`stackacres-scene.ts`) filling `.sa-field`; the header, toolbelt, seed strip, detail card, store sheet and modals stay DOM, absolutely positioned over the canvas, since a `<button>` is reachable by a screen reader and a thumb and a Phaser Text is neither. **Nothing on the server changed** — `lib/stackacres/world.ts` (pure, 22 tests) only decides where plot index N draws, which plot a world point hits, camera roam limits, and animal wander; buying still fills plots in ladder order, and "place the coop anywhere" is really "drop it on any empty plot" via a drag-ghost that snaps and fires the same `stock` action a tap would.

Things worth keeping: Phaser's ESM build needs `import * as Phaser`, not a default import, which only fails at bundle time; Phaser's own input system is switched off entirely and every gesture is read off native pointer events bound to the host element, since two input layers on one surface would double-handle every press; the detail card is a popover the scene repositions every frame it moves (`trackPlot`/`placeDetail`) rather than laid out in fixed DOM, since at phone zoom the map is barely wider than the screen. The keyboard/screen-reader path is `StackAcresPlotList`, sixteen real buttons hidden until focused. Verified with the memory-mode harness from `[[project_stackchips_homestead_farmhand_adoption]]` (`next dev` + minted cookie + admin grant, `localhost` not `127.0.0.1`) across tap, drag-place, pan, zoom, buy, reload; ready/hungry/mucked rendering was not verified live (needs a 15-minute clock).

### StackAcres premium pass: mipmaps that actually exist, one sun, tap juice (2026-09-02)
Kayo brought a five-file Phaser "mandate" (plain `.js` under a `src/` tree this repo doesn't have) plus a FarmVille 3 recording as the visual bar, explicitly saying not to take it as law. None of the five files were dropped in as-is: the config half already matched existing settings, and the rest would have reopened bugs already closed here (a phantom-finger pinch bug, an unremoved window-level wheel listener, frame-rate-dependent inertia, no pinch support at all, the "platform floating in the sky" transparency bug from 2026-08-31, a texture atlas load against a no-downloads rule, and a typo'd juice-engine guard that never guarded). What was genuinely useful was rebuilt properly in existing TypeScript.

**The finding worth keeping: `mipmapFilter: "LINEAR_MIPMAP_LINEAR"` had been silently doing nothing.** Phaser 3.90 only calls `gl.generateMipmap` on power-of-two textures under a plain `webgl` context, and every painter was baked at a non-POT size, so the zoomed-out farm (6x minification at zoom 0.6) sampled roughly one texel in forty. `bakeTexture` now pads every canvas to a power of two (`powerOfTwoCeil`, tested) and every image/texture call names the padded frame; verified live against the GL wrappers that every texture actually reports `LINEAR_MIPMAP_LINEAR`. Art pass: one consistent sun (high, upper-left) applied everywhere via `litMass`, with the `shadow` painter re-anchored so it lands under a thing's feet instead of hidden behind the trunk; tilled soil, a dotted lot marker, eave shadow and shingle courses on the barn, and a screen-pinned vignette with a warm sun corner. Motion: a per-pen depth sort by y (`sortPen`), idle breathing per animal, and `pokePlot`'s volume-preserving squash-and-stretch tap animation. **Still open:** the wild-plot tint reads as a flat grey rectangle zoomed out; the first-run "four red rings" gap; the honest remaining distance to the FarmVille bar is now art volume (paths, water, props, a character), not engine settings.

### StackAcres art went vector and the map went open-world (2026-09-02)
Kayo's brief: better graphics for 2026, keep the racetrack's smoothness, nothing downloaded. Every sprite and chrome icon is now a Canvas2D painter (`stackacres-art.ts`) baked into a Phaser texture at boot and rendered at the browser's own device pixel ratio, smooth at any zoom with no downloaded asset. `tilemap_packed.png` (the Kenney Tiny Farm sheet) is deleted; cut PNG tiles under `public/stackacres/tiles/` stay on disk only because another branch's lobby card still reads `cattle.png` directly.

The map also became genuinely open-world: the camera is no longer fenced to the acreage plus a forest ring. Roaming any direction grows procedural scenery in chunks (`chunkScenery`, deterministic per chunk so it regrows the same trees on return), denser near the farm and thinner far out, with `FARM_ZONE` kept permanently clear. `ownedBounds` (renamed from `acreageBounds`) lost its role as a camera fence, now only framing the opening shot and "back to the farm"; zoom limits became fixed constants instead of a function of the roamable area. The plots, economy and every server rule are untouched.

One trap worth keeping, found shooting QA screenshots: Phaser hears pointer events on the window, so a drag starting on a seed chip could pan the camera out from under its own drop target if handled through Phaser's own input. Rather than patch that with a target/pointer-id check layered on Phaser's events, `bindInput()` switches Phaser's input off entirely and reads every gesture — including its own pointer-id bookkeeping, since a stray third finger must be rejected and capture/cancel handled by hand — off native pointer events bound directly to the host element, the same shape of fix as `[[reference_stackchips_phaser_canvas_dom_overlay]]` one layer up rather than layered on top of it.

### Blackjack orphaned-round lockout closed; the "never exercised in prod" claim was stale (2026-09-01)
A money-path audit queried the live DB and found the claim wrong: 55 rows existed across 3 real
profiles, 53 staked, back to 2026-08-11. Real exercise surfaced a real bug: `blackjack-service.ts` had
no resign/abandon action, so a round abandoned before the player's first action sat `active` forever
and the one-active-per-profile constraint then permanently locked that profile out of Blackjack. Two
real players were found stuck this way (1,000 and 5,000 Gold, one just 47 minutes after account
creation). Fixed by hand first (refund + force-settle), then at the root: `resign()` added to the
engine plus a 30-minute staleness sweep in `blackjack-service.ts` keyed off the DB row's own
`updated_at`, not a new engine clock. See `[[project_stackchips_blackjack_orphaned_rounds]]`. Same pass
also closed a second gap: Nonogram's tiers were never added to the DB-side wager-ceiling trigger, so it
had no database backstop, only the TypeScript check; fixed, plus a test that reads the trigger's live
definition off the migration files so a future game's TS/DB ceilings can't drift apart unnoticed.

### The StackAcres is being rebuilt to match `jeremyckahn/farmhand` (2026-09-01)
Kayo brought that repo as the target for feel and mobile behavior. Its code is GPL-2.0-or-later and its
art is CC BY-NC-SA 4.0; the NonCommercial term rules the art out since StackChips sells Gold, so the
plan is to reimplement from the design, never copy a file. Economy, decided by Kayo: harvests sell for
an internal currency (**Bushels**) that never leaves the farm and absorbs all of farmhand's variance
safely, while Gold leaves only through one exchange window with a **flat per-player daily ceiling**
(not a percentage, not scaled by land or skill) — that constant-output invariant is what keeps this out
of the category Ante Up was in when it printed money. Collections stop paying Gold entirely, leaving
one faucet instead of two stacked. Five phases planned: feel, Bushels/inventory/shop, the exchange
window, the market, the meta; the ceiling is built before prices start swinging so the valve is closed
before there's any variance behind it.

### Phase 1 shipped the farmhand feel; Phaser is gone (2026-09-01)
Branch `feat/stackacres-farmhand-feel`. The Phaser canvas and `iso.ts` were deleted (reversing an
earlier Phaser decision made against a 3D proposal, not against DOM), replaced by a plain CSS grid of
buttons, each a stack of pixel-art tiles. This removes the whole coordinate-twinning setup `iso.ts`
existed for, since a canvas is invisible to screen readers and every painted tile needed a synced
invisible DOM copy; **the tile is the button now**. Interaction is tool-first: `lib/stackacres/tools.ts`
returns `act | blocked | none` per plot for the held tool, with `blocked` deliberately distinct from
`none` so a plot that's the right target but lacks Gold/feed/a slot lights red instead of reading as
simply not tappable. Three bugs only screenshots caught: state rings were invisible because an inset
`box-shadow` painted under the tile-sprite children (moved to `::before`); the affordance tint had to
be violet, not the obvious green, since every Kenney soil tile already sits on green grass; and the
plots needed a shared grass-colored gap between tiles so the grid read as one field rather than
islands. Art is Kenney's CC0 Tiny Farm pack.

### The access code is gone; access is a switch in the admin portal (2026-09-01)
Kayo scrapped the access code (which had also shipped non-functional, unset in its deploy env) in favor
of `profiles.homestead_access`, one boolean per player toggled from the admin dashboard beside the ban
and unlimited-Gold switches. Migration `20260901200000_homestead_access.sql` is **UNAPPLIED** and must
land before the code, or the gate's `select` throws and every StackAcres route 500s. Keyed on the
profile, not the auth account, so a guest can be granted access exactly like a registered player; fails
closed (column defaults false, nobody in until named, including Kayo). Two ordering rules hold again:
the gate runs after the rate limiter since it costs a DB read, and it reads the session cookie via
`readSessionToken` (never `readOrCreateSessionToken`) so a refusal can't hand a prober an identity.
`next start` forces production mode and can't run memory mode, so local HTTP verification without
Supabase credentials has to use `next dev`.

### SUPERSEDED by the entry above: the account allowlist became an access code (2026-09-01)
Briefly replaced the `STACKACRES_ALLOWED_USER_IDS` allowlist with a shared `STACKACRES_ACCESS_CODE`
traded for an HMAC pass cookie, rate-limited at 8 attempts/10min. Superseded same day by the admin-portal
switch above.

### Phase 3: the exchange window, the farm's one Gold outlet (2026-09-01)
Same branch. Bushels convert to Gold at 2 Gold each, capped at a flat **5,000 Gold per player per UTC
day** (Kayo's numbers). The cap, not the rate, is the feature: a generous rate just means the ceiling is
reached sooner, which is the shape phase 4's price swings need. It was sized against the faucets that
already exist (daily grant, ad rewards, backstop), landing below the ~7,500/day the pre-Bushels
StackAcres paid uncapped. The ceiling is a bare constant in `lib/stackacres/exchange.ts`, asserted as
such by its own test. Gold now moves in exactly two places (`buyStackAcresPlot` spends,
`exchangeStackAcresBushels` pays), guarded by a call-site-counting test so a third path fails rather
than ships. Migration `20260901190000_homestead_exchange.sql` (**UNAPPLIED**) needs no advisory lock:
the running total lives in the row being written (`homestead_exchanges`, PK `profile_id, day`), so
`insert ... on conflict do update ... where gold + p_gold <= ceiling` re-evaluates against the winner's
committed row; the RPC also hard-floors the ceiling via `least()` so application code can only tighten
it. A screenshot caught a real UI bug: the allowance bar filled as the day's Gold was spent, putting a
full bar directly above "0 of 5,000 Gold left today"; fixed to drain instead.

### Phase 2: Bushels, produce and the store (2026-09-01)
Same branch. Every StackAcres table was verified empty in production first, which is what made a free
economy reshape possible; re-verify before applying this migration anywhere that's since been played.
The loop is now farmhand's: harvesting puts produce in a barn instead of paying anything, and selling
that produce at the supply store earns Bushels, so `collectStackAcres` moves no money at all. Only
`buy-plot` moves Gold; everything else (seed, feed, muck, produce) is Bushels or items, and several
service tests assert Gold balance is unchanged across an action to guard the wall. New farms get
`STACKACRES_STARTING_BUSHELS` (150) exactly once via an `ON CONFLICT DO NOTHING` idempotency guard.
Migration `20260901180000_homestead_inventory.sql` (**UNAPPLIED**) adds one `homestead_inventory` table
holding produce and Bushels behind a single row-locking RPC; `homestead_plots.stake` now means Bushels
and `payout` is inert, replaced by a snapshotted `yield_quantity`. Since Bushels share a table with
produce, the `sell` action's item enum is the only thing standing between a request and infinite money;
there's a test for exactly that.

### StackAcres migration applied, and a revoke that wasn't revoking (2026-09-01)
`20260831150000_homestead_plots.sql` is **applied to production**, verified against real Postgres with
a self-rolling-back `DO` block. Applying it exposed a real hole: the migration revoked EXECUTE from
`anon, authenticated` but not from `public`, so the PUBLIC default grant left `adjust_homestead_feed`
(SECURITY DEFINER, taking a profile id as a parameter) callable by any anonymous caller against any
player's feed balance, which is bought with Gold. This is the same class of bug
`20260813170000_revoke_pvp_trigger_function_execute.sql` already fixed, now twice; the idiom is to
revoke `from public, anon, authenticated` and verify with `proacl`, not by re-reading the migration.
Supabase's advisor catches the SECURITY DEFINER case, so run `get_advisors` after applying anything that
adds a function. Also this pass: `50-stackacres.css` renumbered to **52** since main had since claimed
50/51.

### StackAcres ships to prod gated on one account, by env not by code (2026-09-01)
Kayo wanted it live but visible only to his own account. The gate is an allowlist of Supabase auth
account ids in **`STACKACRES_ALLOWED_USER_IDS`**, checked in `lib/server/stackacres-access.ts`; ids
rather than emails, since the session cookie already resolves to `profiles.user_id`. The repo is
public, so there's no default and unset allows nobody, including Kayo. `findUserIdBySessionToken` was
added to `profile-store.ts` since `publicProfile()` deliberately drops `userId`. The page itself is
genuinely gated (a server component reads the player cookie via `next/headers` and calls `notFound()`),
unlike the admin version, which could only manage a render-for-anyone/API-refuses compromise because
its cookie was scoped to `/api/admin`. Everything answers 404, never 403. The rate limiter runs before
the gate, reversed from the admin case, since this gate costs a DB read. An ordering test initially
false-failed against correct code because it string-matched bare function names inside a comment that
named the very function it measured; fixed to strip comments and match calls.

### The staff gate is gone; the StackAcres is unlisted, not closed (2026-09-01)
Reverses the entry below on Kayo's call to drop admin-only access entirely. The old gate worked but
was awkward: `ADMIN_SESSION_COOKIE` and `ADMIN_SECRET` are both per-environment, so a preview deploy
locked staff out along with everyone else. `lib/server/staff-gate.ts` was deleted; routes moved back to
`/api/stackacres[/actions]` and the page to `/games/stackacres`. `ArcadeGameStatus`'s fourth value was
renamed **`staff-only` → `unlisted`**, since there's no gate left to justify the old name.
`splitArcadeFloor` still shows only `live` rows, keeping it off the floor, but that's *all* that does:
the routes are open and move real Gold, so anyone with the URL can play it, the same "a catalog row is
not a lock" lesson `lib/arcade/retired.ts` records, now run in the other direction. Flipping `status` to
`live` is the whole release; a genuine future closure needs a route-level refusal, not a status value.
Also worth keeping: `npm run dev` can't verify this page locally because `next.config.ts`'s
`allowedDevOrigins` pins a stale address, silently killing client-component mounting; use a build and
`next start` instead. See `[[reference_stackchips_local_testing]]`.

### SUPERSEDED by the entry above: the StackAcres was staff-only under /admin (2026-09-01)
Briefly gated as a fourth `staff-only` `ArcadeGameStatus`, moved under `/api/admin/stackacres` and
`/admin/stackacres` because `ADMIN_SESSION_COOKIE` is scoped `path=/api/admin` and couldn't be seen from
`/api/stackacres`. Superseded same day by the unlisted entry above.

### Nonogram rebuilt to compete with the picross apps (2026-09-01)
Kayo wanted it to compete with real picross apps. The v1 shipped the day before had two real flaws:
boards were 58% uniform random noise, so solving one revealed static instead of the picture that's the
genre's whole reward, and every square was its own HTTP round trip, meaning 625 sequential requests on
the master board inside a 40-minute clock. Both fixed. Boards are now 65 hand-authored drawings at
5x5/10x10/15x15, each verified line-solvable upright and mirrored by `nonogram-pictures.test.ts` (the
gate that lets art ship, since ambiguity is invisible to the eye and this stakes real Gold); 20x20/25x25
are grown by smoothing a mirror-symmetric half-grid into blobs and repairing to solvable. The library is
`server-only` behind `nonogram-deal.ts`, with the engine taking a dealt board rather than importing one,
verified absent from `.next/static`. Gameplay gained drag-strokes that stop at the first wrong fill,
auto-cross, bounded undo, and hints that cost a mistake and refuse to spend the last one. A real CSS bug
was found and fixed: a custom property was declared on the wrong selector so it resolved against a
stale fallback instead of the per-rung cell size, silently clipping the top clue number off every
two-deep column (see `app/styles/CLAUDE.md`). Still open: the difficulty tiers were tuned against the
old unplayable random boards and are now likely overpaying; `ANTE_UP_NONOGRAM_TIERS`'s own header flags
this, with `ante-up-stakes.ts`'s ceilings bounding the damage until real solve-rate data comes in.

### The Mint became the StackChips Homestead: crops, feed, muck, three times of day (2026-08-31)
Built from Kayo's own expansion spec plus a rename (`sovereign-mint` → `homestead`, later `stackacres`;
`mint_plots` → `homestead_plots`; node types `pulse|core|matrix` → `hen|pig|cattle`), done while the
migration was still unapplied so it cost nothing. Five plot states across two tracks with separate
3-and-3 caps, so crops and livestock don't share a budget. Three corrections to the spec were needed:
the flat maintenance fee was arithmetically impossible for the cheapest tier, so `muckFee` became 2x the
tier's net bonus (holding expected muck cost at 40% of what a plot earns, tested); the spec's near-black
palette was replaced with the app's dusk palette per Kayo's earlier ban on copying that look; and the
20% muck roll can't be computed on read (it would re-roll on every refetch), so it's rolled once
server-side inside the guarded settlement write. Hunger freezes rather than kills, since per-plot push
notifications aren't buildable on this stack; feeding pushes `ready_at` forward by the hungry time, so
neglect costs time, never Gold. Feed is a per-player consumable behind a row-locking RPC
(`adjust_homestead_feed`). 35 new tests.

### The Mint's diorama became an outdoor farm; landscape CSS was measurably wrong (2026-08-31)
Kayo caught the treasury visually floating in the sky: the scene drew its ground on a
`transparent: true` canvas, so the app's own dark background showed through underneath. The whole
static world now paints once into one canvas texture at boot (`mint-world.ts`) with land running off
all four edges so there's no platform to fall off. Three rules worth keeping: owned plots are the
warmest color in the frame (a first cut had bright green scrub on locked plots stealing that role);
crops are violet while growing and gold only when ripe; and cloud shadows draw above the plot layer,
since a shadow underneath a fully-covering plot layer would just disappear. Separately, the landscape
breakpoint was measurably broken: its fixed chrome-height number undercounted the real total by about
30px, hanging the diorama below the fold on the exact target device; fixed with a flex-column shell
instead of a magic number, and its `@media` block has to stay last in `52-stackacres.css` since it
overrides base rules at equal specificity.

### Sovereign Mint: an idle treasury of staked, timed Gold nodes (2026-08-31)
Built from a GameDesigner-agent GDD after an engineering review rejected its original economy outright
(guaranteed 150-200% ROI, uncapped). The shipped version uses flat net bonuses instead of percentage ROI
(Pulse 1,000 stake → +50 in 15min, Core 10,000 → +600 in 4h, Matrix 50,000 → +2,500 in 24h) plus a
3-concurrent-node cap, capping guaranteed income around 7,500/day and preventing compounding with
bankroll; plots 5-16 are a pure Gold sink (2,500 doubling per tile). Rendered in Phaser 2D per Kayo's
explicit "no 3D" call, loaded only as a 1.2MB lazy chunk. The server mirrors Ante Up's money-ordering
rules exactly, with `payout`/`matures_at` snapshotted at plant time and harvest a single guarded update
that pays at most once. Migration `20260831120000_mint_plots.sql` is **unapplied**; see
`[[reference_stackchips_migrations_not_auto_applied]]`. Two tests caught real bugs during the build: GET
`/api/mint` had to use `readSessionToken` not `readOrCreateSessionToken`, and `entryCost` had to be 0 so
a broke player is never wallet-gated away from their own ripe harvest. Deliberately deferred with the
GDD's blessing withdrawn: per-node push, and cosmetic yield amplifiers, since purchased-cosmetic income
boosts touch the gambling-law posture and need Kayo's own call.

### Ante Up copy pass, plus Nonogram and Othello (2026-08-31)
Kayo flagged the Ante Up heading and every card blurb as stale; the heading now follows the house's
kicker/noun-phrase/line shape used everywhere else. The old heading's word-count helper (`spell()`) was
deleted after this pass found three more places it had gone stale by counting a `kind: "puzzle"` bucket
that's been empty since brain games moved to `kind: "wager"`: the hub tile literally read "0 free every
day," the first-run strip read "0 puzzles are free every day," and the same strip undercounted the
catalogue by three games. Blurbs were rewritten to describe each game's mechanic instead of repeating
its price, and colliding/generic section headers were renamed (Beat the board / Against the house / Head
to head).

Nonogram (12th solo game) and Othello (5th duel) shipped in the same pass. Nonogram runs 5x5 to 25x25 on
five difficulty rungs with the same no-guess generator guarantee Minesweeper uses, backed by a two-pass
DP line solver rather than arrangement enumeration; the generation loop provably terminates because its
repair step only ever adds a filled square, bounded by the trivially-solvable all-filled grid. Only a
wrong fill costs a mistake; crosses are free player notation. Othello was picked over Connect Four
specifically because Connect Four is a solved game and a player who memorized the first-player win could
farm every opponent drawing seat 0, for real Gold; its only real rules are that a move must flip
something and a side with no legal move passes rather than losing. Balance conservation was verified
live end to end (4,000 Gold across two players, before and after). Migration
`20260831140000_othello_leaderboard.sql` adds 'othello' to `global_leaderboard_entries()` and is
**unapplied**; see `[[reference_stackchips_migrations_not_auto_applied]]`.

### StackAcres: sunlight layers, and an equipment ladder bought with Gold (2026-09-04)
Two features on one branch. **Sunlight** (`lib/stackacres/sunlight.ts`, pure and tested, painted by
`bakeGodRays`/`bakeSparkle` + `animateSunlight`): five soft tilted shafts over the viewport and a
field of gold flecks on the ground. Both are budget-first, and the budgets are the reason the module
is data rather than numbers inside the scene. `GOD_RAY_MAX_ALPHA` is a **ceiling of 0.08 that
`godRayAlpha` clamps to** rather than a value it happens to return — the layer is ADD-blended over
the whole screen and the art is flat three-tone vector work whose legibility rests on those tones
staying apart, so above ~0.1 the lit and turned planes of every material start converging.
`SPARKLE_MAX` is a **hard pool size of 15**: the scene allocates exactly that many sprites once, in
`create`, and recycles them forever, so a frame never makes a game object and the effect costs the
same in hour two as in minute one. The rays are one baked texture (a per-frame Graphics redraw of
five soft bars over the full viewport would be the most expensive thing on this map), screen-pinned;
the sparkles are world-pinned and sort at their own y, because light comes from the sky but a glint
sits on a specific piece of grass. Both are skipped entirely under reduced motion rather than frozen
— a static ray layer is a permanent wash and a static sparkle field is fifteen dots. Verified live,
not just by test: diffing the canvas against a reduced-motion capture shows the five beams and the
flecks at 12x amplification, and a mean luminance lift of **0.95/255 (~0.4%)**, warm-tinted and
falling off downward exactly as the texture intends.

**The equipment ladder** (`lib/stackacres/equipment.ts`): Trowel (free) -> Iron Shovel (45,000 Gold)
-> Golden Spade (250,000), bought one rung at a time, permanently. Two effects. `reach` widens the
scythe's swathe — written as multiples (1x / 1.5x / 2x) because the shelf copy quotes them, with
`strokesToClearWidth` stating the same thing as TAPS and equipment.test.ts holding the copy to the
arithmetic. **The Trowel's reach is `SCYTHE_REACH` imported, not retyped**, so shipping the ladder
cannot nerf a player who buys nothing. `critChance`/`critBonus` make a harvest come up rich, and the free rung's chance is **zero** for the
same reason its reach is `SCYTHE_REACH`: a player who buys nothing must see no behaviour change at
all. That is not only principle -- a non-zero Trowel crit made every existing harvest assertion in
stackacres-service.test.ts non-deterministic, which is how the rule got tested.

**The crit pays Gold, and stays inside the one-faucet rule by construction.** It is paid BY
`harvestStackAcres`, out of the SAME reservation the sweep already took against the flat daily
ceiling: the reservation is taken optimistically (the sweep's net plus the most the held rung could
add) and the unused part handed straight back, exactly as step 4 already does for a unit that lost
its race. So there is still exactly one faucet and one ceiling — a lucky player reaches the same
daily wall as an unlucky one, just sooner. The roll happens ONCE PER SWEEP in step 3, beside the muck
roll and for the identical reason: after the guarded writes, so a refetch cannot re-roll it. A
sweep-level roll is also the only shape that fits, since Bountiful Harvest is already a property of
what was gathered together. **This branch was first written against the two-currency farm and paid
the crit in Bushels** to avoid a second faucet; the same-day single-currency pass (PR #311) made that
obsolete, and riding inside the harvest's own reservation solves it better. Refunds in the new action
go through `refundGold`, never `creditGoldByProfile` directly, so the currency wall's "credits Gold in
exactly two places" assertion still holds at 2. **The optimistic reservation falls back to the bare
net when it does not fit**, which is the difference between the ladder being a bonus and a penalty:
asking for crit headroom and giving up would refuse a harvest the farm can pay for, telling a player
with exactly one harvest's allowance left to come back tomorrow BECAUSE they own a better tool. That
sweep then simply cannot crit, since step 4 caps the payout at what was reserved.

The upgrade write is **guarded on the rung last seen held** (`upgrade_homestead_tool`), which is what
makes a double-tapped upgrade charge once: Gold is debited before the write, two racers both debit,
one matches, the loser is refunded. A first draft of that RPC had a real hole — the no-row path
inserted regardless of `p_from` — fixed to an explicit lock-and-branch. Migration **applied
2026-09-04**, `proacl` verified (service_role only; anon/authenticated cannot execute), guard
behaviour proved against the live DB with a self-rolling-back DO block, clean security advisor.

Tool sprites are FLUX-generated (`~/.local/share/flux-sprite-test/task-tools`), same pipeline as the
animals. Two traps worth keeping: the first trowel roll came back with a **near-white blade**, which
is the exact colour the silhouette pass keys the page out on (the `hen.png` ghosting bug) — re-rolled
in copper. Then the copper blade got eaten by the mud mask, because a blade is legitimately brown and
legitimately low in frame, and it TOUCHES its baked dirt pedestal so the two are one connected
component that no blob-level rule can split. Fixed with a **per-pixel** test gated to that sprite
(pad sat~98 vs blade sat 205-230), which is what `[[reference_stackchips_flux_texture_and_cutout_prep]]`
already says a touching ground pad needs. Checked on green, never on white.
### StackAcres districts became unlockable sectors; land has a price and an upkeep again (2026-09-04)
Three of the four districts now start under wild growth, and land itself is back on the Gold ladder for
the first time since the 2026-09-03 pass deleted the old 16-tile plot grid, which had left every
district visible but unaffordable from minute one. `lib/stackacres/sectors.ts` holds the whole layer as
pure functions: the unlock ladder (Long Meadow → the Fold → Ox Fields at 15k/45k/100k Gold), the
requirement checklist, the upkeep curve, and the overgrowth dressing. Unlocks are **derived**, not
stored: `unlockedSectors` counts any district the player already keeps live stock in, so an
already-playing farm keeps its land with no backfill needed and no row can be lost to cost someone land
they visibly own (the migration deliberately has no backfill for this reason). A locked district paints
no farmable dressing at all, only wild growth and a haze, with discovery driven entirely by tapping
anywhere in that zone. The upkeep ledger is **raise-to, not insert-once**: since a day's bill can rise
mid-day (buying a capacity slot), `raise_homestead_upkeep` raises today's paid total to a target and
settlement charges only the difference; the curve is `8 * 1.2^(plots - 3)` Bushels/day, roughly 59 at
all four sectors cleared and 916 at every slot bought, against a few thousand Bushels/day of gross
income. It's a **soft** gate: an unpaid farm can still collect, feed, sell and exchange, only growing is
blocked, and yesterday's unpaid bill lapses rather than compounding into debt. `clear-sector` is a third
Gold sink; nothing new pays Gold out. Verified live end to end against memory-mode `next dev`. Migration
`20260904130000_stackacres_sectors_and_upkeep.sql` is **unapplied**; see
`[[reference_stackchips_migrations_not_auto_applied]]`.

### Word Stack and Connections now carry their payout ladder (2026-08-27)
Closes a gap left open by the Ante Up economy fix earlier the same day: both games computed payout
from a module-level multiplier table at settlement, and since both are once-a-day boards that can be
opened in the morning and finished at night, a same-day retune (Word Stack's six-guess rung 1.5x ->
0.7x, Connections' three-mistake rung 1.5x -> 0.6x) could flip a board already in progress from
profit to loss. `StoredWordStackRound`/`StoredConnectionsRound` now carry an optional `wagerLadder`
snapshotted at open and carried forward on every guess, never re-read from the module;
`lib/arcade/ante-up-ladder.ts` holds the shared lookup. Stored only when `wager > 0`; rounds
predating the field fall back to the live table, the best available answer. **Memory Match has the
same defect and was deliberately left alone** since its multiplier is a range function rather than a
lookup map, and its exposure is minutes (one sitting, one-active-per-game) rather than a whole UTC
day.

### Ante Up was a money printer; wager ceilings + a payout retune (2026-08-27)
Kayo reported real farming ("my gf was easily farming coins"); it was the design working as written,
not a bug. Two compounding problems: no maximum wager existed anywhere (every route only bounded a
stake by the player's balance), and near-certain wins paid well above 1x (easy Sudoku gave 15 minutes
on a guaranteed-solvable grid for 1.5x, Memory Match had no winning turn count under 1x) — staking
everything on the safest board and restaking compounded 100k to ~19B in a day across three games.
Fixed both: `lib/arcade/ante-up-stakes.ts` adds ceilings (Sudoku easy 5k -> expert 500k; Minesweeper
beginner 5k -> expert 500k; the three no-difficulty games get 25k flat) enforced in every
`open*`/`start*` service before any Gold moves, and payouts were retuned down across all five games
so the slow rungs at Memory Match, Word Stack and Connections now deliberately pay back less than the
stake. Sudoku's clock ladder, which had run backwards, now grows with the grid; Memory's turn cap
dropped 20 -> 16. The DB ceiling guard is a **BEFORE INSERT trigger, not a CHECK constraint** (a CHECK
re-evaluates on UPDATE, and every settlement here is an UPDATE that throws, so an over-ceiling attempt
would otherwise become permanently unsettleable); `ANTE_UP_MEMORY_MAX_TURNS` is now snapshotted onto
the attempt as `maxTurns`, matching what Sudoku/Minesweeper already did; and
`lib/arcade/ante-up-result.ts` now computes net once for all five games so a sub-1x payout no longer
renders as a false win celebration. **Still open (resolved same day by the entry above):** Word Stack
and Connections computed payout from the live table at settlement, so a daily round opened before a
retune and finished after was paid at the new rate. Migration unapplied; see
`[[reference_stackchips_migrations_not_auto_applied]]`.

### Cribbage sync moved off its fixed 2s poll onto Realtime, same pattern as duels (2026-08-27)
Follow-up to the PvP duel Realtime migration below, requested on the identical pattern, named `crib`.
Two channels: `crib:lobby`, shared by every browser on the open-table join screen (the open-tables
list has no per-viewer filter to key a narrower channel on), and `crib:<tableId>` once seated — both
fired by a new `broadcast_crib_signal()` trigger on writes to both `cribbage_tables` and
`cribbage_table_players`, since joining only ever writes the seat table (never `cribbage_tables`
itself), so a trigger on just the table would silently miss every join. Real bug caught writing the
trigger: `NEW`/`OLD` are unassigned records, not null-valued rows, for a row-trigger operation that
doesn't apply, so a naive `coalesce(new.table_id, old.table_id)` on the DELETE-only leave path raised
"record is not assigned yet" — fixed by branching on `TG_OP` explicitly. Same shell pattern as the
duel branch: keyed on the primitive `tableId` rather than the table object, a 15s backup poll
alongside the channel, no fallback poll when Supabase isn't configured, and the same 429/Retry-After
backoff. Migration applied 2026-08-27 (`crib_realtime_signals`, verified via `list_migrations` and a
clean security-advisor pass).

### PvP duel sync moved off the fixed 2s poll onto Realtime (2026-08-27)
Resolves the "known open item" below (now stale where still quoted) — `duel-shell.tsx`'s own comment
had called the 2s poll deliberate, judging Realtime unnecessary, but Kayo asked for it anyway. New
per-profile channel `pvp:<profileId>` (`lib/pvp/duel-channel.ts`), fired by a `broadcast_pvp_signal()`
trigger on every write to `pvp_challenges`/`pvp_matches` naming that profile, mirroring
`table-channel.ts`'s invalidation-ping contract but keyed per-player since a challenge has no match id
to key on yet. Carries no version (a challenge and a match don't share one monotonic counter), so any
broadcast just triggers a full lobby re-fetch; a 15s backup poll still runs alongside as a safety net
since a 2-player duel has no other seated human to notice a stale socket. No fallback poll when
Supabase isn't configured or the browser's own profile id isn't known yet, matching `poker-app.tsx`'s
posture. Migration applied 2026-08-27 (`pvp_duel_realtime_signals`, verified via `list_migrations` and
a clean security-advisor pass) — the general "verify before trusting a historical note" caution below
still applies to older entries; see `[[reference_stackchips_migrations_not_auto_applied]]`.
- History below is a dense changelog, not the discovery narrative — one paragraph per pass covering
  what shipped and what's still load-bearing or still open. Full reasoning for any decision is
  recoverable from `git log`/PRs on the branch each entry names. Every pass listed was verified with
  the full `npx vitest run` + `npm run lint` + `npm run build` (`tsc` clean) before landing; recurring
  pre-existing failures are `safe-area.spec.ts` and (until fixed 2026-08-26) two
  `multiplayer.spec.ts`/`table-scene.spec.ts` reds — see Known open items. This file periodically gets
  compressed like this to stay under budget (2026-08-26 pass cut it ~101KB → smaller; by
  2026-09-04 it had grown back to ~151KB and got compressed again, down to ~85KB) — when redoing
  this, cut narrative/verification boilerplate, never a fact or an open gap.

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
Single-table Sit & Go, not a scheduled multi-table event, since every staked PvP format here is
deliberately human-only and a 6-max table just waits for real registrants rather than risking an MTT
field that never fills. Entry fee and starting stack both equal an existing `STAKES_TIERS` tier's
buy-in; blinds escalate on a hand-count schedule at turbo pace; winner-take-all. Reuses the poker
engine directly (`GameState.tournament`) rather than forking it: busting throws on rebuy, forfeits the
seat instead of handing it to a bot, and an idle tournament seat auto-folds forever rather than ever
going to bot fill. A `/code-review` pass caught two severe bugs the test suite structurally couldn't
(memory-mode tests never exercise a real SQL CHECK constraint): both new CHECK constraints were
written before the RPCs that violate them and hard-failed every deal/cancel attempt against real
Postgres, fixed by narrowing both to what's actually invariant; also fixed, an eliminated player's
table-row was never cleaned up, so they read as "still registered" and got bounced back into the game
they'd already lost. A follow-up optimize pass fixed a redundant double-profile-resolve on the
open-table lobby poll and serialized-should-be-parallel head-to-head writes on settlement. PR merged
into main alongside the 3D-table deletion below; migration unapplied — see
`[[reference_stackchips_migrations_not_auto_applied]]`.

### The WebGL 3D table is deleted outright (2026-08-26)
Resolves the "scrap under consideration" question open since 2026-08-19 — Kayo's call was direct: kill
it, scrap all of it, with one carve-out to keep the 2D seat-art roster (`character1`-`41`, never
3D-room code) exactly as-is. The whole subsystem was snapshotted under a pushed tag,
`archive/webgl-3d-table`, before deletion; recover any file from there rather than re-deriving it.
Deleted: `lib/game3d/` (63 files), `components/game3d/` (36 files), `app/game3d/`, the 3D bridge
component, every GLB asset, four asset-pipeline scripts, the `three`/`@react-three/*` npm
dependencies, and a separate 3D-only cosmetics slot (`CHARACTERS_3D`, `character3DCosmetics`,
`avatar3d` on `EquippedCosmetics`). Two files under a `game3d`-named path moved rather than deleted
since the racetrack table depends on them too: `table-shape.ts` → `lib/scene/`,
`table-loading-splash.tsx` → `components/table/`. **M17 (chip cosmetics), parked "until the 3D sim is
finished," needs Kayo's own re-decision now that there is no 3D sim left to finish** — not resolved by
this deletion.

### Classic portrait table deleted outright; racetrack is the only table (2026-08-25)
Kayo's call: the 2.5D racetrack is the sole table, the 3D room stays around disabled for later
("players will just have to turn their phones"). Deletes the dead `canvas_2d` code (already
unselectable since 2026-08-17): `table-scene.tsx`, `projection.ts`, `felt-art.ts`, the classic dev
chip bench, `near-seat-bet.spec.ts`. `TableRenderer` narrows to `"webgl_3d" | "racetrack_2d5"`;
`ActionBar`'s variant renamed `"classic"|"3d"` → `"flat"|"3d"`. Trimmed rather than deleted where
classic-looking code is still load-bearing: `table-geometry.ts` (racetrack's own fallback + the 3D
room's DOM seat cutouts), `seat-ring.ts` (kept `seatAngle` only) — surfaced a real dangling-default bug
in `ChipScene`'s constructor, fixed. `12-responsive.css`'s portrait media query was deliberately not
split apart since untangling its interleaved dead classic-table CSS wasn't worth the regression risk
for CSS that already has zero effect. `lib/scene/CLAUDE.md` rewritten to match current reality.

### Leaderboards are PvP-only; Memory Match's board removed (2026-08-24)
Rule, restated three times by Kayo: every PvP game gets a leaderboard, poker keeps its own (hands
won/biggest pot), Ante Up SOLO games get none (per-difficulty boards rejected as "too much" screen
cost). Memory Match predated the rule; fixed to match via migration: `recordMetricResult`/
`average_metric`/`lower_better` and the `metric_sum`/`metric_count` scoring machinery are deleted
entirely (the columns stay, migrations are append-only); `global_leaderboard_entries()`'s SQL no
longer special-cases `'memory-match'`. `isHeadToHeadGame` is now registry membership, not
`kind === "win_loss_record"`. Old `game_leaderboard_stats` rows for memory-match are left in place,
inert.

### Ante Up: Minesweeper, first of a 12-game solo+PvP expansion (2026-08-24)
Kayo's ask: 10 more solo games plus PvP versions, one game at a time, fully built before the next
starts — see `[[project_stackchips_ante_up_catalog_expansion]]`. Minesweeper shipped: every board is
guaranteed solvable with no forced guess (mines placed after the first reveal, board re-rolled through
a logic solver), which is why there's a per-tier clock, since a no-guess board has no natural risk
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
refactor, deliberately left undone since it's a large payment-adjacent change that wants live review,
not an unsupervised pass; Realtime is capped at ~3,000 concurrent subscribers before needing Broadcast;
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
and catalog both: one id space now sells/equips a character, supplies every avatar image app-wide, and
is what's drawn at a seated opponent's own seat (`seat.avatarCosmetic` read directly instead of always
hashing). `botAvatarFor` repointed to the character-only cosmetic list so a bot can't land a 3D-only id
in its 2D seat. An earlier same-day attempt at this got fully reverted mid-conversation for landing
uncommitted and half-finished — this is the real, complete version, confirmed with Kayo piece by
piece. See `[[project_stackchips_illustrated_avatars_retired]]`.

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
