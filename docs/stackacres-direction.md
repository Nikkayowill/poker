# StackAcres: product direction, economic architecture and design north star

Kayo's direction for StackAcres, 2026-09-18. It applies StackAcres-wide: use it when making
architectural, gameplay, economy, progression, UX and feature decisions. If a feature request
seems to pull against it, raise that instead of quietly letting the request redefine the game.

The most important thing to understand:

> **StackAcres is not simply a standalone farming game. It is a persistent farm/investment layer
> inside StackChips.**

The game has grown from a simple farm/investment concept into a much more complete 2D farming
game. That complexity is welcome, but it must not make the original economic purpose disappear.

## 1. The core vision

StackChips is the broader game ecosystem. Players earn Gold through active play: PvP duels, solo
wagers, puzzles and the other StackChips games. StackAcres is where they **invest that Gold into a
persistent farm**.

```text
                 STACKCHIPS
                     │
          Active Gold earning
                     │
                     ▼
                   GOLD
                     │
                     ▼
                STACKACRES
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
        LAND      BUILDINGS    ANIMALS
          │          │          │
          └──────────┼──────────┘
                     ▼
               FARM PRODUCTION
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
        CROPS      GOODS      PRODUCTS
          │          │          │
          └──────────┼──────────┘
                     ▼
                FARM REVENUE
                     │
                     ▼
               PASSIVE GOLD
                     │
                     ▼
                 REINVEST
```

The farm functions as:

1. A Gold investment destination
2. A long-term progression system
3. A Gold sink
4. A passive/semi-passive Gold generator
5. A persistent player-owned asset
6. A satisfying farming game in its own right

These goals are not mutually exclusive. The farm should be fun to play manually while becoming
more productive as the player invests in it.

## 2. Not a generic "everything is free" farm game

"Responsive farming gameplay" does not mean "all farming systems are free". Those are separate
concerns.

Watering, planting, harvesting, interacting with crops, moving around and managing the farm
should feel immediate and satisfying. **Economic progression should consume Gold**, and the player
should always have meaningful reasons to invest it: seeds, land, extra plots, buildings and their
upgrades, animals and their housing, machines, production equipment, storage, automation,
infrastructure, cosmetic/decorative expansion, production capacity, premium farming
infrastructure, expansion projects.

> **Individual gameplay actions should not feel nickel-and-dimed, but the farm as an economic
> asset should be expensive to build and expand.**

## 3. A huge Gold sink

StackAcres exists partly to give Gold somewhere meaningful to go. The player should regularly
think: *"I have Gold. What should I invest it into?"*

```text
Gold
 │
 ├── New land
 ├── Better tools
 ├── Seeds
 ├── Animals
 ├── Barns/coops
 ├── Mills
 ├── Ovens
 ├── Processing machines
 ├── Storage
 ├── Production upgrades
 ├── Farm automation
 ├── Decorations
 ├── Infrastructure
 └── Expansion projects
```

Don't let the player reach a point where there's nothing meaningful to spend Gold on. When adding
a farm system, ask: *"Does this create another meaningful investment decision?"* If it only adds
complexity without meaningful gameplay or economic decisions, question whether it belongs.

## 4. It also generates Gold

The farm should become a **productive asset**, generating Gold through crop sales, processed
goods, town orders, animal products, production chains, efficient layouts, higher-value crops,
upgraded machinery, automation and other farm businesses. The player should feel the investment
paying off.

```text
Player earns 5,000 Gold in StackChips
        ↓
Invests 5,000 Gold into farm
        ↓
Buys land + seeds + machine
        ↓
Farm becomes more productive
        ↓
Produces goods
        ↓
Sells goods
        ↓
Generates Gold
        ↓
Player reinvests profits
        ↓
Farm becomes increasingly valuable
```

That's a progression loop, not a simple consumable-currency loop.

## 5. Passive income must not destroy the economy

> **Passive income should reward investment without making active StackChips gameplay
> irrelevant.**

```text
Active StackChips play
        ↓
More Gold
        ↓
More farm investment
        ↓
Better passive production
        ↓
More farm income
        ↓
More capital available
        ↓
More opportunities in StackChips
```

Don't casually introduce exponential or infinite Gold generation. When adding passive income,
consider investment cost, production rate, upgrade cost, upkeep, storage capacity, production
time, diminishing returns, offline accumulation limits, maximum claimable income, and the Gold
sinks that absorb what it generates. The goal is a healthy economy, not unlimited inflation.

## 6. The farm should feel like an asset

> "This is MY farm, and I have built it."

The player visibly progresses from a tiny starter farm to a developed farm, to a large productive
operation, to a highly optimized farm/business. Investments should visibly change the world: if
the player spends 10,000 Gold on an upgrade, they should be able to see what it did. Avoid
abstract progression wherever a physical, in-world representation makes sense.

## 7. It's a full 2D game now: preserve that

StackAcres should have satisfying movement, crops, planting, watering, harvesting, animals,
buildings, production, resource management, exploration where appropriate, progression, recipes,
layout decisions, visual upgrades and meaningful interaction. Do not simplify it back into an
idle/investment spreadsheet.

> **Full farming gameplay sitting on top of an investment/economic foundation.**

The farming game is the experience. The economy is the progression engine underneath.

## 8. Crops must have purpose

Crops are not different-colored items that sell for different amounts. Every crop needs a reason
to exist, ideally more than one: food, recipes, animal feed, production, town orders, gifts, farm
bonuses, bait, processing, direct sales, long-term storage, economic optimization.

```text
Wheat
 │
 ├── Flour
 │    ├── Bread
 │    ├── Cake
 │    └── Orders
 │
 ├── Animal feed
 │
 └── Direct sale
```

That creates real decisions: *Do I sell this? Process it? Use it for feed? Save it for a recipe?*
Much better than every crop being `grow → sell → Gold`.

## 9. Gold should create meaningful choices

Bad: buy upgrade A because it's obviously better than everything else.
Better: *do I spend 5,000 Gold expanding land, improving production, buying animals, or upgrading
my existing machinery?* The player should have competing investment opportunities.

## 10. Don't over-monetize individual actions

A Gold sink is good when it's a meaningful investment. Friction is bad when it makes the game
annoying.

| Good | Bad |
|---|---|
| The new greenhouse costs 25,000 Gold | Pay 2 Gold every time you water a crop |
| Upgrade the barn for 10,000 Gold | Pay Gold every time you feed an animal |
| Buy a new machine for 15,000 Gold | Pay Gold every individual time you use the machine |

The economy creates strategic decisions, not repetitive taxes on basic gameplay.

## 11. Responsiveness is non-negotiable

Farm actions must feel instantaneous. The visual state never waits on a network request unless it
genuinely can't be predicted locally.

```text
Correct:  PLAYER ACTION → LOCAL STATE MUTATION → IMMEDIATE VISUAL UPDATE
          → SERVER REQUEST → SERVER RECONCILIATION

Wrong:    PLAYER ACTION → SERVER REQUEST → WAIT → SERVER RESPONSE
          → LOCAL STATE MUTATION → VISUAL UPDATE
```

This applies to planting, watering, harvesting, hoeing, chopping, placing objects, picking up
items, animal interactions, production interactions and any other immediate farm action. The
player should never see a 4–5 second delay because the backend hasn't answered.

## 12. Optimistic state must not fight server reconciliation

The client may say *"I know what should happen, so I'll show it now"*; the server confirms later.

1. Apply the action's optimistic state immediately.
2. Render it immediately.
3. Track which entities the action affected.
4. Send the server request.
5. Reconcile the response.
6. Don't let generic response protection/claim logic suppress the action's own optimistic update.
7. Preserve provisional entities across dependent actions.
8. When a provisional entity receives its real server ID, transfer its state correctly.

Be especially careful with sequences like `HOE → SOW → WATER`, where the server may still be
processing an earlier action when the player performs the next one. It should still feel
immediate.

## 13. Server state and presentation state are different concerns

`crop.watered = true` is enough to show the watered crop immediately; saving it is a separate
responsibility. `crop.growthStage = 2` should update that crop's visuals immediately. Don't
rebuild the whole farm because one crop changed. Prefer targeted state updates.

## 14. Performance principle

The game should feel native and local even though state is server-backed. The player's
perception is *"I clicked it, and it happened"*, never *"I clicked it, waited for the backend, and
eventually something happened."* Latency should be mostly invisible during ordinary farm play.

## 15. StackChips ↔ StackAcres navigation

The two are connected, but the player shouldn't have to leave the farm for basic operations.
Switching should feel lightweight and intentional (`StackChips ↔ StackAcres`), not
`forced exit → StackChips → forced reload → StackAcres`. Gold is shared across the ecosystem.

## 16. A reason to return to both

- **StackChips:** "I want more Gold." Play duels, puzzles, solo activities, other games. Earn Gold.
- **StackAcres:** "I want to improve my farm." Spend Gold, build production, generate value, check
  back later, harvest, collect, reinvest.

Two complementary loops, not two unrelated games.

## 17. Not a Stardew Valley copy

Stardew is useful inspiration for satisfying farming, world interaction, crop progression,
production, exploration and player attachment. StackAcres doesn't need its whole structure. Its
strongest differentiator is **a persistent farming/investment game connected to a broader
game-based Gold economy**. Don't add features just because Stardew has them. Ask: *does this make
StackAcres more fun, more strategic, more economically interesting, or more itself?*

## 18. Keep the crop design rich

The current direction, to preserve and build on (merged 2026-09-18 with the early-crop spec in
`docs/stackacres-early-crop-economy.md`, which has the early numbers):

- Wheat → grain (hen feed) and straw (coop building, animal bedding), and flour → bread/cake/orders
- Potato → stew/chowder, cooking quests
- Carrot → the early money crop (sells best raw, more when watered), then stew/salad
- Onion → stew/chowder/sauce/salsa
- Lettuce → salad/animal feed
- Spinach → salad/animal feed
- Cabbage → sauerkraut
- Radish → gifts everyone likes, fishing bait
- Corn → cattle feed/corn products
- Green beans → soil interaction
- Tomato → sauce/salsa
- Hot pepper → salsa/buffs
- Bell pepper → stuffed peppers/gifts
- Celery → sauces/pickles
- Eggplant → feast
- Broccoli → feast/casserole

The farm should increasingly feel like an interconnected production system.

## 19. Depth, not busywork

More systems don't automatically mean better gameplay.

```text
Good:  Crop choice → Production decision → Investment decision → Layout decision → Economic result

Bad:   Click machine → Click confirmation → Click collect → Click process → Click confirm → Click collect
```

## 20. Automation is a late-game investment

- **Early:** the player waters, harvests and feeds by hand.
- **Mid:** better tools and infrastructure reduce friction.
- **Late:** expensive investments automate parts of production (irrigation, automatic harvesting,
  animal feeding systems, advanced mills, processing chains, storage, production buildings).

Automation doesn't remove the game. It represents *"my farm has become a serious operation"*, and
it's a significant Gold sink in its own right.

## 21. Offline/passive progression

When the player leaves, the farm keeps producing where appropriate. Don't simulate every second.
Calculate from elapsed time, active production, production rates, storage limits, upgrades, animal
production, machine availability and caps.

```text
Player leaves → farm has 3 production machines → each produces every X minutes
→ player returns 4 hours later → game calculates accumulated production
→ storage/caps applied → player collects
```

## 22. Always distinguish three things

- **Gameplay:** what the player physically does.
- **Progression:** how the farm becomes more capable.
- **Economy:** how Gold enters and leaves.

Example, watering. Gameplay: the player waters a crop. Progression: better irrigation eventually
reduces manual work. Economy: irrigation infrastructure costs Gold. Don't solve an economy problem
by making gameplay annoying.

## 23. Priority order when it's ambiguous

1. **Immediate game feel.** Does it respond instantly?
2. **Fun.** Is the interaction enjoyable?
3. **Meaningful progression.** Is there something worth building toward?
4. **Economic purpose.** Useful sinks, generation, or investment decisions?
5. **StackChips integration.** Does it reinforce the ecosystem?
6. **Technical simplicity.** Can it be built without unnecessary complexity?

Never sacrifice 1 or 2 just to optimize 4.

## 24. Before implementing a feature

Answer these before writing code, not after:

1. What player problem does this solve?
2. What's the gameplay loop?
3. What's the progression loop?
4. Where does Gold enter?
5. Where does Gold leave?
6. Does it create an investment decision?
7. Does it generate passive or active value?
8. Does it make StackAcres more distinct?
9. Does it create unnecessary friction?
10. Can the state update optimistically and immediately?
11. What happens if the server takes 1–5 seconds to respond?
12. What happens if the player does two dependent actions before the first response?
13. What happens offline or on a poor connection?
14. What's the simplest implementation that keeps the intended behavior?

## 25. Economic north star

```text
PLAY STACKCHIPS → EARN GOLD → INVEST IN STACKACRES → BUILD FARM → INCREASE PRODUCTION
→ GENERATE GOLD → REINVEST → BIGGER / BETTER FARM → MORE PRODUCTION → MORE ECONOMIC POWER
```

And the farm is enjoyable as a standalone game:

```text
Plant → Grow → Water → Harvest → Process → Cook → Feed → Sell → Upgrade → Expand
```

The two loops reinforce each other.

## 26. The most important rule

Don't let the latest feature request redefine what StackAcres is.

> **StackAcres is a full-fledged 2D farming game built around persistent investment, progression,
> passive production, and a shared Gold economy with StackChips.**

It is not merely a farming minigame, an idle game, a Gold generator, a Gold sink, a Stardew clone,
or a collection of farming mechanics. It's the combination: fun enough that players want to spend
time there, economically meaningful enough that investing matters, and connected enough to
StackChips that the two strengthen each other.

## 27. Implementation principle

Don't rewrite large systems unnecessarily. First:

1. Inspect the existing architecture.
2. Identify the current source of truth.
3. Identify client/optimistic state.
4. Identify server state.
5. Identify synchronization boundaries.
6. Identify existing economic systems.
7. Identify existing Gold flows.
8. Identify existing persistence/reconciliation behavior.
9. Make the smallest change that preserves the architecture.
10. Add regression tests for the behavior.
11. Run relevant tests plus typecheck, lint and build where appropriate.

Don't introduce a second competing state-management system without a demonstrated need. Don't
replace working systems just because another architecture looks cleaner.

## Final product test

> **Why would a StackChips player care about building a farm?**
>
> Because Gold they earn in StackChips can be invested into a persistent farm that grows into a
> productive asset, generates value over time, gives them another satisfying game to play, and
> provides increasingly meaningful things to build and optimize.

> **Why would someone play StackChips after building a farm?**
>
> Because the farm creates an ongoing reason to acquire more Gold, while StackChips provides the
> active gameplay through which they can accelerate their farm's growth.

That relationship is the foundation. Don't lose it as StackAcres gets more complex.
