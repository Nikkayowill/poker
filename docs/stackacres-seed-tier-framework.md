# StackAcres Seed Tier & Sector Progression Framework

Design doc responding to a Copilot-drafted `/goal` brief asking for a 4x4 tiered seed
system to fix crop-unlock choice paralysis. Museum integration is dropped per Kayo's
instruction. This revision matches the as-shipped code exactly (`lib/stackacres/catalogue.ts`,
`items.ts`, `grid-synergy.ts`, `lib/server/stackacres-service.ts`) — an earlier draft of
this doc described a "Moonvine" crop and a sell-price synergy kind that were cut during
implementation; both are gone from this revision too, for the reasons in Section 3.

## 0. Corrections to the brief's assumptions

- **16 crops already existed** (`STACKACRES_CROPS`). This wasn't "get to 16," it was
  "tier the 16 we have." A stale memory claiming 44 crops was checked against the
  code and found wrong — the pack that gave that number was ripped out and replaced,
  not extended, on 2026-09-12.
- **The real bug**: all 16 sat behind one gate, `cropFieldsUnlockCheck` (15,000 Gold +
  2 units). Clear it once and every crop was buyable — no per-tier gate existed. That
  flag, not a shortage of crops, was the choice-paralysis bug.
- **Town Contracts are single-item quotas**, not multi-crop recipes — kept that shape.
- **Town Influence had never been spent** before this pass. Tier 4's gate is the first
  thing that actually requires it, but as one of five required milestones, not as
  sole currency for a sector (see Section 5 for why sectors keep their existing
  Gold-based gate).
- **Only 2 sectors were claimable**; 4 are explicitly "wild, never unlockable by any
  route" in the code's own comments. Ancient Grove is therefore NOT a fifth physical
  sector — it's gated by a farm-wide milestone count instead (Section 2).
- **No currency-exchange mechanism exists or should exist** — casino Gold and farm
  Gold are the same `profiles.gold_balance` column; a segregated "invested" pool was
  built once and deliberately removed.

## 1. The 4x4 Seed Tier Table (as shipped)

All 16 are real, already-illustrated crops — no new art was commissioned for this pass.

| Seed | Tier | Sector Gate | Grow Time | Seed Cost | Gross Payout (sell × qty) | Mechanical Behavior |
|---|---|---|---|---|---|---|
| Lettuce | 1 — Homestead | none (Crop Fields only) | 15s | 1g | 2g × 1 | Fast clicker |
| Spinach | 1 — Homestead | none | 15s | 1g | 2g × 1 | Fast clicker |
| Radish | 1 — Homestead | none | 15s | 1g | 2g × 1 | Fast clicker |
| Carrot | 1 — Homestead | none | 15s | 1g | 2g × 1 | Fast clicker |
| Onion | 2 — River Plot | Clear the Fold | 25m | 25g | 14g × 4 | Multi-harvest, ownable outright |
| Potato | 2 — River Plot | Clear the Fold | 25m | 25g | 14g × 4 | Multi-harvest, ownable outright |
| Cabbage | 2 — River Plot | Clear the Fold | 25m | 25g | 14g × 4 | Multi-harvest, ownable outright |
| Green Bean | 2 — River Plot | Clear the Fold | 25m | 25g | 14g × 4 | Multi-harvest, ownable outright |
| Broccoli | 3 — Highland Ridge | Clear Ox Fields | 90m | 55g | 25g × 4 | Long-cycle sink, ownable outright |
| Pepper | 3 — Highland Ridge | Clear Ox Fields | 90m | 55g | 25g × 4 | Long-cycle sink, ownable outright |
| Bell Pepper | 3 — Highland Ridge | Clear Ox Fields | 90m | 55g | 25g × 4 | Long-cycle sink, ownable outright |
| Celery | 3 — Highland Ridge | Clear Ox Fields | 90m | 55g | 25g × 4 | Long-cycle sink, ownable outright |
| Tomato | 4 — Ancient Grove | All 5 farm milestones | 4h | 120g | 44g × 5 | **Synergy source: +8% growth speed to orthogonal neighbors** |
| Corn | 4 — Ancient Grove | All 5 farm milestones | 4h | 120g | 44g × 5 | **Synergy source: +8% growth speed to orthogonal neighbors** |
| Eggplant | 4 — Ancient Grove | All 5 farm milestones | 4h | 120g | 44g × 5 | **Synergy source: +8% yield quantity to orthogonal neighbors** |
| Wheat | 4 — Ancient Grove | All 5 farm milestones | 4h | 120g | 44g × 5 | **Synergy source: +8% yield quantity to orthogonal neighbors** |

Livestock (Hen/Sheep/Cattle) are intentionally excluded — they're a separate pen
system in their own sectors already, with their own pacing.

## 2. State Flow Logic

```
New farm:
  Unlock Crop Fields (15,000g + 2 units, unchanged from before this pass).
  -> Tier 1 (Lettuce, Spinach, Radish, Carrot) is immediately buyable. No
     further gate. This is the fix: the choice paralysis bug was that this
     single unlock used to open all 16 at once. Now it opens 4.

Clear the Fold (45,000g + 4 units owned, unchanged existing sector):
  -> Tier 2 (Onion, Potato, Cabbage, Green Bean) becomes buyable.

Clear Ox Fields (100,000g + 6 units + the Fold cleared, unchanged existing sector):
  -> Tier 3 (Broccoli, Pepper, Bell Pepper, Celery) becomes buyable.

Earn every farm milestone (5 of 5 -- crop_fields_unlocked, cleared_wallow,
cleared_oxfields, town_trusted [Town Influence > 0, i.e. fulfill one Town
Contract], greenhouse_raised):
  -> Tier 4 (Tomato, Corn, Eggplant, Wheat) becomes buyable, with their
     grid-synergy behavior active.

GRANDFATHER CLAUSE: a farm that already paid the OLD standalone Crop Fields
unlock before this ladder shipped keeps every tier open immediately -- it
already bought "every crop, unlocked," and this pass does not retroactively
take that away. Only a farm that has not yet paid it (every new farm, from
the moment this ships) goes through the real ladder above.

ENFORCEMENT: every crop purchase or sowing path (buy seed bags, sow directly,
buy outright, plant into the Crossbreeding Bed) runs the same gate check
before Gold moves -- reusing the shop's existing lock system
(requiredQuestFlag / minimumMilestone), not a parallel one. A hand-rolled
request against a locked tier is refused the identical way a locked tool
tier already is.
```

## 3. Grid Synergy Mechanic — as implemented

No per-tile neighbor system existed before this pass (Synergy Tree is a
player-wide perk, not positional). This is genuinely new, but built on the
soil-bed lattice that already existed (`lib/stackacres/soil.ts`), not a new
grid.

**Why there's no sell-price synergy kind**, despite the brief asking for one:
a harvest credits a shared, fungible inventory pool, never a value tied back
to the tile it grew on (`items.ts`'s own header: "a harvest no longer pays
Gold at all... Sell prices it fresh on demand"). By the time anything is
sold, it has no origin tile left to read a neighbor off of. A "sell price"
buff would really mean "whatever happens to be planted on the farm right
now when you hit Sell" — not a grid mechanic at all. Growth speed and yield
quantity, both snapshotted onto a unit at planting time, are the two kinds
that actually fit the architecture.

```
TIER4_SYNERGY = {
  corn:       { kind: "growthSpeed", bonusPct: 8 },
  tomato:     { kind: "growthSpeed", bonusPct: 8 },
  eggplant:   { kind: "yieldQty",    bonusPct: 8 },
  wheatsheaf: { kind: "yieldQty",    bonusPct: 8 },
}

function orthogonalNeighbours(tx, ty):
  return [(tx+1,ty), (tx-1,ty), (tx,ty+1), (tx,ty-1)]  # no diagonals

function synergyBonusPct(kind, soil, tile, stockBySlot):
  total = 0
  for neighbour in orthogonalNeighbours(tile.tx, tile.ty):
    slot = soilSlotForTile(soil, neighbour.tx, neighbour.ty)
    if slot is null: continue
    stock = stockBySlot[slot]
    buff = TIER4_SYNERGY[stock]
    if buff and buff.kind == kind:
      total += buff.bonusPct
  return total   # additive, naturally capped at 4 (one per side)

# Applied once, at planting, alongside the existing soil-tier multiplier:
growthMultiplier = soilTierMultiplier(bed) * (1 / (1 + synergyBonusPct("growthSpeed", ...) / 100))
yieldQuantity   = baseYield + floor(baseYield * synergyBonusPct("yieldQty", ...) / 100)
```

A tile does not buff itself, and diagonal neighbors don't count — a player
should be able to eyeball a buff off the grid ("this Corn touches two other
Grove crops, so +16% growth") rather than trust a hidden formula.

## 4. UI/UX: "Casino Wallet to Farm Investment"

There is no currency to convert — poker Gold and farm Gold are the same
`profiles.gold_balance` column, and building a second one would reintroduce
exactly the complexity a prior pass removed. So the UI's job is framing a
single shared balance, not new plumbing:

- **A "bring your winnings to the farm" moment**: when a player's Gold jumps
  by a large delta between sessions (a poker win), a one-time banner on next
  StackAcres load deep-links to whichever tier gate they're closest to
  affording (the Fold / Ox Fields clear cost) — pointing a big winner at the
  next sector, not at a seed shop with no more locked rows to discover.
- **Locked tiers render as silhouettes in the seed shop**, using the same
  greyed-row-plus-hint component the shop already renders for locked tool
  tiers, with the seed's own lock label ("Clear the Fold to unlock") instead
  of a price.
- **No segregated wallet UI.** One Gold number, shown identically at the
  poker table and on the farm.

## 5. Multi-good Town Contracts — implemented, raw crop included

`ContractDef.extraRequirements` lets a rung ask for a second good alongside
its primary one. Two real rungs do this now:

- **3 Cheese + 2 Cloth** (two processed goods) — priced the same way every
  other rung is, 1.3x combined `recipeRawGoldValue` across every good it
  asks for rather than just the primary; `recipes.test.ts`'s pricing suite
  was generalized to check that, not loosened.
- **3 Flour + 20 Spinach** — a genuine raw crop as the extra, the same shape
  the brief's own "500 Wheat + 50 Spinach" example asked for.
  `ContractRequirement.item` widened from "must be a processed good" to the
  full `MachineItemId` space for exactly this, since the shared inventory
  already treats a harvested crop and a milled good identically (see
  ./items.ts's own header). The PRIMARY requirement stays a processed good
  on purpose: that is what keeps a contract from ever being postable to a
  farm with no machine at all, the load-bearing design rule this whole
  system exists to protect (see contracts.ts's own header). A raw-crop
  EXTRA carries no such gate — any farm can grow more of a crop it has
  already unlocked, so `drawContract` never blocks on it the way it still
  blocks on an unmakeable processed extra.

Fulfilling either debits every required good before settling, rolling back
whatever already left if a later good in the list comes up short — the same
rule-1 shape a single-good contract already followed. The UI, which already
rendered `requirements` as a list, needed one line changed to stop
hard-coding that list to length 1. The autonomous farmhand still only plans
toward a contract's primary good, a known, documented gap rather than a
silent one.

**A third rung closes the loop all the way**, rather than just asking for
independent quantities of two goods: `lib/stackacres/recipes.ts` gained a
new recipe, Spinach Loaf, that genuinely combines two GROWN crops — 2 Wheat
(wheatsheaf) and 10 Spinach — at the Mill, the same "one or more inputs, one
output" shape the existing Cake recipe (Eggs + Milk + Flour) already proved
out via `process_homestead_recipe_multi`. A new rung asks for 3 Spinach
Loaves. Growing both crops and milling them together is now a real
prerequisite for that rung, not two numbers checked independently. This
needed one migration (`20260914060000`) to widen
`homestead_processing_inventory`'s item check constraint for the new good —
and, found while doing that, to fix a stale version of the same constraint
that had never been updated for the 2026-09-12 crop-roster swap (8 of the
current 16 crop ids weren't in it at all; see that migration's own header).
A second stale constraint turned up the same way on `homestead_contracts`
itself (`20260914070000`): its own item check was last written the day
Flour/Cheese/Cloth existed and never widened for Cake or now Spinach Loaf —
both already legal in code, both would have failed against real Postgres
with a check_violation. Neither surfaced in this session's own tests, which
run against the in-memory store and enforce no such constraint.

**A third, confirmed hard blocker, not a preference**: a contract whose
requirements are ALL raw crops, with no processed good anywhere in it
("500 Wheat + 50 Spinach" and nothing else) was investigated properly this
round rather than dismissed. It fails for a concrete, testable reason: an
existing test, `drawContract`'s "refuses rather than drawing when the farm
can make nothing," asserts `drawContract([], () => 0)` is null — a farm
with zero machines gets zero contracts, full stop. A pure-crop rung needs no
machine at all, so it would always be eligible regardless of `producible`,
breaking that assertion outright. This isn't incidental: this file's own
opening line calls a contract "a door FROM A PROCESSED GOOD," and its second
paragraph states the whole point is to "keep a machine fed, cash in what it
makes" — a contract completable by someone who has never built a single
machine contradicts the reason this system exists, not just one test's
wording. What already ships instead, both real: a raw crop as one of
several requirements alongside a processed primary (3 Flour + 20 Spinach),
and a processed good whose own recipe demands two raw crops be grown and
milled together first (Spinach Loaf, above) — either genuinely satisfies
"grow more than one crop for this," without deleting the reason Town
Contracts exist.

## 6. What this pass will not do, and why — two are hard blocks, not opinions

1. **Passive Gold generation from prestige** ("stable offline gold generation
   to fund future table buy-ins"). `lib/server/stackacres-service.ts` has a
   literal test, `describe("the currency wall")`, asserting
   `creditGoldByProfile` is called from exactly 4 places in the whole file —
   a refund helper plus the three payers (Sell, Town Contracts, the Vat).
   The file's own header: "adding a path that spends Gold is safe, adding
   one that pays it is the thing to stop over." A prestige trickle would be
   a 5th. This is not a style preference to route around — it is a failing
   test, and moving that wall is Kayo's call, not mine.
2. **Rakeback from prestige.** This app has no rake at all — staked games
   are skill PvP by explicit design, never a house cut to give back a share
   of. The brief's own suggested mechanic contradicts a real house rule.
   A pure cosmetic form of "passive casino utility" (a table flair/badge
   tied to prestige level) would sidestep both blockers above, since it
   moves no Gold — but wiring it into the poker table's own rendering is a
   separate system this pass hasn't investigated, and guessing at that
   under time pressure risks the same kind of mistake Section 5 just
   corrected. Left as a clearly separable follow-up, not attempted.
3. **Town Influence as the ONLY sector-unlock currency, replacing Gold.**
   Existing sectors (the Fold, Ox Fields) have a tested, documented Gold
   price sized against the old plot grid ("land should still cost about
   what land cost"). Ripping Gold out of that ladder is a full economy
   rewrite of a live, working system, not a rebalance, and needs Kayo's
   sign-off on new numbers rather than an invented replacement.

   **What shipped instead, additively**: `SectorDef` gained a third
   requirement, `requiresInfluence`, checked by `sectorClearCheck` alongside
   (never instead of) the existing Gold cost and unit count. The Fold now
   needs 25 Town Influence and Ox Fields needs 75, on top of their unchanged
   Gold prices. This is the literal thing the brief actually asked for --
   "players cannot brute-force buy sectors with casino gold; they must
   engage with the farm loop" is true now: arriving with a poker fortune and
   zero fulfilled Town Contracts still gets refused, at every sector, not
   just Tier 4's crops. It does not make Influence the ONLY currency
   (Gold's price is untouched), because that specific literal wording would
   have meant deleting a priced, tested ladder with no reviewed replacement
   -- but the actual problem the requirement names is solved.
4. **A physical fourth claimable sector for Ancient Grove**, promoting one
   of the four districts the code explicitly marks "wild, never unlockable
   by any route." Reversing that marking is a real map/architecture
   decision. What shipped instead: Tier 4 gates on a farm-wide milestone
   count, which needs no new sector and no art.
5. **Museum integration** — dropped per Kayo's explicit instruction mid-task.

Everything else in this doc is implemented and tested (full suite green
except one pre-existing, unrelated regression already in the project's own
memory), sitting on `design/stackacres-seed-tier-framework`, uncommitted,
off `main`.
