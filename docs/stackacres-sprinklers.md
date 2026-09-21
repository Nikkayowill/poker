# StackAcres sprinklers: design

Status: proposal, 2026-09-21. Nothing here is built. Prices are placeholders; the economy pass
(progression architecture, phase 6) sets the real ones. Kayo's call on the open questions at the
bottom.

Kayo's direction: the enriched and hydro soil bags go away (done, see below) and the irrigation
pipe network is replaced by sprinklers.

## What already exists that this reuses

The pipe system left one seam worth keeping. Every place that asks "is this crop dry?" is handed a
set of unit ids that a water source reaches (`irrigationGridFor` -> `irrigatedUnitIdsFor` in
`lib/server/stackacres-service.ts`, then `isStackAcresUnitDry(row, now, irrigated)` in
`lib/stackacres/units.ts`). A crop in that set never goes dry, and `stampIrrigatedCrops` stamps
`lastWateredAt` so pulling the source starts the drought from that moment instead of retroactively.
Seed sown onto a covered bed starts its growing clock at once (`waterIrrigatedCrops`).

A sprinkler is a second, simpler source for that same set. Nothing downstream changes: dryness,
readiness, the watered-soil tint (`bedIsWet`), the optimistic layer, offline catch-up.

Coverage is lattice arithmetic on the 16-unit soil tile (`SOIL_TILE`), not a graph search. That
makes it cheap on the server and exactly predictable on the client, which is what the optimistic
rule needs.

## The player's problem

Hand watering is free and instant (the can, group watering) and stays that way. What it cannot do
is water while the player is away. Tier-1 crops and wheat go dry after 8 minutes, tier 2 after 40,
tier 3 after 90, and a dry crop stops growing and eventually mucks. So the sprinkler's job is not
"saves taps". It is **a crop that is still growing when you come back**. That ties directly to the
return-loop phase, and it is the reason to buy one.

## Gameplay

- A sprinkler is a placed object on one soil-lattice tile, on legal bed ground (the two Homestead
  paddocks and the Crop Fields). It occupies the tile, so it costs a plot. It cannot share a tile
  with a bed.
- It keeps every planted bed in its pattern watered, continuously. No water source, no well, no
  refill. (A pipe needed a well and a reach of 8; that whole layer goes.)
- Picking one up returns it to the shelf, free. Layout is the fun part and should not be punished.
- Placing shows the covered tiles before you commit (tint the squares it will reach). Without that
  the pattern is invisible, and the audience is young (see legibility feedback).
- A covered bed is always wet, so it reads dark under the existing `WET_SOIL_TINT`. A small spray
  animation on the sprinkler itself says "this one is working".

## Tiers (placeholder numbers)

| Tier | Pattern | Waters | Craft (materials only) | Buy (Gold only) |
|---|---|---|---|---|
| Wooden | plus (4 edge neighbours) | 4 beds | 10 Wood | 250 Gold |
| Stone | 3x3 ring | 8 beds | 15 Stone + 5 Wood | 1,500 Gold |
| Iron (later) | 5x5 | 24 beds | needs a new material | not designed yet |

Kayo confirmed plus then 3x3 (2026-09-21, "sure?" so tentative); a third tier waits.

Wooden and Stone reuse materials that already exist (Wood from chopping, Stone from the Mine at
Standing 3), so they need no new gathering. This fits the progression rule that every major
investment expands reach, production or a strategic option: a sprinkler expands how much land can
run unattended.

## Where you get one: make it or buy it, no shopkeeper

Not Ray's shelf. That is the old narrative (everything comes from Ray), and Kayo has ruled it out
for this. There are two routes, and both end in the same place: a sprinkler item in the player's
own stock.

- **Craft.** A crafting machine turns gathered materials into a sprinkler, using the existing
  machine and recipe system (`lib/stackacres/machines.ts`, `recipes.ts`). The player builds it
  first, the way they build the Mill (Gold plus Wood or Stone to place it), and after that the
  sprinkler itself costs materials only. A farm-only player who never touches StackChips can get
  every sprinkler this way. This is the route that makes chopping and mining matter.
- **Buy.** Gold, no materials, priced above what the same materials are worth, so Gold buys the
  time saved and never undercuts crafting. This is the sink for a player carrying arcade winnings,
  and it must not be the only way (StackAcres has to be playable without StackChips Gold).

Where the buy happens is the one thing this design does not know yet. It should be an in-world
place that is not a named shopkeeper's counter. The existing candidates are the Town market
(`lib/stackacres/market.ts`, where stock is bought outright) and Town Contracts. Kayo picks.

The crafting machine is new either way. Whether it is its own "Workbench" or a recipe on an
existing machine is a build-time call; the doc assumes a Workbench so sprinklers do not crowd the
food machines.

The layout puzzle is real. A plus sprinkler tiles the plane perfectly (one in five tiles is a
sprinkler, 20% of the land), a 3x3 costs 1 in 9 (11%). Better tiers give more land back, not just
more reach.

## Economy (direction doc section 24)

- **Gold in:** none directly. Indirectly, unattended crops that survive the player's absence.
- **Gold out:** the bought route is a one-time Gold price per sprinkler. The crafted route costs
  materials (plus the one-time Gold to build the crafting machine). Nothing per watering, nothing
  per tick, no upkeep. This is infrastructure, the "irrigation costs Gold" case the direction doc
  names. Manual watering stays free.
- **Not a passive-income machine:** it removes a failure mode (crops going dry), it does not
  produce anything. Yield per bed is unchanged.
- **Sink size:** bounded by land. Covering the two paddocks (88 plots) with plus sprinklers is
  about 18 sprinklers: 180 Wood crafted, or roughly 4,500 Gold bought. Crafted, that is a real
  early gathering goal without being a wall, and it competes with the Mill (200 Gold + 15 Wood)
  for the same Wood.

## Data model

- `homestead_sprinklers (profile_id, tx, ty, tier, placed_at)`, unique on `(profile_id, tx, ty)`,
  same lattice key space as `homestead_soil_tiles`. Insert-and-delete only, so a tier CHECK is
  safe (contrast `homestead_units`).
- `homestead_sprinkler_stock (profile_id, tier, quantity)`, copied from the soil stock table. Both
  routes (craft, buy) credit it, and placing spends from it, so acquiring and placing stay
  independent. It is its own table, not `homestead_processing_inventory`: that one is typed to
  `MachineItemId` and everything in it is sellable, and a sprinkler must not be.
- A tile cannot hold a bed and a sprinkler. That crosses two tables, so the check lives inside the
  place RPC in one transaction, not in the service, or two writers can race the same tile.
- EXECUTE on the new RPCs is service-role only, revoked from `public` too.

## Server and client

- Pure module `lib/stackacres/sprinklers.ts`: tier defs, `coverageOf(tile, tier)`, and
  `sprinklerWateredTiles(placed)`. `irrigationGridFor` unions the covered beds' crops into
  `irrigatedUnitIds`.
- Actions `buy-sprinkler`, `place-sprinkler`, `pickup-sprinkler`, plus a craft recipe on the
  crafting machine. Price and recipe are read from the tier table on the server, never from the
  body, with a per-request quantity cap like `SOIL_BAGS_PER_PURCHASE`.
- Crafting spends materials through `adjust_homestead_processing_inventory`, which since phase 0
  raises on a short or missing row, so a craft cannot mint a sprinkler from nothing.
- Picking up (and lifting a bed a sprinkler was covering) stamps `lastWateredAt` first, the same
  before-shot the pipe removal takes.
- Optimistic: the client already holds the placed sprinklers and the beds, so coverage and the
  resulting wet state are computed locally the moment you place one. Retry, do not roll back, like
  the other farm actions.
- Art is new: a sprinkler sprite per tier plus a spray loop. The repo's art exporter cannot run
  (needs character sheets that are not checked in), so these are generated with PixelLab and
  patched into `public/stackacres-td/` by hand, mirrored in the rig source.

## Build order

1. Pure module and tests (coverage, perfect-tiling property, tile-conflict rules).
2. Migration and store, with the RPC tile-conflict check.
3. Service actions, swap the source inside `irrigationGridFor`, optimistic layer.
4. Scene: sprite, spray, placement preview. The crafting machine and the buy surface.
5. **Pipe teardown**, same PR as step 3 since it is the same seam: delete `irrigation.ts`,
   `stackacres-pipe-store.ts`, `art-irrigation`, the pipe path in `soil.ts`/`zones.ts`, the pipe
   dialogue in `story/dialogue.ts`, and the dead `recomputeIrrigation`. The drop migration for
   `homestead_pipes` and `sync_homestead_pipe_network` goes AFTER the deploy (a live read would
   throw if it ran first). The table is empty in production.

## Open questions for Kayo

Answered: 1 (plus then 3x3, third tier later), 2 (make or buy, not Ray).

2b. **Where does the buy happen?** Town market, Town Contracts, or somewhere new? And is a
    crafting Workbench right, or should it be a recipe on a machine that already exists?
3. **Free pickup:** confirm sprinklers go back to the player's stock at no cost (assumed).
4. **Water source:** none needed (assumed). The alternative is a well or a water tank, which
   brings back the reach and refill machinery being removed.
5. **Always-on vs limited:** assumed always on. A per-day water budget would add a decision but
   cuts against "never nickel-and-dime".
6. **Where:** paddocks and Crop Fields only (assumed), or also the greenhouse?
