# StackAcres early-game crop economy: carrot, potato, radish, wheat

Design spec, written 2026-09-16 from Kayo's brief ("Early-Game Crop Economy & Wheat
Progression"). **Nothing here is implemented.** The top-down rewrite's rule is "no logic
changes", so this ships as its own change after the dev route is playable, not inside the
renderer work. Every number below is a proposal to test by playing, measured against the
live values quoted in each section.

The goal: each of the four early crops has one job, a player can't win the early game by
planting whatever pays most and selling it, and **wheat is the road into livestock**.

## Where the live game is today

The brief assumes things the game doesn't have yet, and the live numbers point the other
way in places. This is the gap the spec has to close.

| | Live today (source) | The brief wants |
|---|---|---|
| Carrot, potato, radish | Identical: 1g seed, 15s, 1 item, sells 2g (`catalogue.ts` TIER1, `items.ts`) | Three different jobs |
| Watering | Tier-1 thirst is 8 min, so a 15s crop never gets thirsty (`catalogue.ts` comment) | Carrot thirsty, wheat not |
| Wheat | Two wheats. The **Wheat Plot** (`wheat-plot.ts`): 15g, 10 min, 4 wheat worth 4g each, feeds the Mill. The **Wheat crop** `wheatsheaf`: 120g, 4 h, 5 items worth 44g each | One low-value infrastructure crop |
| Straw, grain | Don't exist as items | Wheat yields both |
| Stamina or energy | Doesn't exist | Potato solves an energy bottleneck |
| Buffs (speed, mining luck) | Don't exist | Radish cooks into buffs |
| Gifts | Only processed goods are giftable, and only Ray has preferences (`friendship.ts`) | NPCs love radishes |
| Hen Coop | Bought outright for 50g, no materials (`catalogue.ts`) | Built with wood, stone and straw |
| Hen feed | Feed Sack, 96g for 6 servings; hunger 8 min inside a 15 min cycle, a starving hen loses its batch | Wheat grain in the trough |
| Cattle and sheep upkeep | Feed only | Straw bedding plus feed |
| Wood, stone | Don't exist as items | Coop and barn materials |

**Recommendation for the gaps.** Keep the single currency and don't add three new systems at
once. The spec below uses what exists wherever it can: potatoes feed Pierre's cooking (his
first quest already asks for 5 potatoes and 5 carrots) instead of a stamina bar, radishes
become gifts through `friendship.ts` instead of a buff system, and the coop costs Gold plus
straw instead of wood and stone. Stamina and buffs are listed at the end as a later step if
playtesting says the potato and radish still feel pointless.

## 1. What each crop is for

**Carrot: the money crop.** Fast, thirsty, one item that sells well. Rewards staying on the
farm and watering. The only early crop worth selling.

**Potato: the bulk crop.** Slower, barely needs water, a harvest gives several potatoes that
each sell for almost nothing. Its value is volume: cooking at Pierre's (and the quests that
ask for piles of them). Later, if stamina exists, eating one restores energy.

**Radish: the friendship crop.** Slow for what it sells for, so selling radishes is a
mistake the tooltip warns about. Every early traveler likes being given one, and Skye's
quest already wants six for pigment.

**Wheat: the infrastructure crop.** Needs no water and grows while you're away, so it pairs
with exploring the other areas. Every harvest gives **Wheat Grain and Straw**. Neither sells
for much. Grain feeds hens; straw builds and beds animals. This replaces the Wheat Plot's
current plain "wheat" item, and the 4-hour `wheatsheaf` cash crop moves off the early shelf
(see balancing).

## 2. Player journey: from roots to the first egg

1. **First minutes.** Ray greets you in the yard. The west bed is dug. The shop sells carrot
   and potato seed. Carrots come up in seconds and sell, so the first Gold comes from
   carrots and the watering can.
2. **Pierre asks for ingredients** (his live quest: 5 potatoes, 5 carrots). Potatoes are the
   first crop the player grows *to keep*. A potato harvest gives 3, so the quest is
   reachable from two plantings, and the sell price makes it obvious they aren't for selling.
3. **Radish seed opens** with Skye's arrival at Level 3, or earlier from Ray's shop.
   Handing Ray a radish shows the friendship heart move. The tooltip says who likes them.
4. **Ray points at the empty spot in Hen Haven where the coop goes.** A sign on it reads
   *"Hen Coop: 50g and 12 Straw."* The player has Gold from carrots but no straw, which is
   the whole point: the gate is visible from day one, and the thing missing is named. (The
   area renders show the coop built; an unbuilt footing sprite is needed for this state.)
5. **Wheat seed goes on sale** (cheap, 3g). A wheat strip is the one crop that says
   *"No water needed. Grows while you're out."* The player plants it and walks off to the
   pond or the Old Fields log.
6. **First wheat harvest: 4 Grain and 3 Straw.** Selling grain pays 1g each; the tooltip
   says *"Hens eat this."* Most players keep it. Two harvests cover the coop's 12 straw with
   grain left over.
7. **Build the coop.** Tap the footing with 50g and 12 straw. The coop appears with its hen
   (a Hen Coop is still one unit, as it is today).
8. **Fill the trough.** Drop grain on Hen Haven's trough (the existing `feed-pen` gesture):
   1 grain is 1 serving. The hen is fed for its cycle and lays 4 eggs (18g each, the live
   price). The loop closes: a wheat harvest now pays for itself many times over through
   eggs, which is why hoarding it was right.
9. **Later, the Fold and the Pasture** ask for straw again as bedding: each sheep or cattle
   cycle needs 1 straw laid in the pen plus feed. The player who kept a standing wheat strip
   walks straight into it.

## 3. Items and tooltips

Tooltips follow the young-audience rule: say what it's for in the first line, in plain words.

**Wheat Seeds**
- Flavor: *"Ray swears the old fields grew wheat taller than he was."*
- Tooltip: *"Grows into Wheat Grain and Straw. Needs no water. Grows while you're away."*
- Shop line: *"3g · ready in 5 min · no watering"*

**Wheat Grain**
- Flavor: *"Plump and golden. The hens can hear you carrying it."*
- Tooltip: *"Hen food. Drop it on a trough: 1 grain feeds 1 hen for a cycle. Also milled
  into Flour."*
- Sell line: *"Sells for 1g. Worth far more as eggs."*

**Straw**
- Flavor: *"Dry, warm, and everywhere once you start."*
- Tooltip: *"For building and bedding. The coop needs 12 to build. Sheep and cattle need 1
  a cycle to stay warm."*
- Sell line: *"Can't be sold."* (See balancing: straw has no sell price, so it can never be
  turned into Gold by mistake.)

**Radish** (tooltip addition): *"Everyone in town likes being given one."*
**Potato** (tooltip addition): *"Pierre cooks with these. A harvest gives 3."*
**Carrot** (tooltip addition): *"Thirsty. Water it once while it grows and it sells for more."*

## 4. Balancing

Carrot is the reference: **1 unit of time = one carrot cycle (15s)**, **1 unit of Gold =
carrot seed (1g)**. Water ticks mean how many times the crop goes thirsty in one growth.

| | Seed | Grow time | Water ticks | Yield | Sells (each) | Gold per cycle, net | Job |
|---|---|---|---|---|---|---|---|
| Carrot | 1g | 1× (15s) | 1 | 1 | 5g | +4 | Money |
| Potato | 1g | 3× (45s) | 0 | 3 | 1g | +2 | Bulk, cooking, quests |
| Radish | 2g | 4× (60s) | 1 | 1 | 2g | 0 | Gifts |
| Wheat | 3g | 20× (5 min) | 0 | 4 grain + 3 straw | grain 1g, straw unsellable | +1 | Hens, building, bedding |

What the ratios enforce:

- **Gold per minute** ranks carrot (+16/min, if watered) far above potato (+2.7/min), wheat
  (+0.2/min) and radish (0). Selling anything but carrots is visibly bad, so the other three
  keep their jobs without locks.
- **Carrot's premium depends on watering.** Proposed rule: an unwatered carrot still grows
  but sells at 2g (today's price). That makes watering the active-play reward instead of a
  chore that blocks growth, and keeps the live "neglect costs time, never Gold" principle
  as close as possible (it costs the bonus, not the seed).
- **Wheat's sell value is below its seed cost per straw.** 4 grain at 1g against a 3g seed
  is +1, and straw sells for nothing, so a wheat harvest is never worth selling. Its real
  value is through the hen: 1 grain feeds a hen for a 15 min cycle that lays 4 eggs at 18g,
  so **1 grain becomes 72g of eggs**. Hoarding is the obvious right move.
- **Grain against the Feed Sack.** The Feed Sack stays (a hungry hen must always be
  feedable, per `catalogue.ts`), at 16g a serving against grain's 1g. Nobody who grows wheat
  buys sacks; nobody is ever stuck without feed.
- **Coop cost.** 50g plus 12 straw is four wheat harvests (20 min passive) and a few
  minutes of carrots. Long enough to feel earned, short enough for one session.
- **Radish at zero net** is deliberate. Its return is friendship points. If a sell price
  above seed cost creeps in, it becomes a worse carrot and the job disappears.

### Changes to live numbers this implies

| File | Change |
|---|---|
| `lib/stackacres/catalogue.ts` | Split TIER1 into carrot, potato and radish entries with their own duration and thirst; move `wheatsheaf` off the early shelf (it stays as a later cash crop, or is retired) |
| `lib/stackacres/items.ts` | Carrot 5g, potato 1g with yield 3, radish 2g; add `straw` with no sell price |
| `lib/stackacres/wheat-plot.ts` | Seed 3g, 5 min, yield 4 grain + 3 straw (today: 15g, 10 min, 4 wheat) |
| `lib/stackacres/machine-items.ts` | `wheat` becomes Wheat Grain at 1g; add `straw` |
| `lib/stackacres/friendship.ts` | Radish giftable and liked by every early NPC |
| Hen Coop purchase | Adds a 12 straw cost next to the 50g (server action and its RPC) |
| `feed-pen` action | Accepts grain as a serving, before falling back to a Feed Sack |
| Sheep and cattle cycles | Consume 1 straw each as bedding; without it the cycle pauses (never loses stock) |

The last three touch the server's guarded actions, so they need migrations applied with the
PR (standing rule). The rest are pure-module changes covered by existing unit tests.

## Later, only if playtesting asks for it

- **Stamina.** If potatoes still feel pointless after the cooking and quest uses, add an
  energy bar that tools spend and eating refills. It's a whole system, so it should earn its
  place first.
- **Buffs.** Radish dishes that speed walking or raise fishing and mining luck, once there's
  a mine to be lucky in.
- **Wood and stone.** Building materials for the barn and coop, from the Ancestral Oak's
  woods and the Mine, which would give those areas a job before their travelers arrive.

## Art

Carrot, potato, radish and wheat are drawn at three stages each in the area rig
(`art/stackacres-td/areas/rig/crops.py`). Grain and straw item icons aren't drawn yet.
