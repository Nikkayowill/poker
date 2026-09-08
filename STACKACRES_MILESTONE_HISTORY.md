# StackAcres milestone history

Audited 2026-09-08 against the actual code in this checkout, not against prior `/goal`
briefs or the loose memory-index summaries — this repo has a track record of both
(fabricated schema citations, and phrasing like "wired the dead GameJuiceManager" that
turned out to still be unwired). Where a claim below contradicts an older note, the code
wins.

Goal for this track: close the remaining wiring gaps so the farm reads as a coherent,
complete loop before Kayo records gameplay and markets StackChips and StackAcres together.
Ordered cheapest/highest-leverage first, not by subsystem importance.

## What's actually done and wired

Confirmed reachable from real gameplay, not just present in the tree:

- Synergy Tree (perks/loadout, HUD widget, feeds crit/mill/farmhand)
- Ray's Museum, including the secret wing
- Town Contracts / processing UI (`TownContractsModal`) — despite an older memory note
  calling this UI "TBD", it is rendered and wired
- Soil tiers (placement, tier selection, `soilTierDef`)
- Idempotency keys for the four create-actions (stock/buy-stock/buy-feed/expand-capacity),
  via `homestead_action_keys` + `runStackAcresAction` — an older note calling this
  "unapplied" cited the wrong migration (poker's timed-action RPC, not StackAcres); the real
  one (`20260904140000_stackacres_action_keys.sql`) is applied and exercised by tests
- Drone hangar gating (intentional server-confirmed gate, not a bug)

## M1 — Prestige Reset Valve: wire the existing modal

**Cheapest win available.** Backend is fully live: `prestigeResetStackAcres`, the
`prestige-reset` action in `app/api/stackacres/actions/route.ts`, and `prestigeMultiplier`
already applies in harvest settlement. `components/arcade/stackacres/prestige-reset-modal.tsx`
exists, fully built, and is imported nowhere. Add one entry point (button/panel) in
`stackacres-farm.tsx` that opens it. No new server work, no new migration.

## M2 — Sunlight Forge: dispatcher + route + UI

`SunlightForgeTable.tsx` and `lib/stackacres/forge.ts` are both complete but only reference
each other — no action type, no dispatcher case in `stackacres-service.ts`, no route
handling, no reference anywhere in `stackacres-farm.tsx`. Needs: an action type + dispatcher
case (mirror the shape of an existing machine action), then wire the existing component into
the farm UI. No new engine logic required, just plumbing.

## M3 — Irrigation: render layer + client control

Server is fully built and tested (`place-pipe`/`remove-pipe`, `stackacres-pipe-store.ts`),
but there is currently zero client path to it: `art-irrigation.ts` (`bakeIrrigation`,
`registerPipeFlowPipeline`) is never imported by `stackacres-scene.ts`, and no component
anywhere calls `place-pipe`. This is two separate small builds, not one:
1. Scene: wire `bakeIrrigation`/`registerPipeFlowPipeline` into `stackacres-scene.ts` so
   placed pipes actually render.
2. UI: add a placement tool/button that calls the `place-pipe`/`remove-pipe` actions.

The old "irrigation-vs-render mismatch broke pipe reach" note from the soil-tier-shop PR is
moot until this exists — there's currently nothing to mismatch against.

## M4 — Crossbreeding Bed: wire the tested engine

Engine, store, and service are all built and unit-tested (`crossbreeding.ts`,
`crossbreed-items.ts`, `stackacres-crossbreeding-store.ts`,
`stackacres-crossbreeding-service.ts`), migration applied
(`20260905130000_stackacres_crossbreeding.sql`). Nothing calls the service — the service
file's own header says so. Needs: plant/harvest-crossbreed actions in the route + dispatcher
case in `stackacres-service.ts`, plus a farm UI/scene entry point (bed placement, planting,
harvest). Larger surface than M1-M3 but no new design decisions — the mechanic is already
fully specified.

## M5 — Wildlife/predator defense: live sync

`WildlifeManager` runs real combat client-side but never persists it — no throttled/Realtime
sync of the live wave into `stackacres-defense-store.ts` on tick, despite snapshot functions
already existing for exactly this. Backend-only follow-up; doesn't block a playable loop
(defense is visible and functions in a session, it just doesn't survive a refresh/reconnect
mid-wave). Lower priority than M1-M4 for the marketing push, but should land before wide
release since a player losing defense progress on reload is a real regression once anyone
notices.

## M6 — Visitor Quest pipeline (10-quest system)

Currently art + one-shot greeting only — `lib/stackacres/visitors.ts` says this outright in
its own header. `docs/stackacres-visitor-quest-design.md` is an honest design doc (explicitly
labels its new mechanics "PROPOSED, NOT BUILT"), not a false claim like some past briefs.
This is a from-scratch build: quest state machine, dialogue branching, gift/turn-in economy,
gating across the three acts. Biggest single item in this track — treat as its own
multi-migration milestone (state per visitor per profile, gift turn-ins, reward grants
following the same idempotent-settlement rule as everything else) rather than trying to land
it in one PR. Do last unless Kayo specifically wants the visitor cast in the recorded
gameplay.

## Minor/cosmetic, no milestone needed

- `game-juice-manager.ts` is still unwired dead code (contra the loose phrasing in an older
  memory note claiming it got wired) — either wire it or delete it, low stakes either way.
- Greenhouse's 6 interior slot outlines are placeholder-only, not yet tied to a housed unit's
  growth stage. Cosmetic.

## Launch-gate gap

Neither `docs/game-loop.md` nor `docs/launch-checklist.md` mentions StackAcres at all — there
are currently no formal launch gates for this subsystem the way there are for poker. Once
M1-M4 land (the coherent-loop bar), add a StackAcres section to `docs/launch-checklist.md`
before treating it as ready to feature in marketing alongside StackChips.
