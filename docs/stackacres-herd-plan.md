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
3. **Layout risk.** At collect time, from layout plus a seed of unit id and a night index taken
   from the server clock, never the client's, so a reload cannot reroll. Chrono-DeLorean offsets
   already shift that clock, so tests can replay a night. Covers wandering off, predators at night,
   crop trampling and crowding. The animal comes back next day. Never debits Gold. Hens in Hen
   Haven count as protected. The away report gets the "wandered off last night. Make sure to
   enclose your livestock." line.
4. **Guard dog.** An item that protects animals near it. First thing to drop if time runs short.
5. **Land by the acre.** Rectangular acres, escalating Gold plus Wood and Stone, one flat daily
   per-acre upkeep netted off payouts the way upkeep works today. Existing farms keep any ground
   they already use.

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
