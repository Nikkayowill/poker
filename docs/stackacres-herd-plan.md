# StackAcres herd: staged plan

Written 2026-09-29 for the Oct 5 launch. Nothing here is built yet. Decisions come from Kayo's
2026-09-29 answers: animals go where the player puts them, no fence is required, bad layout is
penalised, a wandered-off animal returns the next day, land is rectangular acres with one flat
per-acre daily upkeep, the guard dog is in, slaughter stays off-screen.

## Where things stand on main

- Sheep are the `pig` stock and cattle are `cattle`. Both are bought with Gold through `buy-stock`
  and refused unless their sector is open. The Fold (`wallow`) and Cattle Pasture (`oxfields`) can
  no longer be cleared, so nobody can buy either animal.
- That strands Wool, Milk, the Loom, the Dairy and everything downstream (Greenhouse, Golden Spade,
  Vat inputs).
- A unit has no position. Livestock is drawn from its stock's zone, and only Hen Haven still has a
  spots area on the Homestead map.
- The Far Field Barn already does what placement needs: buy, place, pick up, with a refund path.
  Use it as the pattern.
- The Vat payout was already softened (PR merged).

## Phases, each on its own branch off main

1. **Placed animals (built, not merged).** Two nullable columns, `map_tx` and `map_ty`, on
   `homestead_units`: the Homestead map square (16 units, the same squares fences use), with a
   check that both are null or both are set and a unique index so two animals cannot share a
   square. Only open yard grass counts, not the overgrown ring. There is no separate "to place" status: a null position means
   unplaced, which also covers every animal that exists today. The player taps ground to put an
   animal down and can pick it up again.
   - Existing sheep and cattle rows load with null positions. The client must show them as "to
     place", never hide them.
   - The server bounds-checks x and y and the placement rules, so a hand-rolled request cannot put
     an animal off the map or on a structure.
   - Pick-up never refunds Gold. The only refund is for a failed write after the purchase debit.
     (The Far Field Barn's refund path is that same case, not a pick-up refund.)
   - The sector gate is dropped for sheep and cattle. Existing Gold capacity prices and Wood costs
     stay. Hens keep their Hen Haven spots until the player moves them.
   - This alone un-strands the Wool and Milk chain. Once it lands, the Golden Spade gate, lowered to
     2 milestones on `fix/stackacres-golden-spade-gate` because only two are reachable today, can go
     back to 3.
2. **Contract board filter.** Contracts only ask for goods whose inputs the player can obtain, and
   flour gets a repeat limit. If the limit needs a stored counter, it goes on an existing contract
   table, not a new one. Small, and safe to ship right after phase 1.
3. **Layout risk (built on `feat/stackacres-herd-risk`, not merged).** Shipped as the pure rules in
   `lib/stackacres/herd-risk.ts`: an animal in the open is away 20% of nights, one in a crowded pen 10%, a
   fenced one never. The roll is its id plus the UTC day, so reloads and sleeping cannot reroll it. An away
   animal shows as working, is not drawn, and collect answers 409 until the next day. Crop trampling is not
   in this pass. Original plan: At collect time, from layout plus a seed of unit id and a night index taken
   from the server clock, never the client's, so a reload cannot reroll. Chrono-DeLorean offsets
   already shift that clock, so tests can replay a night. Covers wandering off, predators at night,
   crop trampling and crowding. The animal comes back next day. Never debits Gold. Hens in Hen
   Haven count as protected. The away report gets the "wandered off last night. Make sure to
   enclose your livestock." line.
4. **Guard dog (built on `feat/stackacres-guard-dog`, not merged).** `lib/stackacres/guard-dog.ts`:
   a dog costs 20,000 Gold, two to a farm, and stands on a Homestead square under the herd's own
   placement rules. A sheep or cow in the open within 3 squares of a dog is "guarded": it stays home
   like a fenced one. A crowded pen stays crowded; a dog cannot fix that. Bought from the herd bar
   (the Dog key, then a tap on open grass), moved for free by lifting it like an animal. Gold leaves
   before the row exists and comes back if the write is refused. Rows live in `homestead_guard_dogs`
   (migration `20261001195736`, which also folds the dogs into `stackacres_read_batch`). Drawn from
   `dog_left`/`dog_right` in the common atlas, the rig's `area_farm.dog`.
5. **Land by the acre (built on `feat/stackacres-acres`, not merged).** Rectangular acres, escalating
   Gold plus Wood and Stone, one flat daily per-acre upkeep netted off payouts the way upkeep works
   today. Existing farms keep any ground they already use.
   - The yard stays free. The wild ring is cut into 31 acres (`lib/stackacres/acres.ts`) and a bed or
     fence piece needs the acre it stands on. Chopping and mining out there stays free, so the Wood and
     Stone for the first deed can be gathered. One stray wild tile belongs to no acre and can't be built on.
   - Price is 300 Gold x 1.2 per acre already owned (to the nearest 50), 15 Wood + 3 per acre and
     8 Stone + 2 per acre. Upkeep is 40 Gold a day per bought acre.
   - The migration writes a grandfathered row for every acre that already holds a bed or fence. Those
     are not billed, because the Crop Fields were already billed as plots.
   - Capacity slots stay the animal cap. Animals still go in the yard only.
   - The hoe or fence on ground you don't own opens a buy bar. Nothing is drawn on the map.

## The direction doc's questions, for the herd as a whole

- Problem: half the economy is unreachable.
- Gold in: none. Gold out: animal prices, capacity slots, dog, acres, per-acre upkeep.
- Investment decision: where to put animals, whether to fence or buy a dog, how much land.
- Optimistic: placement and pick-up predict instantly, like fences. The server answer replaces the
  guess. Two placements before the first answer must not collide, so the server checks the layout
  fingerprint the way the barn does.
- Money order: debit the price before the animal exists, refund on a failed write. Settlement
  credits only after a version-guarded write.

## Open questions

Proposed answers are marked. None of them is Kayo's decision yet.

- Is `<name>` in the wander line a count ("2 of your sheep") or an individual name? Units have no
  name field today. Proposed: a count, since a name field is a schema change for no gain.
- Sheep and cattle pens are capped by capacity slots today. Keep that cap, or let acres replace it?
  Proposed: keep capacity slots as the cap for launch.
- Where do the first acres come from for an existing farm? Proposed: skip it for launch. Phase 5
  probably slips, and existing farms keep the ground they use.

## Oct 5 risk

Phases 1 and 2 are realistic. Phase 3 is tight. Phases 4 and 5 will probably slip past launch, so
launch with capacity slots as the animal limit and the dog as a follow-up.
