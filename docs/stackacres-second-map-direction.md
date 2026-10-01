# StackAcres second map: empire/town direction (draft)

Status: **v1 world scaffold build authorized and started 2026-09-24** (Kayo: "You are to build the
first map reference I gave you first than this second map" — build-order confirmed in section 7).
Scope authorization (OPEN item 1) is resolved for the v1 slice described in section 7 specifically
— NOT for the rest of this doc, which is still design-open. Assembled 2026-09-24 from conversation
with Kayo plus a codebase research pass. This is not a companion to `docs/stackacres-direction.md`
— it is a *candidate* direction doc for a new, adjacent scope. It does not change anything about the
Homestead, which keeps `docs/stackacres-direction.md` and `feedback_stackacres_homestead_only_focus`
exactly as they are. Most sections below are still marked OPEN and need Kayo's answer before further
implementation — see section 8 and the build-status note after section 7.

## 1. What this is

A second, physically separate map from the Homestead. The player reaches it by crossing a bridge
(or similar boundary), reusing the scene-switch transition the Homestead already uses for building
interiors — not a new travel system.

The core loop, in Kayo's words: *"the user will be able to build their own empire if they work
enough. itll be hard but as they continue to earn more cash they can expand their farm and go into
the city to buy stores and make partnerships and gain relationships."* It's a hard-earned expansion,
not a freebie — the whole point of building it, per Kayo, is a second investment/sink layer for
Gold on top of the Homestead's.

Four expansion pillars, as named by Kayo: **Personal, Relationships, Business, Fishing.**

## 2. Confirmed pieces

These are things Kayo has actually said, not inferred:

- The map is chopped/cleared by the player (forest clearing), same physical-investment feel as
  Homestead land clearing.
- The player can hire NPCs to build infrastructure over time (roads, tile placement) — this is
  investment/progression, explicitly **not** the rejected Homestead "pre-painted decor road" idea.
- There's a grocery store on the map, already NPC-owned and running when the player arrives. The
  player does not start as its owner.
- Arc to ownership: (1) fulfill delivery/contract requests for the store — Ray-or-owner posts
  "need 20 wheat," player delivers, earns Gold + trust — this is a quest/contract queue like the
  existing Town Board, not a live marketplace; (2) enough trust/volume unlocks a purchase offer;
  (3) post-purchase, hire a produce-clerk NPC to run it and expand its build-out.
- The purchase offer is not automatic at a trust threshold. The player must physically find and
  talk to the store's manager NPC somewhere in the city — locating/networking with them *is* the
  Relationships pillar's first concrete mechanic, not a separate stat layered on top.
- Once bought, the store runs fully passively — visiting is a booster, never required. Kayo's own
  framing: *"i originally designed this game to be an investment and a sink for my apps entirety"*
  — so the store follows the same investment-not-idle-dashboard shape as the rest of StackAcres,
  not a new passive-income model.
- Kayo has explicitly authorized revisiting the Homestead north star's "no continuous/ongoing Gold
  sink" rule for this layer specifically: *"were changing the locked in decisions then."* Scope of
  that revision is this second map only — the Homestead's own economy is untouched.

## 3. Scale and structure (reference image, 2026-09-24)

Kayo sent a second reference — a map-key graphic from an existing game, *Chef RPG* (credited "by
ranituran" in-image), showing shops/vending machines/NPC home locations — with "this is what the
second map will be." **This is someone else's game and fan-made reference art, not an asset to
reuse.** What's confirmed direction is the *scale and structure* it shows, not its specific
content — nothing here should carry over actual location names, character designs, or art from
that game.

Structure confirmed:
- **A full town, not a single building.** Multiple named districts across one map (in the
  reference: cliffs, swamp, harbor, forest farmland, a train station), connected by paths.
- **Many NPCs, each with their own home** shown as a distinct building on the map, not an
  abstracted "the NPCs live somewhere."
- **Many shops, each with its own operating hours** (open weekdays only, open 24/7, open specific
  windows like 5pm-11pm for a bar) — shops are not uniformly available; a player visiting at the
  wrong time finds it closed. This is a new mechanic StackAcres doesn't have yet.
- **Standalone vending machines** as smaller, always-available points of interest distinct from
  full shops (drinks, candy, vitamins) — a lighter-weight commerce object than a staffed building.
- **Specialized crafting/research facilities** (in the reference: mixology, seafood, molecular
  gastronomy, BBQ, vegetarian, baking) — reads as a skill-tree-adjacent system, each facility
  teaching or enabling a different production specialty.
- A town hall, library, bathhouse, infirmary, barber shop and similar civic/service buildings
  alongside commercial ones — the town has non-economic destinations too, not just shops.

This is a materially bigger scope than section 2's single-grocery-store description. It doesn't
contradict section 2 (the grocery-store ownership arc can still be the player's first foothold in
this town) but it means the town itself is a much larger build than "a bridge, a clearing, and one
store." New open questions below (section 8) reflect this.

## 4. Visual direction (reference image, 2026-09-24)

Kayo sent a reference screenshot with the instruction to match its look for the second map. This
is a picture of a **developed end-game state**, not a fixed layout to build or hardcode. The
specific placement of plots, buildings and tiers in the reference is illustrative only — the
player builds and places their own layout over time, the same player-places-everything philosophy
`project_stackacres_map_design_framework` already established for the Homestead (house-only day
one, no pre-placed paths, player decides where things go). What carries over from the reference is
the *style and construction system*, not a floor plan:

- **Terraced elevation is a construction system, not a preset shape.** Stone retaining walls and
  wooden staircases are what clearing/building on a slope should look like once a player has
  developed a tier — but which tiers exist, how many, and their shape are outcomes of what the
  player has cleared and built, not a fixed map baked in ahead of time. A new player's second map
  should start far emptier than the reference and grow toward something like it, never spawn
  pre-terraced.
- **Persistent resource HUD, top-left, always visible**: an icon + number per resource — in the
  reference, Gold, Wood, Wheat, Workers. This maps directly onto the second map's own economy:
  Gold (shared currency), Wood (the material NPCs consume to build roads/tiles, per section 2),
  a crop/goods count, and a Workers headcount — the last one is a strong visual argument for
  showing hired-NPC count as a first-class HUD stat, which bears on OPEN item 5 (payroll
  shape): if Workers is a HUD number, payroll should probably be one line item per profile keyed
  off headcount, not per-NPC micromanagement.
- **A visible processing structure** (tank + external pipe run into a building) distinct from the
  greenhouse and silo — reads as a dedicated "this crop becomes a good" building, consistent with
  the existing StackAcres pattern of separate production buildings (Mill, Oven, Vat) rather than
  one generic factory.
- **Dirt paths connecting plots and buildings** are present and intentional here — this is fine for
  the second map specifically, since `feedback_stackacres_no_roads_clean_lawn` (no dirt paths,
  clean lawn) is a Homestead-specific rule; the second map's roads are explicitly meant to be
  player/NPC-built infrastructure per section 2, not rejected decor, and appear only where the
  player has actually chosen to hire NPCs to build them.
- **Dense pine treeline framing the playable area**, with a river and stone bridge at one edge —
  consistent with the "reached by crossing a bridge" travel note in section 1.
- Character art: overalls, straw hats, simple 4-ish direction pixel sprites, doing visible on-map
  work (watering, carrying baskets) rather than idling — matches the existing StackAcres character
  rig approach, not a new art system.

This is visual direction only — a picture of where a developed empire ends up, not a starting
layout. No art assets exist yet for the second map; this section exists so a future art pass has a
written reference for style and construction system, without treating the reference's specific
building placement as something to reproduce.

## 5. Far Field purpose and capacity (confirmed 2026-09-24)

Kayo: *"it should be the working fields. it needs clearing but can be designed to hold massive crop
fields, a stable for horses, space for potential cattle, more animals, and industrial factories so
when the character reaches this point they can begin building and hiring once they reach the
proper quest and made the right connection."*

This is the Far Field's intended **purpose and capacity**, not a floor plan — same distinction as
section 4's visual reference. Nothing here says where any of this goes; it says what the space is
*for* once the player clears and develops it:

- **Massive crop fields** — larger-scale, higher-throughput farming than the Homestead's plots.
  Not yet decided whether this is the same crop system scaled up or a distinct large-field
  mechanic; see open item 6 below.
- **A stable for horses.** A new animal, not currently in StackAcres' animal roster.
- **Space for cattle**, and room for animal variety generally beyond what's named. Reads as an
  expansion of the existing pen/livestock system (Cattle Pasture already exists as a concept in the
  old, currently-hidden district set — worth checking whether this revives that idea or is a fresh
  design for the Far Field specifically before building).
- **Industrial factories** — large-scale processing, beyond the Homestead's single-machine
  buildings (Mill, Oven, Vat). Scale and distinctness from those existing machines not yet decided.
- **Building and hiring only unlock "once they reach the proper quest and made the right
  connection."** This confirms the Far Field's capacity is quest/relationship-gated, the same
  pattern already established for the grocery store purchase in section 2 (trust/contract queue,
  then finding and networking with a specific NPC) — reuse that gating mechanic here too rather
  than inventing a second one. Exactly which quest(s) gate which capability (crop fields vs. stable
  vs. factories, gated together or separately) is not yet decided.

**How this changes the OPEN list below:** it doesn't resolve any open item outright, but items 2
(pillar relationship), 3 (second NPC job), 5 (payroll shape) and 6 (town scale) should now be read
against "crop fields + stable + cattle + industry, quest-gated" as the Far Field's actual intended
content, not against the abstract town-scale-only framing those items were originally written for.

## 6. The upkeep/liquidity-crisis mechanic

Kayo's pasted proposal (2026-09-24): a Dynamic Upkeep Matrix — land property tax scaling with plots
held, NPC worker salaries by skill tier, machine maintenance — and a Liquidity Crisis bankruptcy
state if upkeep goes unpaid: workers idle with a "No Coins" thought bubble, buildings lose power,
deliveries stop, recoverable by manual farming or an injection of Gold earned elsewhere in
StackChips.

**A working precedent for the tax half already exists and should be reused, not reinvented.**
`lib/stackacres/upkeep.ts` ("Land Maintenance") already runs continuous upkeep on the Homestead:

- Charged on slots of cleared ground held, `n^1.5` superlinear, first 3 plots free.
- Never a standalone wallet debit — netted off the top of the next Gold payout
  (`netUpkeepFromPayout` in `lib/server/stackacres-service.ts`), clamped at that payout so it can
  zero it out but never create debt. A farm that never sells never pays it.
- Assessed lazily off stored UTC-day timestamps (`homestead_upkeep`, one row per profile per day),
  no cron, no simulated tick loop — same elapsed-time-not-simulated pattern the north star already
  mandates for offline production.
- Best-effort: a maintenance-calc failure falls back to the full gross payout rather than erroring
  a payout that already earned its Gold.

This is the actual resolution to "continuous cost vs. never a per-action tax": the empire layer's
payroll/maintenance should copy this shape (skim-off-next-payout, timestamp-derived, never
negative), not invent a wallet-debit tax or a background job.

**Money-movement primitives to reuse:** `creditGoldByProfileLedgered`/`spendGoldByProfileLedgered`
in `lib/server/profile-store.ts` — an append-only `gold_ledger` table, idempotent on
`correlationId`, safe against retries/crashes. This is the version-guarded settlement pattern
CLAUDE.md's money-ordering rules require for every staked/economic system in this repo. Any
payroll/bankruptcy debit-credit path goes through this, not a bare `creditGoldByProfile`.

**Correction to earlier assumption:** `STACKACRES_GOLD_CEILING` (a flat 15,000 Gold/day cap) was
cited in older memory as the valve that would stop a StackChips-to-farm Gold injection from
printing money. It was removed entirely on 2026-09-12 — `lib/stackacres/exchange.ts` now states
StackAcres has no cap on earning, and the migration
`20260912211500_stackacres_drop_gold_exchange.sql` dropped the reserve/release RPCs and the
`homestead_exchanges` table outright. **There is currently no ceiling on Gold earned anywhere in
StackAcres.** If the empire layer's rescue loop (bounce to StackChips, earn Gold, inject it back)
needs a limiter, that limiter does not exist yet and is an open decision (see below), not something
already enforced elsewhere.

**Not yet built, confirmed by a 2026-09-24 codebase pass:** no bankruptcy/liquidity-crisis state
machine, no NPC payroll registry, no recurring debit beyond the existing land-upkeep skim.

**Worth checking before design locks in (not yet done):** whether `lib/stackacres/journal.ts` and
`lib/stackacres/building-cues.ts`'s existing cue-ladder pattern (which already derives "what needs
your attention" — hungry animals, ready crops, waiting travelers — from a snapshot, no server
round trip) can directly drive the bankruptcy-state UI (idle workers, degraded buildings) instead
of a second status-derivation system.

## 7. Build order (confirmed 2026-09-24)

Kayo confirmed sequencing: build toward the section 4 visual reference (terraced farm/processing
complex — Gold/Wood/Wheat/Workers HUD, stone-tier construction, greenhouse/silo/processing
building) **first**, as the second map's actual v1 buildable content. The section 3 Chef-RPG-scale
town (many districts, many NPCs, many shops with hours) is later work, not part of this first pass.
This resolves item 6 below to a concrete v1: a single-district terraced farm/production complex the
player clears and builds up from empty, reached by crossing the bridge, with the persistent
resource HUD — no multi-district town, no NPC homes-with-hours yet.

**Build status (2026-09-24): the world scaffold for this v1 slice is built**, uncommitted, in
worktree `.claude/worktrees/agent-a74758a575a0aa595` (branch `worktree-agent-a74758a575a0aa595`) —
not yet reviewed or merged. What exists there: a bridge exit from the Homestead into a new
`"empire"` district (gated behind its own `EMPIRE_ENABLED` flag, separate from and not touching
`HOMESTEAD_ONLY`'s existing six districts), using the Homestead's existing scene-transition system
rather than a new one, plus the top-left Gold/Wood/Wheat/Workers HUD wired to real (currently
stub/zero) server state via a new `empire` field on `StackAcresView`. `tsc`/`lint`/`build` clean;
`pnpm test` 4996/4997 (the one failure is a pre-existing unrelated regression on `main`). No
migration — crossing the bridge is free, so there's no per-profile state to persist yet.

**Correction (2026-09-24, after seeing it screenshotted): the field was built as a flat, prop-free
40x30 grass rectangle — that's wrong.** Kayo, after seeing that screenshot, sent a Stardew Valley
starting-farm reference and said "the map needs these foundations." "Empty" was never meant to mean
a blank void; it means **uncleared**: scattered trees, stumps, rocks and weeds the player chops/
mines/clears to make room, the same way a fresh Stardew farm looks and the same way the Homestead's
own wilderness areas already work in this codebase (see `feedback_stackacres_no_roads_clean_lawn`
and `project_stackacres_wild_debris_and_see_through` in memory — reuse that existing
prop/clearing system, don't invent a new one). The flat field needs to be rebuilt with real
clearable wilderness content before this is actually done. Growth direction stays the terraced
end-state from section 4; the starting foundation is what this correction fixes.

**Correction fixed, same day.** The field is now populated: 20 props (trees, spruces, boulders,
bushes, weighted toward trees like the Homestead's own treelines) scattered naturally across the
field, seeded (`random.seed(20260924)`) so it's reproducible, clear of the perimeter wall, the
doorway, and a buffer around the spawn point. Built via a new `scripts/gen-empire-wilderness-props.py`
that calls the Homestead's own art-generator functions directly (`kit.round_tree`, `kit.spruce`,
`kit.bush`, `props.rockfall` from `art/stackacres-td/areas/rig/kit.py`/`props.py`) — same code, same
palette, not invented art — and packs them into a real per-area atlas via `export_rich.py`'s
pipeline (found to be the actual active exporter; the older `areas/rig/export.py` is superseded).
`empire/area.json` kept its existing `name`/`width`/`height`/`tile`/`spawn`/`npcs`/`blocked`/
`zones`/`exits`/`indoor`/`lights`/`emitters`/`ambient` byte-for-byte identical — only `props` (plus
the new `props.png`/`props.json` atlas) changed, so the bridge/doorway/spawn work from the first
pass is untouched. None of the new props carry a clearing `tag` yet — they render and block
movement like uncleared land, but aren't wired to any interaction, which matches this pass's scope.
`empire-area.test.ts` now asserts real props exist, every frame resolves in the atlas, and neither
the spawn point nor the doorway is blocked by a prop. `pnpm test` 4999/5000 (same pre-existing
unrelated failure as before), lint clean, build clean, empire-district tests 7/7.

Deliberately still not built: the actual clearing interaction/mechanic (chop/mine this map's
props), real Wood/Wheat/Workers numbers, payroll, NPCs, the store, or anything from section 3's
town scale. **Next slice:** the clearing interaction itself (turning these props into something a
player can actually chop/mine, reusing the Homestead's chop-node/land-obstacle pattern rather than
`export_rich.py`'s decorative-only props), then wiring real resource state once the economy
questions in section 8 have answers.

**Verified working 2026-09-24 via screenshot** (isolated memory-mode dev server, no real writes):
the bridge transition reaches a new area titled "The Far Field," and the HUD renders correctly
(Gold/Wood/Wheat/Workers) once entered through the real `travelTo` transition. **Bug found while
testing, not yet fixed:** the scene's dev/test teleport helper `placeFarmer` (around line 3512 of
`components/arcade/stackacres-td/scene.ts`) does not fire `onPlaceEntered`, so it silently skips
setting the React-side flag the empire HUD depends on (`onEmpireMap` in
`components/arcade/stackacres/stackacres-farm.tsx`, around line 2789). Any test/screenshot tooling
that teleports via `placeFarmer` will show a wrong HUD state with no error — use `travelTo` instead,
or fix `placeFarmer` to also invoke the callback.

## 8. OPEN — needs Kayo's answer before any of this is built

1. **Scope authorization.** `feedback_stackacres_homestead_only_focus` currently says every map
   besides the Homestead is off the table for new work. Kayo has been actively designing this
   second map in conversation, which reads as an implicit yes, but that rule has never been
   explicitly lifted for this scope. Confirm before starting build work, not just design docs.
2. **Four-pillar relationship.** Personal / Relationships / Business / Fishing — one unified stat
   sheet, or four independent tracks? Not decided.
3. **Second hireable NPC job.** The produce clerk is named; the second NPC role is not.
4. **Rename.** Kayo floated that "Homestead"/"StackAcres" both imply just a farm plot, and this
   concept is closer to a settlement/town-building game with farming as one activity among several.
   No name chosen.
5. **NPC payroll shape.** Does hiring an NPC create a recurring salary line item distinct from the
   land-maintenance skim (i.e., stacks with it), or is payroll folded into the same single upkeep
   number per profile? Not decided — affects whether this needs one ledger line or several.
6. **Town scale, actually pinned down.** Section 3 confirms "many districts, many NPCs, many shops"
   as a direction but not a count. How many districts at launch? How many NPCs? Is every shop in
   the reference's spirit (grocery, apparel, bar, bathhouse, library, barber, infirmary, fishing
   supplies, specialized crafting facilities) actually wanted, or is that upper-bound inspiration
   for a much smaller v1? Building the full reference scale is a large-months project, not a single
   feature — needs an explicit v1 cut.
7. **Shop operating hours.** New mechanic, not decided how deep: does StackAcres already have a
   day/night or time-of-day clock this could hook into, or does one need to be built? (Not yet
   checked in a research pass — don't assume either answer.)
8. **Bankruptcy trigger and recovery mechanics**, in concrete terms: what exactly halts (does
   *all* NPC labor stop, or just the specific job whose wage is unpaid), what the manual-recovery
   path looks like in-game, and whether there's a floor (can a player's empire actually be
   liquidated / lose owned assets, or does it only ever stall).
9. **StackChips-to-farm Gold injection.** Confirmed there's no cap stopping it currently. Whether
   the empire layer wants its own limiter (so the "rescue loop" stays a deliberate, occasional
   thing rather than a routine bypass of the whole upkeep mechanic) is undecided.
10. **Relationship to Phase 6.** `project_stackacres_progression_architecture`'s Phase 6 (Homestead
    economy-number rebalance) is explicitly gated behind a playtest, "do not start without asking."
    Does a second-map economy launching first conflict with that gate, or are they independent
    enough to proceed in parallel? Not decided.

## 9. How to use this doc

Nothing here is a green light to write game code. It's a single place holding what's actually been
decided versus what's still open, so the next design pass doesn't have to re-derive it from
scattered conversation. When Kayo resolves an OPEN item, update this doc in place rather than
letting the answer live only in chat.
