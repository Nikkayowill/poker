# StackAcres: progression architecture (draft for approval)

Status: APPROVED design direction (2026-09-20, decisions D1-D10 in section O). Implementation goes
one phase at a time, in the order in section M, and stops after each phase for review. Written from
the mechanics on `origin/main` (ab0bac63). The rules here sit under `docs/stackacres-direction.md`;
where they seem to pull against it, this document says so.

Goal, in Kayo's words: a classic farming, gathering, crafting and exploration progression game with
its own identity, where the player's choices between Gold, energy, time, land, materials, capacity
and attention create their own progression story. This document connects what already exists. It
adds a new mechanic only where a structural problem forces one, and each such case is marked
"NEW".

## How to read the evidence tags

* **[V]** I re-read the code or queried the live database myself in this session.
* **[C]** Confirmed by code or tests that a read-only pass cited by file and line. I did not
  re-read it.
* **[I]** Inferred: a strong conclusion from the implementation, not directly stated.
* **[U]** Unknown: needs a playtest or a production query.

Nothing here was playtested. Every timing or pace statement is [I] or [U].

---

## 0. Fix before any design work: Wood and Stone never credit

[V] The live database's `homestead_processing_inventory_item_check` constraint does not list
`wood` or `stone`. No migration ever adds them. The last migration to rewrite the list
(`20260919010000_stackacres_wheat_is_one_item.sql`) also omits them. The credit function inserts the
item, the constraint rejects it (error 23514), `adjustStackAcresInventory` turns that into `null`,
and `chopStackAcresWoodTree` and `mineStackAcresStoneNode` ignore the return value.

Live query results (2026-09-20): 0 inventory rows for wood or stone, 0 wood-node rows (nobody has
chopped a tree), 3 stone-node rows (seeded), 0 machines built by anyone.

Consequence: the Mill needs 15 Wood, so Chapter 1 cannot be completed in production, and
everything behind the Mill (flour, corn and green bean seeds, cattle feed, flour contracts) is
unreachable. Building the Loom, Feed Silo and Cellar is blocked the same way. The player still gets
a "you chopped N Wood" result because the client shows what the request asked for.

This also breaks the "no fallbacks" rule: a rejected credit is silently swallowed. It is Phase 0
of the implementation plan. It is a one-migration fix plus making the two callers refuse loudly.
The migration must be applied with the PR (see the `deploy-checklist` skill).

---

## A. Core game loop

Four loops nest inside each other.

```text
MINUTE LOOP (hands, seconds to minutes)
  plant -> water -> [wait 5 min to 4 h] -> harvest -> sell or process
                        |
                        +-- while waiting: chop, mine, fish, hunt, tend animals, talk

SESSION LOOP (one sitting)
  earn Gold -> choose an investment: PRODUCE (a building) or EXPAND (land / place)
            -> new capability -> new things to make -> earn more

RETURN LOOP (between sittings)
  capacity fills while away (kitchen, cellar, vat, silo, mill queue, animals, respawning nodes)
            -> come back -> collect -> reinvest

STACKCHIPS LOOP (across games)
  duels, wagers, puzzles -> Gold -> farm investments -> farm output -> Gold back to the wallet
```

The waiting is the design. Crops take 5 minutes to 4 hours, so there is dead time between
actions. Gathering exists to fill that time and to supply materials that Gold cannot buy. Rules
that follow:

1. Materials must stay un-purchasable, so gathering is never replaced by spending. [C] Ray's shop
   sells no Wood or Stone today.
2. The gathering a wait can fit should be short and self-contained (a tree, a fish, a stalk).
3. Anything that fills while the player is away must show how full it is.

## B. Progression philosophy

The player progresses toward capabilities, not bigger numbers. Each step should answer "what can I
do now that I could not before?" There are two tracks and one choice between them.

* **Production track (chapters):** what the farm can make. Wheat, flour, bread, stew, salad, feed,
  preserves, feasts. Derived from which buildings exist. [C] `lib/stackacres/chapters.ts`.
* **Expansion track (standing):** where the farm reaches. The Old Fields, the Fold, the Pasture,
  the town, and the wild places (Coast, Oak, Mine, Town Square). Derived from five milestone flags.
  [C] `lib/stackacres/shop-locks.ts`, `story/unlocks.ts`.
* **The choice:** Gold spent on a building is not spent on land. That is the central decision in
  the fantasy Kayo described: "if I build the Mill I can't afford the land expansion yet."

### The investment rule (non-negotiable)

> **Every major investment must expand production, expand reach, improve gathering or
> production, or unlock a genuinely new strategic option.**

This is the filter for every future feature and every shop row. It keeps StackAcres from turning
into a pile of disconnected upgrade buttons.

| Investment | Passes because |
|---|---|
| Mill | New production capability |
| Fold | Expands reach |
| Forge | Improves production and gathering |
| Vat | New production strategy |
| Drone (today) | Does none of these, because it is not implemented, so it is hidden |
| A bare "+10% crop yield" building | Fails, unless it creates a real specialization choice |

A purchase that fails the rule is either redesigned so it passes or kept out of the shop.

Design rules that follow from this (each is tested against the code in section N):

1. **No hidden gate.** Every gate is a visible Gold price, a visible material count, a visible
   building, or a visible action, and the screen says where to get each thing.
2. **First source before first need.** A material must be obtainable before the first thing that
   costs it, without passing through a gate that itself needs that material (no cycles).
3. **Unlocks beat multipliers.** A purchase should change what the player can do. A pure "+x%" is
   allowed only late and only as one option among several.
4. **Recoverable.** No sequence of legal actions can leave a quest, contract or chapter impossible.
5. **One place to look.** The player can always find what to do next, why, and what it opens.

---

## C. System map

```text
                     STACKCHIPS GOLD (+ farm sales)
                                |
        +-----------+-----------+-----------+-----------+
        |           |           |           |           |
      SEEDS     BUILDINGS      LAND     TOOLS/PERKS   FORGE
     (3-120g)  (Gold+wood/    (Gold+     (Gold)     (Gold+flour)
        |       stone)         units)
        v           |           |
     FARMING -----> PROCESSING --> COOKING --> ENERGY --> FISHING (and later other gathering)
   (6 beds, then       Mill        Oven          |            |
    Old Fields)       (Workshop)   Stew Pot      |            v
        |                          Counter       |          fish (no consumer today)
        v                          (House)       |
     ANIMALS <--- feed (corn, greens, wheat) ----+
   hens|sheep|cattle
        | eggs, wool, milk
        v
   DAIRY / LOOM --> cheese, cloth --> CONTRACTS --> INFLUENCE --> STANDING --> AREAS
        |                                  ^                                    |
        +--> VAT / CELLAR / KITCHEN --> Gold (away production)          WOOD / STONE / HUNTING
                                                                                 |
                                       materials --> BUILDINGS, LAND (closing the loop)
```

The loop the map shows is closed only if wood and stone feed back into buildings and land, and
today they feed four one-time buildings and nothing else (section D).

### System analysis (inputs, outputs, purpose, tradeoffs)

| System | Inputs | Outputs | Purpose | Upside | Downside | Connects to | Progression |
|---|---|---|---|---|---|---|---|
| Farming (beds, wheat and crops) | Seed Gold, water, time | Crops | Reliable production | No energy, works while away for waiting crops | Bed-limited (6 free beds until the Old Fields) | Processing, cooking, animals, quests | Old Fields, more beds [C] |
| Wood chopping | Time, a timing swing | 5-8 Wood per tree, regrows in 8 min, per-player | The first material | Free, always available | Only 4 trees; lifetime sink is 40 Wood [C] | Mill, Loom | Nothing after those two |
| Stone mining | Time, a timing swing | 4-8 Stone per boulder, 18 min, global nodes | Mid-game material | Free | Behind the Mine gate; nodes shared by all players [C] | Silo, Cellar | Lifetime sink is 50 Stone |
| Fishing | 5 energy per cast, optional radish bait | Fish worth 15/45/130 Gold | Land-independent income | No bed, paced by energy | Fish cannot be sold from any screen [C] | Energy, Barnaby q1 | None |
| Hunting (photo stalk) | Time, gear | Field Notes, Trail Photos (9 / 20 Gold) | Exploration | Free | No cooldown, no proof of a stalk, unsellable in UI [C] | Nothing | None |
| Animals (hens, sheep, cattle) | Seed-cost stake, feed, pen slots | Eggs, wool, milk | Passive production | Big-value goods | Wait, hunger, pen Gold; hens void a cycle if unfed 15 min [C] | Dairy, Loom, contracts | Slots 2k/15k/40k, Fold, Pasture |
| Processing (Mill, Dairy, Loom) | Raw goods | Flour, cheese, cloth, cake | Turn raw into valuable | Flour is 3.3x wheat | Machine cost, ingredient supply | Contracts, cooking, Greenhouse, Forge | Vat, seeds unlocked |
| Cooking (Oven, Stew Pot, Counter) | Crops, flour | Meals, sauces, preserves | Energy, contracts, seed unlocks | Opens 14 seeds | Low sale value (stew 30, salad 12) | Energy, contracts, Cellar | Chapters 1-3 |
| Away production (Silo, Cellar, Vat, Kitchen) | Gold, stone, goods | Passive Gold or feed | The farm works while you are gone | Real offline value | Capped (Kitchen 8 h, Cellar 12 jars, Vat 60 min) | Everything upstream | Chapters 4-6 |
| Land | Gold, units, quest | New ground | Growth | Visible expansion | Big Gold step (15k, 45k, 100k) | Everything | Standing |
| Contracts | A processed good | 1.1-1.3x Gold plus Influence | Demand and Standing | Teaches chains | One open at a time, no cancel, can deadlock [C] | Standing, discount, story | Trust flag |
| Story (Ray and ten travelers) | Actions | Cosmetic keepsakes, area arrival | Guide and world | Personality | Progress hidden, some quests impossible [C] | Areas, finale | Standing levels |
| Chapters | Buildings | A Ray line | Show farm growth | Derived, no state | No reward, no gating | Ray, seeds | Display only [C] |
| Tools and Forge | Gold (+ flour) | Crit chance and yield | Long-term efficiency | Visible crits | Two of three Forge items and the Mower are inert [C] | Harvest | Milestone-gated |
| Perks (Synergy) | 50k Gold each | Small permanent effects | Late sink | Slottable | Only 2 of 3 wired [C] | Crit, Mill | None |
| Prestige | 150k lifetime harvest | Multiplier on manual sales | Long-term reset | Permanent | Ignores contracts, vat, kitchen; wipes animals [C] | Sell tab only | None |

---

## D. Resource graph

Legend for "verdict": **ok** = several uses, **thin** = one job, **orphan** = no consumer, **gap** =
sellable in no screen.

| Resource | Source | Uses today | Alternatives | Verdict |
|---|---|---|---|---|
| Gold | StackChips, sales, contracts, vat | Everything | none | ok |
| Energy | Waiting (to 50), food (to 100) | Fishing only (5 per cast) [C] | none | thin, circular |
| Wood | 4 Homestead trees | Mill 15, Loom 25 [C] | none | thin, and never credits today (section 0) |
| Stone | 3 global Mine boulders | Silo 20, Cellar 30 [C] | none | thin, gated |
| Wheat | Beds, 3 Gold seed | Flour x3, hen feed, gift, quests, sell 4 | Sell raw | ok |
| Flour | Mill | Bread, cake, Greenhouse 20, Forge 15-40, contracts, blueprint, gift, Leo | Sell 40 | ok |
| Tier-1 crops (7) | 1 Gold seed, 15 s | Salad, stew, sauerkraut, bait, hen feed, quests | Sell 2 | fake choice: seven crops, one price |
| Tier-2 and 3 crops | 55 and 120 Gold seeds | Recipes (sauce, salsa, peppers, feast) | Sell 25 / 44 | ok as ingredients, poor as Gold |
| Corn | Beds | Cattle feed (1 to 4) only | Sell 44 | thin |
| Radish | Beds | Salad, fishing bait, Skye quest | Sell 2 | thin (the "gift" job is unbuilt) |
| Eggs, milk, wool | Animals | Cake, cheese, cloth, gifts, sell | Sell | ok, gated by pens |
| Cheese | Dairy | Contracts, Vat, blueprint, gift, Leo | none in UI | gap |
| Cloth | Loom | Contracts, Greenhouse 12, gift, Leo | none in UI | gap |
| Cooked goods | Oven, Pot, Counter | Eat, contracts, Cellar, Kitchen, gift, sell | Shelf | ok; stew and salad are dead ends |
| Fish (3 kinds) | Dock | Barnaby quest only | Sell 15/45/130 by API | orphan, gap |
| Field Notes, Trail Photos | Oak thicket | Nothing | Sell 9 / 20 by API | orphan, gap |
| Feed Sack | Ray, Gold | Hunger fallback for animals | none | ok |
| Cattle feed | Mill from corn | Cattle, Silo | Sell 12 | thin |
| Influence | Contracts | Discount (tools, cutters, feed), `town_trusted` flag | none | thin |
| Keepsakes, relics, story items | Quests, Ray, shrine | Toast and collection only [C] | none | orphan |
| Crossbreed hybrids (6) | Crossbreeding bed | Displayed only; no Gold door [C] | none | orphan |
| Lucky Poker Dice | Secret tap, 8% per day | Crit boost, donate, wipe upkeep | none | ok, rare |

Wood and Stone lifetime sink is 40 and 50 units because each building can be built once. After the
first Loom and Silo the trees and boulders have no reason to exist. That is the biggest structural
gap in the gathering game (section H, item 5).

Hidden sources [C]: Stone lives in the Mine, which opens at Standing 4 (three of five flags). The
map hint for the Mine and Oak always names "Unlock the Crop Fields" (15,000 Gold) even when the
cheaper "fill one order" path counts too.

---

## E. Building graph

Costs from `lib/stackacres/machines.ts` [C]. One of each kind; none can be sold back.

| Building | Cost | Built and used at | Inputs to outputs | Purpose | Unlocks | Prioritise because | Delay because |
|---|---|---|---|---|---|---|---|
| Mill | 200 + 15 Wood | Workshop | 3 wheat to 1 flour (20 s); corn to cattle feed | Turn the starter crop into real value | Corn and bean seeds, flour contracts | Cheap, 3.3x value | Needs Wood (blocked today) |
| Oven | 500 | House | Flour to bread, peppers, casserole, feast | Energy, food | Eggplant and broccoli seeds | Energy for fishing | Bread sells low (55) |
| Stew Pot | 1,500 | House | Stew, sauce | Big meals | Potato, carrot, onion (+3 with Counter) | Opens 3 seeds now | Costliest of the first three |
| Counter | 800 | House | Salad, salsa, pickles, sauerkraut | Greens | Lettuce, spinach, radish, cabbage | Opens 4 seeds | Salad has little Gold value |
| Loom | 350 + 25 Wood | Workshop (hidden under More) | 4 wool to cloth | Cloth for contracts and Greenhouse | Cloth contracts | Cheap | Needs wool, which needs the Fold (45k) |
| Dairy | 700 | Workshop | Milk to cheese; cake | Cheese, cake | Cheese contracts | Cheap | Needs milk, which needs the Pasture (145k of land) |
| Vat | 1,200 | Workshop (hidden) | 2 cheese to x2, x4, x8 over 10/30/60 min | Away multiplier | Nothing | Largest Gold multiplier | Needs cheese (145k gate) |
| Feed Silo | 12,000 + 20 Stone | Workshop | Feeds hungry animals, 48 per day | First automation | Chapter 4 | Animals eat while away | Needs Stone, Mine gated |
| Cellar | 25,000 + 30 Stone | House | 12 jars, x1.5 / x2 / x3 in 1/4/12 h | Away Gold | Chapter 5 | Passive | Stone, cost |
| Farm Kitchen | 60,000 | House | Standing order, x2 output, bank 16 (8 h) | Away cooking | Chapter 6 | Only true offline earner | Cost, needs stocked shelf |
| Greenhouse | 20 flour + 12 cloth | Map tap | 6 slots, growth x0.7 | Sets a milestone flag | Standing | No Gold | Needs cloth (Fold) |
| Forge | 30k / 40k / 60k + flour | HUD badge | Permanent crit enchants | Efficiency | Nothing | Visible crit | One item is inert |
| Barn, Workshop, House | free | World | Shop, machines, kitchen | The three anchors | none | none | none |

What each building actually changes for the player [C, agent-read]:

* **New capability:** Mill, Oven, Stew Pot, Counter (they open recipes and seeds); Dairy and Loom
  (new goods); Silo, Cellar, Kitchen (the farm earns while away); Vat (a new aging mechanic).
* **Mostly a multiplier:** Farm Kitchen (x2), Greenhouse (0.7x), Forge (crit).
* **Built with no clear use:** the `greenhouse_raised` flag gates no live shop row (its real job is
  as one of the five Standing flags).

Order is unconstrained: `placeStackAcresMachine` has no prerequisite check [C]. Chapters are
labels, not gates.

---

## F. Progression eras

Ten eras, built from what exists. "Standing" means the number of milestone flags earned plus one.
The five flags are: Old Fields opened, one filled town order, the Fold cleared, the Greenhouse
raised, the Pasture cleared.

Costs quoted are today's. The eras describe the shape; the economy pass (section H) tunes numbers.

**Era 1: The Little Farm**
* Knows: nothing. Ray's welcome, six beds, a can, 3 Gold wheat.
* Can do: plant, water, harvest, sell wheat, chop a tree, fish while energy lasts.
* New system: farming and the timing swing.
* Key resource: Gold, Wood.
* Decision: sell the wheat or hold it for flour.
* Working toward: a Mill.
* Unlocks next: Mill (200 Gold + 15 Wood).

**Era 2: First Loaf**
* Knows: wheat makes flour, flour makes bread.
* Can do: mill, bake at the Oven (in the house), take a flour order.
* New system: processing, contracts, energy from food.
* Key resource: Flour, Influence.
* Decision: Oven (500) or save; sell flour on the shelf or fill an order.
* Working toward: a second building and more beds.
* Unlocks next: first filled order sets the town-trust flag (Standing 2), which opens Coast and
  Town Square.

**Era 3: The Kitchen**
* Knows: buildings open seeds.
* Can do: Stew Pot and Counter, fourteen more seeds, meals for energy.
* New system: seed unlocks, recipes.
* Key resource: energy, crop variety.
* Decision: Counter (800) for greens or Stew Pot (1,500) for roots.
* Working toward: the Old Fields.
* Unlocks next: Ray's opening quest line ends by opening the Old Fields (Kayo's 2026-09-17
  decision: no Gold price for the first field).

**Era 4: The Fields**
* Knows: land is the limit.
* Can do: lay soil beds (167 Gold each), plant rows, water in bulk.
* New system: land and beds.
* Key resource: bed count, seed variety.
* Decision: which crop for which bed (wheat engine or ingredients).
* Working toward: a second flag (Standing 3).
* Unlocks next: with the Old Fields and one order, Standing 3 opens Oak (hunting).

**Era 5: Beyond the Fence**
* Knows: the world has places.
* Can do: hunt at the Oak, meet travelers, run their first quests, find secrets.
* New system: exploration.
* Key resource: Stone (see decision D2), trail items.
* Decision: spend time and energy exploring or tending the farm.
* Working toward: the Mine and the Silo.
* Unlocks next: the Mine (today Standing 4).

**Era 6: The Herd**
* Knows: animals turn feed into goods.
* Can do: clear the Fold (45k), keep sheep, build the Loom, weave cloth, raise the Greenhouse,
  build the Silo. Later the Pasture (100k) and cattle, then Dairy and cheese.
* New system: livestock chains.
* Key resource: wool, milk, feed, Gold.
* Decision: sheep first or save for cattle; Silo or slots.
* Working toward: cheese and the Vat.
* Unlocks next: cattle milk.

**Era 7: The Cellar and the Vat**
* Knows: time adds value.
* Can do: age cheese in the Vat, jar pickles in the Cellar, fill preserve orders.
* New system: aging and away production.
* Key resource: cheese, jars, patience.
* Decision: seal cheese for 10 minutes or 60; jars or contracts.
* Working toward: the Farm Kitchen.
* Unlocks next: Farm Kitchen (60k).

**Era 8: The Working Farm**
* Knows: the farm can run without you for hours.
* Can do: standing kitchen orders, Forge enchantments, slotted perks, extra pen slots.
* New system: capacity and specialization.
* Key resource: stocked shelf, capacity.
* Decision: which perk (3 slots, 50k each), which enchantment, which pen to grow.
* Working toward: mastery goals.
* Unlocks next: Golden Spade, finale.

**Era 9: The Operation (deferred, not built)**
* Can do: automate with pipes, a farmhand or a drone.
* Status: pipes, farmhand and drone do nothing in the live world today (section I). This era is
  documented so the current purchases are not mistaken for it. Nothing is promised in the game
  until the systems exist.

**Era 10: Mastery**
* Can do: Golden Spade (250k), finale with all ten travelers home, prestige or season.
* New system: prestige redesigned (section O, D6).
* Decision: reset for a specialty, or keep growing.

---

## G. Player decision matrix

| Choice | Upside | Downside | Opportunity cost | Intended use |
|---|---|---|---|---|
| Sell wheat or mill it | Wheat is instant Gold; flour is 3.3x | Mill needs a build; 20 s wait | Bed time | Sell early for cash, mill when the Mill exists |
| Oven, Counter or Stew Pot first | Each opens different seeds and food | Each costs Gold not spent on land | Old Fields timing | Oven for energy, Counter for cheap greens |
| Old Fields vs more buildings | Land is the bottleneck for everything | Quest-gated, so time not Gold | Building progress | First field via Ray, later land costs Gold |
| Farm vs fish vs hunt | Fishing needs no bed; hunting needs no energy | Fishing uses energy; hunting is unbounded | Time not spent farming | Fishing fills waits, hunting explores |
| Hen lease vs hen ownership | Lease is 50 Gold; ownership is 2,500 | Lease voids if unfed | Gold | Lease for learning, own once tended daily |
| Sell cheese, use in a contract, or seal in the Vat | Vat is 2x-8x | Time; needs the Vat | Contract Influence | Vat for Gold, contracts for Standing |
| Silo vs pen slots vs Fold | Silo feeds while away | 12k for the Silo | 45k Fold | Silo when animals exist |
| Jars vs pickles contract | Cellar is passive | 25k plus 30 Stone | Kitchen | Cellar before Kitchen |
| Perks vs Forge vs shovel | Crit and yield | 30k-250k each | Land | Late, one per playstyle |
| Prestige or not | Permanent multiplier | Loses animals and stock | Progress | Not designed yet |

The matrix is only healthy if each row has a real reason to pick each side. Rows 1, 4, 6 and 10
currently have one dominant answer (section H).

---

## H. Economic problems

Facts first, then the role each activity should play. None of these are nerf requests; each says
what the activity is for.

1. **Wheat to flour dominates attended play.** [I, arithmetic] About 780 Gold per bed-hour raw
   flour and up to 1,290 with flour orders, against 15-144 for every other crop. Wheat is 5 minutes,
   never thirsty, and the Mill triples its value.
   * *Role:* wheat is the reliable staple and the bed-limited engine that pays for early buildings.
   * *Lever, not nerf:* give other crops a different axis (below), not a smaller wheat.
2. **Tier-2 and tier-3 crops cannot win on Gold.** Tier 2 earns about 18-66 Gold per hour, tier 3
   about 15-55 (the "Every Crop's Job" plan already accepts this). Cooked goods add only 13-30% to
   raw value.
   * *Role:* ingredients and Influence. They exist to feed recipes, orders, feed and quests.
   * *Lever:* let them count for something wheat cannot (a contract only they fill, a feast
     bonus, a quest). Decision D5.
3. **Tier-1 crops are one item.** Seven crops, one price, one timing. That is a fake choice.
   * *Role:* fast liquidity and early ingredients. Distinguish them by jobs (already true for
     salad, stew and bait) or by timing and price (the unimplemented early-crop doc).
4. **The Vat is the largest multiplier.** [I] Six milk (660 Gold raw) become about 10,560 Gold in an
   hour, roughly 14k Gold per day per cattle.
   * *Role:* the patient late-game payout. It stays late because cattle are behind 145k of land.
   * *Lever:* diminishing returns per day, or a shared cap, not a lower multiplier. Decision D7.
5. **Materials have no ongoing sink.** Wood 40 lifetime, Stone 50.
   * *Role:* gathering should feed growth for the whole game. Lever: Wood and Stone as part of land
     clears and pen expansion (which are Gold-only today), and as a second currency competing with
     buildings. Decision D3. Constraint: no gate may need a material that sits behind that gate
     (the Fold cannot need Stone, because the Mine opens after it).
6. **Fishing and hunting are unsellable, and would dominate if opened.** Fish are about 35 Gold per
   cast for 5 energy. Stew costs about 5 Gold of seeds for 50 energy, so fishing fed by stew turns
   almost nothing into about 355 Gold. Hunting is 51 Gold per stalk with no energy, no cooldown and
   no proof.
   * *Role, fishing:* a paced side income that fills waits and eats energy, worth less per hour than
     farming. *Role, hunting:* discovery and collection, not a repeat faucet.
   * *Levers:* a market that pays full price only up to a daily amount, energy on stalks, hunting
     items feeding a collection (a field guide) instead of a sale. Decision D4.
7. **Energy is a closed loop.** Food makes energy, energy spends on fishing, fishing earns Gold that
   buys food. Nothing else uses it, so the whole cooking ladder has no stakes for a new player.
   * *Role:* the resource that paces gathering trips, never farming. This is what Kayo's own
     chapter plan already said ("energy powers only the extras"). It is only half built. Decision D4.
8. **Contracts can deadlock.** [C] Owning a Dairy or Loom can draw a cheese or cloth order that
   needs 145k or 45k of land to fill, and an order cannot be cancelled.
   * *Role:* contracts are demand and Standing, never a trap.
9. **Hens are marginal.** [C] Lease +6 to +30 Gold per 15 minutes fed; a hen unfed for 15 minutes
   voids the cycle and its 50 Gold stake. They reward attention, not investment.
   * *Role:* the tutorial animal and an ingredient supplier (eggs), not an income source.
10. **Gold sinks run out.** [I] Finite sinks are about 1.5M excluding the Drone, and the Vat can pay
    that in days. The direction doc's long-tail sinks (decorations, storage, machine upgrades,
    expansion projects) are unbuilt.
11. **Prestige rewards manual selling.** The multiplier applies only to the Sell tab, so it pays
    the player to stop using contracts, the Vat and the Kitchen, the opposite of an investment
    farm.

The economy pass comes after the architecture (per the brief). It should set numbers per role in
this section, not equalize Gold per hour.

---

## I. Dead, orphaned and connected content

Classification, per the brief: WORKING, PARTIAL, PLANNED (hide), or CORE to a future era.

| Item | State | Evidence | Recommendation |
|---|---|---|---|
| Mill, Oven, Pot, Counter, Dairy, Loom, Vat, Silo, Cellar, Kitchen | WORKING (server) | [C] | Keep. Wood-dependent ones broken by section 0 |
| Greenhouse | PARTIAL: panel works, interior scene is a stub | [C] | Keep the panel |
| Forge | PARTIAL: 2 of 3 items wired | [C] | Hide Quickened Haft until a scythe exists |
| Synergy perks | PARTIAL: 2 of 3 wired | [C] | Hide Automated Logistics until a farmhand exists; fix phone menu bug |
| Iron Shovel, Golden Spade | WORKING (crit rolls server-side) | [C] | Keep |
| Mower (20k) | PLANNED: cutter not drawn, still buyable | [C] | Hide from shop |
| Scythe | PLANNED | [C] | Not on belt already; keep off |
| Drone (1.2M) | PLANNED, CORE to Era 9 | [C] | Hide from shop |
| Farmhand | PLANNED, CORE to Era 9 | [C] | Nothing to hide |
| Irrigation pipes | PLANNED, CORE to Era 9; nothing sends `place-pipe` so nothing is charged | [V,C] | Swap the two quest objectives that need pipes (Barnaby q2, Leo q2) |
| Blueprints (Ember Spire) | PLANNED, the natural "expansion project" sink (direction sec. 3) | [C] | Keep the server code, hide |
| Fences and predators | PLANNED: no scene hooks; upgrade costs no Gold | [C] | Deferred |
| Weather | PLANNED: computed, never applied | [C] | Deferred |
| Midnight Merchant items | PARTIAL: appears only on a crit (trowel is 0%) and items have no effect | [C] | Hide the items until effects exist, or wire them |
| Story rewards (11 keepsakes) | Cosmetic; unread | [C] | Show them in the journal; consider making some unlock things |
| Crossbreed hybrids (6) | Orphan; no consumer | [C] | Give one downstream use (gift or contract) or leave collection-only |
| Fish, meat, pelt | Orphan | [C] | Section H item 6 |
| Wood, stone | Thin | [C] | Section H item 5 |
| Coast, Oak, Town Square | NPC-only areas; the Oak has one thicket | [C] | Give each one job (Oak: hunting; Coast: a second dock is unbuilt) |

Rule for everything above: do not delete. Hide from shops and menus anything that charges Gold for
an effect the player cannot observe, so the game never promises gameplay it does not have.

## J. Quest, chapter and progress architecture

Three things exist today that all say "here is what to do next": chapters, Ray's quests, and
contracts. A fourth (shop locks) and a fifth (seed unlocks) add their own signals. The player has
no way to know which one matters.

### The roles

| Thing | New role | Persistent state? | Shown as |
|---|---|---|---|
| Ray | The narrator. He says the next useful thing, keyed to the current chapter step | Existing story rows | A speech line, one badge |
| Chapters | The production track: what the farm can make | Derived, nothing stored | Steps with have and need |
| Standing | The expansion track: which places and land are open | Derived from the five flags | A short list of what opens next |
| Contracts | Repeatable demand and Influence, never a goal | Existing contract rows | The Town Board only |
| Shop locks and seed unlocks | The "what it unlocks" preview | Derived | A line inside a chapter step |
| Journal | The single place that shows all of the above | none | One sheet |

### Four rules for quests (from the brief, section 12)

1. **A quest asks only for what the player can do now, or teaches how to unlock it.** Today Ray's
   first quest asks for three new beds, which the server refuses until the 15,000 Gold unlock. [V]
2. **Progress reads state, not events, wherever state exists.** Counters only tick while a quest is
   active [C], so early actions are lost and some quests soft-lock (clear a sector or forge before
   the quest opens and nothing is left to do). Where a durable fact exists (beds owned, sectors
   owned, enchantments owned, pipes placed, orders filled, hybrids grown, tools held), read it
   directly, the way `deliver` and `hold-tool` already do. Only ephemeral actions need counters.
3. **Rewards can unlock things.** Ray's chain can end with the Old Fields opening, instead of a
   keepsake nobody sees.
4. **A test proves it.** A pure-data test walks every quest against the unlock graph and fails if
   any objective needs something the player cannot reach at that level.

### Ray's chain, redesigned (Kayo's 2026-09-17 ordering)

| Step | Ask | Doable at that point? | Teaches |
|---|---|---|---|
| 1 First Furrows | Plant and water crops in the starter beds | Yes (starter beds count) | Planting, watering |
| 2 First Flour | Build the Mill and make flour | Yes (needs Wood, section 0) | Wood, gathering, building |
| 3 First Order | Fill one flour order at the Town Board | Yes | Contracts, Influence |
| 4 The Old Fields | Reward: the Old Fields open; lay three beds | Yes, after step 3 | Land, beds |
| 5 A Full Basket | Harvest ten crops | Yes | Loop mastery |
| 6 Save Up | Point at the Fold (45k) as the next land | Read-only | The Gold decision |

Each step is a Ray line and also a chapter or standing step, so one action satisfies both and the
player never wonders which is "real".

### Traveler quests versus arrival level

Each traveler arrives at a Standing, but several quests ask for far more than that Standing
usually holds.

| Traveler | Arrives | Hardest ask | Earliest realistic cost |
|---|---|---|---|
| Pierre | 2 | Cake (q2) | 145k (needs cattle) |
| Miles | 2 | Clear a sector (q2), 3 secret zones (q1) | 45k; 3 days, one reachable zone |
| Skye | 3 | Two cloth (q2) | 45k (needs sheep) |
| Barnaby | 3 | Four pipes (q2) | Impossible today |
| Brayden | 4 | Hold Iron Shovel (q1) | 45k |
| Wes | 5 | Buy and use feed, then livestock | After 100k |
| Leo (finale) | all others | Six pipes, forge | Blocked by pipes |

Proposal: the first quest of every traveler must be achievable within its arrival era. Push the
expensive asks later in the same traveler's line, or reassign them to a traveler who arrives later.
Replace pipe objectives with something the live world supports.

### The journal, as one model

One sheet, three blocks, reachable from the existing Goal chip:

1. **Now:** Ray's one line ("Next: gather 15 Wood at the trees beside the barn") plus a tap to show
   the location.
2. **Your farm:** the current chapter's steps with have/need, each with a "where" (Workshop, House,
   trees, Mine) and "what it unlocks" (seeds, recipes).
3. **Your reach:** the next place or land to open, what opens it, and what it needs. The existing
   locked-gate hint would be replaced by "cheapest path" (see the Coast, Oak and Mine issue in D).

Only these three blocks. Keepsakes and the collected list live behind a second tab. No new HUD.

## K. Early-game roadmap

A concrete first hour, using systems that exist. Times are [U].

1. **Welcome.** Ray says "plant wheat in the beds." The tour shows the pouch and Use key.
2. **Plant, water.** Three-Gold wheat in the six starter beds, water once. The chapter step reads
   "Grow wheat" and turns to done on first harvest (derived from the lifetime harvest record).
3. **The wait.** Ray points at the four trees: "You'll need 15 Wood for a Mill." Chopping is the
   between-actions job. Fishing is available if the player wants it.
4. **Harvest.** Four wheat per bed. Ray says hold some for flour.
5. **Wood, then Mill.** The Mill button shows "200 Gold + 15 Wood (you have 9)" and where each comes
   from. Workshop builds it.
6. **Flour.** Wheat becomes flour automatically. The first flour order at the Town Board pays 140
   Gold and 10 Influence, which sets the town-trust flag and opens Coast and Town Square.
7. **Oven, in the house.** The chapter card says where. Bread, then eating it, then fishing.
8. **First real decision.** Counter (800), Stew Pot (1,500), or keep saving. Ray's chain lays the
   Old Fields at this point, so land is not a Gold gate.
9. **Beyond.** Standing 3 opens the Oak; the journal's "your reach" block says so.

Every step teaches something reused later: wood (buildings, then land), flour (contracts, Forge,
Greenhouse), Influence (Standing), energy (all gathering).

## L. Mid and late-game roadmap

* **Land ladder (expansion track):** Old Fields (quest) then the Fold (45k Gold + Wood) then the
  Pasture (100k Gold + Stone + Wood). Adding materials makes gathering matter beyond four
  buildings. The Fold cannot need Stone, because the Mine opens only after Standing 4, and Standing
  4 needs a third flag that is itself the Fold or the Greenhouse.
* **Stone timing (decision D2):** the Silo costs 12k Gold and needs Stone, and it is affordable long
  before the Fold. Opening the Mine at Standing 3 puts Stone in reach with the Old Fields and one
  order, which is a one-number change to the arrival table.
* **Herd chain:** sheep to wool to Loom to cloth to Greenhouse and cloth orders; cattle to milk to
  Dairy to cheese to Vat.
* **Away production:** Silo, Cellar and Kitchen already exist. What is missing is showing how
  full each is and a summary when the player returns (section M, phase 7).
* **Specialization:** Forge enchantments, perks (three slots), and pen slots let a player lean
  toward baking, herding, or crit farming. That is the "choose what to specialize in" the fantasy
  needs.
* **Operation era (deferred):** pipes, farmhand, drone, blueprint projects, extra Gold sinks
  (decor, storage, machine upgrades). Build only once the scene can draw them.

## M. Implementation plan

Small phases, each independently testable and low risk. Nothing starts until this document is
approved. "May change" and "must not change" are explicit.

**Phase 0: unblock production (one migration, one guard).**
* Append a migration adding `wood` and `stone` to the inventory check; verify against the live
  constraint after applying.
* Make the chop and mine callers refuse when the credit returns null instead of ignoring it.
* Add a test that every inventory item id in code appears in the latest migration's list.
* May change: one migration, two service call sites, one test. Must not change: any rule or price.

**Phase 1: tell the truth (no rule changes).**
* Show material costs and their sources on every build button (Mill: "200 Gold + 15 Wood, from the
  trees by the barn"), and say where each building is built.
* Hide inert purchases (Mower, Drone, Quickened Haft, Automated Logistics, Merchant items).
* Fix the Synergy Tree on phones (its badge unmounts itself inside "More").
* Fix stale copy (Bushels, "Long Meadow", Crop Fields planting hint, the Town Board allowance line).
* Let the store and gate sheets close with Escape and a backdrop tap.
* May change: components and copy only. Must not change: server rules.

**Phase 2: quests that can always be done.**
* Fix group planting so starter beds are exempt (a bug, matching the single-sow path).
* Make quest objectives read state where a durable fact exists; keep counters for the rest.
* Rewrite Ray's chain (section J) and let its reward open the Old Fields.
* Replace pipe objectives; reorder or reassign expensive first quests.
* Add the graph test (every objective reachable at its level).
* May change: `lib/stackacres/story/`, one service branch. Must not change: money paths.

**Phase 3: the journal.**
* One sheet with three blocks (now, your farm, your reach), replacing the Goal sheet. Add "where"
  and "what it unlocks" data per chapter step, and a resource-source table.
* May change: components and a small data table. Must not change: server rules.

**Phase 4: contracts that cannot trap.**
* Draw only items the player can currently obtain (their raw inputs' sector is owned).
* Add a "Pass" that is rate-limited to once per UTC day, so it cannot be used to cherry-pick rungs.
* May change: `contracts.ts` draw rule, one service branch. Must not change: one-open rule, prices.

**Phase 5: materials and land.**
* Put Wood and Stone into land clears and pen slots (no cycles, section L).
* Decide Mine timing (D2) and change the arrival table if needed.
* May change: data tables and a migration for costs if stored. Must not change: existing owned land.

**Phase 6: economy pass (numbers, per role in section H).**
* Give tier-1 crops distinct jobs or timings; add a Vat daily cap; decide fish and hunting sale
  rules; give energy a role beyond fishing if D4 says so.
* Needs a playtest first. May change: constants. Must not change: architecture.

**Phase 7: return loop.**
* Away summary card on open; a fill meter for each passive capacity; "ready" markers on trees and
  jars. Optionally daily contract refresh.
* May change: components, read-only server summary. Must not change: production rules.

**Phase 8: prestige redesign, and Era 9 systems.**
* Decide D6, then build. Pipes, farmhand and drone only when the scene draws them.

Each phase ships as its own branch off main, one PR each, with the migration applied alongside the
PR when a migration is involved.

Order is fixed: 0, 1, 2, 3, 4, 5, 6, 7, 8. Do not jump to the economy rebalance (phase 6) early.
Phase 0 is infrastructure, not balance: it gives every later test a reliable material economy.

Git hygiene for every phase: stage files by explicit path only. Never `git add .`, `git add -A` or
`git commit -a`. Before committing, list the staged files and confirm that unrelated working-tree
changes (for example `art/stackacres-td/rich/pal.py`) are not staged or modified by this work.

## N. Final design test

Each system against the ten questions. ✓ yes, ~ partly, ✗ no. This is my assessment [I].

| System | 1 Why | 2 How to obtain | 3 Feeds | 4 Choice | 5 Cost | 6 New options | 7 Recover | 8 Goal | 9 Alive | 10 Miss it? |
|---|---|---|---|---|---|---|---|---|---|---|
| Farming | ✓ | ✓ | ✓ | ~ | ✓ | ~ | ✓ | ~ | ✓ | ✓ |
| Wood | ~ | ✗ hidden, broken | ~ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ~ |
| Stone | ✗ | ✗ | ~ | ✗ | ✗ | ✗ | ✓ | ✗ | ~ | ✗ |
| Fishing | ~ | ✓ | ✗ | ✗ | ~ | ✗ | ✓ | ✗ | ✓ | ~ |
| Hunting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ~ | ✗ |
| Hens | ✓ | ✓ | ✓ | ~ | ✓ | ✗ | ✗ voids | ✗ | ✓ | ~ |
| Sheep and cattle | ✓ | ✗ 45k / 100k | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✓ |
| Mill | ✓ | ✗ blocked | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Oven, Pot, Counter | ✓ | ~ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Vat | ✓ | ✗ | ✓ | ~ | ~ | ✓ | ✓ | ✗ | ✓ | ✓ |
| Silo, Cellar, Kitchen | ✓ | ✗ stone, price | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ✓ |
| Land | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Contracts | ✓ | ✓ | ✓ | ~ | ~ | ✓ | ✗ deadlock | ~ | ~ | ✓ |
| Ray's quests | ~ | ✗ hidden | ~ | ✗ | ✗ | ~ | ✗ softlocks | ✗ | ✓ | ~ |
| Chapters | ~ | ~ | ✗ | ✗ | ✗ | ✗ | ✓ | ~ | ~ | ~ |
| Forge and perks | ~ | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Prestige | ✗ | ~ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Weather, fences, drone, pipes | ✗ | n/a | ✗ | ✗ | n/a | ✗ | n/a | ✗ | ✗ | ✗ |

Systems flagged by repeated "no": stone, hunting, fishing (consumer side), Ray's quests, chapters,
forge, perks, prestige, and the four dead systems. The plan above covers each.

## O. Decisions (all approved 2026-09-20)

Each item states the decision taken. Where Kayo added a qualification it is marked.

* **D1 approved:** Ray narrates. Production plus Expansion is the progression model, shown
  together in the Journal.
* **D2 approved:** the Mine opens at Standing 3.
* **D3 approved:** materials are added to land and pen expansion. Gold prices stay as they are.
* **D4 approved with a qualification:** energy is an opportunity-cost resource, never a stamina
  bar that makes ordinary farming annoying. Mining and hunting may cost a modest amount. Chopping
  stays free. Fishing and hunting get controlled economic outputs so neither becomes the optimal
  Gold faucet.
* **D5 approved:** wheat is not nerfed. Other crops get jobs wheat cannot do.
* **D6 approved:** Prestige is hidden until it is redesigned.
* **D7 approved:** the Vat gets a daily throughput cap or diminishing return. The multiplier stays.
* **D8 approved:** a once-per-UTC-day contract Pass plus availability-aware contract generation.
* **D9 approved:** dead purchases are hidden now (section I).
* **D10 deferred:** multi-harvest crops wait until phase 7 shows whether they are needed.

Original recommendations follow for reference. Where this list and the text below differ, this
list wins.

* **D1. Ray and chapters.** Recommend the roles in section J: Ray narrates, chapters and Standing are
  the two tracks, the journal shows them together.
* **D2. Stone timing.** Recommend opening the Mine at Standing 3 so Stone arrives before the Silo is
  affordable. Alternative: keep Standing 4 and label chapters 4-6 "after the Fold".
* **D3. Materials in land and pens.** Recommend adding Wood to the Fold and Wood plus Stone to the
  Pasture and pen slots, without touching Gold prices.
* **D4. Energy scope and gathering.** Recommend finishing the chapter plan: hunting stalks and
  mining cost a little energy, chopping stays free, fish and hunt items get a sale path with a daily
  appetite. This needs your call because the brief warns against arbitrary energy costs.
* **D5. Crop roles.** Recommend keeping wheat as the engine and giving other crops a job it cannot
  do (a contract, a feast bonus, a quest), rather than adjusting prices.
* **D6. Prestige.** Recommend hiding it until redesigned. Candidate: a season reset that loses
  animals and stock, keeps land and buildings, and lets the player pick a permanent specialty that
  applies to every Gold path, not only manual sales.
* **D7. Vat cap.** Recommend a daily throughput cap or diminishing return instead of lowering the
  multiplier.
* **D8. Contract Pass.** Recommend a once-per-UTC-day skip (anti-arbitrage-safe) plus the
  ingredient-availability rule.
* **D9. Dead purchases.** Recommend hiding all listed in section I now.
* **D10. Multi-harvest crops.** Not recommended yet. It would give tier 3 crops a distinct role and
  a return reason, but it is a new mechanic. Revisit after phase 7.

Direction-doc tensions to raise, not settle: the free first field (2026-09-17) reduces a 15,000 Gold
sink, which the north star would normally protect. The recommendation is to keep it (it was
Kayo's decision, and it matches "first field stays a free quest reward" in the crop plan) and
place the Gold weight on the Fold, the Pasture and the buildings.

## Appendix: verification log

Verified by me directly in this session:
* [V] Ray's first quest needs `place-soil-tile`, and the server refuses it before the 15,000 Gold
  unlock (`lib/stackacres/story/quests.ts:157-162`, `lib/server/stackacres-service.ts:5688`).
* [V] Group planting checks the Crop Fields flag with no starter-bed exemption; single sow has it
  (`stackacres-service.ts:2631-2645` versus `:2859`).
* [V] The Synergy badge sits inside the phone "More" popover, whose click handler unmounts it
  (`stackacres-hud-overflow.tsx:86`, `SynergyOverlay.tsx:130-140`). Not run in a browser.
* [V] The top-down world stubs pipes, drones, greenhouse interior and fences as no-ops
  (`topdown-world.tsx:236-252`).
* [V] Live database: the inventory check omits wood and stone; 0 wood-node rows; 0 machines built.

Everything else marked [C] was read from source by a read-only pass with file and line citations
and not re-read by me.

Still unknown [U], needs a playtest or a production query:
* Whether the client polls the "work" call while backgrounded (decides how passive the Mill and
  Kitchen really are).
* First-hour pacing, and how long each era takes.
* Whether push notifications exist for the native apps (would change phase 7).
* What the Midnight Merchant items were meant to do.
* Whether the Greenhouse tap and interior render as intended in the top-down scene.
* Production state of every recent migration other than the one queried here.
