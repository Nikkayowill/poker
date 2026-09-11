# StackAcres Travelers: Story and Questline

The optional story layer for StackAcres. It replaces the ten stranded
visitors (`lib/stackacres/visitors.ts`, concept art only, one greeting line
each) with eleven characters who each carry a short quest line, a dialogue
script, and a keepsake reward. Nothing on the farm waits on any of it. A
player who never taps a traveler loses nothing.

## Premise

The farm is a plot of land in East Preston, Nova Scotia. The player's mentor
is the spirit of Great-Grandpa Ray, who built the house himself, raised
heritage livestock, and broke the ground with a team of oxen. An auroral
shimmer drops ten travelers from other dimensions onto his land. They are
retro pixel art in a flat-vector world and they can tell. The player farms,
processes goods, and helps each of them find a way home. Leo's beacon is the
finale, and it needs the other ten home first.

Ray is not a traveler. He is the land's own, drawn as a spirit standing near
his house (PR #480 replaced his standing sprite with the house; the spirit
sprite is a new asset, not the retired one).

## Cast

| Traveler | Role | District | Unlock | Reward |
|---|---|---|---|---|
| Ray | The Pioneer | farmstead | always | `rays_heritage_cap` |
| Chef Pierre | The Retro Cook | farmstead | level 2 | `liquid_chowder_bowl` |
| Detective Miles | The Low-Res PI | coast | level 2 | `anomalous_scanner` |
| Artist Skye | The Street Animator | oak | level 3 | `glitched_neon_fence` |
| Diver Barnaby | The 16-Bit Aqua-Nut | coast | level 3 | `deepsea_waterwheel_node` |
| Knight Arthur | The Flat Kingdom Paladin | townsquare | `town_trusted` flag | `aegis_plaza_token` |
| Miner Brayden | The Blocky Excavator | mine | level 4 | `glitched_drill_bit` |
| Botanist Ivy | The Nursery Programmer | farmstead | level 4 | `hyperdense_square_seeds` |
| Cowboy Wes | The Low-Poly Wrangler | oxfields | `cleared_oxfields` flag | `oxen_speed_harness` |
| Beekeeper Bea | The Sprite Apiarist | oak | level 5 | `liquid_gold_honeycomb` |
| Astronaut Leo | The Cosmic Voyager | townsquare | every other traveler home | `infinite_shard_matrix` |

"Level" is not a new stat. It is the supply store's own milestone ladder
(`lib/stackacres/shop-locks.ts`) plus one, so a fresh farm is level 1 and a
farm holding all five flags is level 6. A locked traveler's bubble shows the
same "Requires: ..." label the store does. The brief's Town Hall and Barn
gates map onto the two permanent flags that already mean "the town trusts
you" and "the cattle pasture is yours".

## Quest lines

Every objective is a real farm verb. Counters tick off actions the server
already runs. Deliver objectives read the inventory at turn-in and debit it
then. Brayden's tool check reads the equipment rung live, so a player who
already holds the Iron Shovel is never asked to buy it again.

| Quest | Title | Objectives |
|---|---|---|
| ray.q1 | First Furrows | lay 3 soil beds, water 5 crops |
| ray.q2 | A Full Basket | harvest 10 crops |
| ray.q3 | Clearing the Debris | clear 1 district |
| pierre.q1 | Real Ingredients | bring 5 potatoes, 5 carrots |
| pierre.q2 | The Glitched Recipe | make 1 cake |
| miles.q1 | Scene of the Anomaly | find 3 hidden spots |
| miles.q2 | Heavy Evidence | clear 1 district |
| skye.q1 | Organic Pigment | bring 6 beets, 6 poppies |
| skye.q2 | Canvas | make 2 cloth |
| barnaby.q1 | Sounding the Depths | catch 3 fish |
| barnaby.q2 | Pressure Lines | lay 4 irrigation tiles |
| arthur.q1 | Provisions for the Garrison | bring 10 wheat |
| arthur.q2 | The Town's Trust | fill 2 town orders |
| brayden.q1 | Iron Tools | own the Iron Shovel |
| brayden.q2 | A Better Edge | forge 1 enchantment |
| ivy.q1 | First Cross | 1 Crossbreeding Bed harvest |
| ivy.q2 | Maritime Strains | 3 Crossbreeding Bed harvests |
| wes.q1 | Hay in the Loft | buy 12 feed servings, feed 6 times |
| wes.q2 | Working Stock | collect from animals 8 times |
| bea.q1 | Fields of Flowers | harvest 16 poppy or sunflower |
| bea.q2 | Keep Them Wet | water 20 crops |
| leo.q1 | Beacon Components | bring 5 flour, 5 cheese, 5 cloth |
| leo.q2 | Light the Beacon | lay 6 irrigation tiles, forge 1 enchantment |

Rewards are story items only (`lib/stackacres/story/items.ts`), the same
category as Ray's keepsakes and the Pilgrim's relics. A turn-in never credits
Gold. `stackacres-service.ts` pins Gold to four credit sites and this is not
a fifth.

## Where it lives

```
lib/stackacres/story/
  travelers.ts     the cast: name, district, unlock, reward
  items.ts         the eleven keepsakes
  unlocks.ts       derived gates, level = shop milestone + 1
  events.ts        the farm events the engine listens for
  quests.ts        objectives per traveler, labels, event matching
  state.ts         stored progress, meet / event / turn-in reducers, the view
  dialogue.ts      every line, node selection
  use-stackacres-story.ts   the client hook
```

Server is authoritative, same as every other StackAcres system. The pure
reducers in `state.ts` are the only thing that moves progress:

- `applyStoryEvent(story, event)` runs inside the server action that caused
  the event. The client replays the same event locally so a counter ticks
  before the response lands, and drops its replay the moment a fresh server
  view arrives.
- `meetTraveler` and `applyTurnIn` run for the two intents a bubble can post,
  `story-meet` and `story-turn-in`. Both refuse before touching anything.
- `storyView` is what the client renders. `dialogueNodeFor` picks a node from
  it. A node carries `speakerName`, `dialogueText`, `vibratePattern`, the
  buttons, and the intent the committing button posts. It never names an
  item or a number to change.

Events map onto existing actions like so:

| Event | Action |
|---|---|
| harvested | collect |
| watered | water |
| fed | feed, feed-pen |
| feed-bought | buy-feed |
| processed | process, work |
| fish-caught | catch-fish |
| secret-zone-tapped | tap-secret-zone |
| sector-cleared | clear-sector |
| pipe-placed | place-pipe |
| soil-placed | place-soil-tile |
| contract-fulfilled | fulfill-contract |
| enchantment-forged | forge-enchantment |
| crossbreed-harvested | harvest-crossbreed |

## Built and not built

Built: everything under `lib/stackacres/story/`, with tests, and this doc.

Not built yet, in the order they should land:

1. Server slice. A `homestead_story` row per profile holding `StoredStory`,
   `story` on `StackAcresView`, the two intents on the actions route, and
   `applyStoryEvent` calls inside the handlers listed above. Migration ships
   with the same PR and is applied with it.
2. Scene. Placement for eleven travelers (the same seeded search
   `visitors.ts` uses), a hit-test, and a tap that calls `open`. Ray's spirit
   stands near his house, drawn translucent.
3. Bubble. One dialogue component for every traveler, shaped like
   `stackacres-monk-dialogue.tsx`, rendering a `StoryDialogueNode` and its
   choices. Locked travelers show the hint under the line.
4. Art. Ten traveler sprites through the visitors' own pixelation pipeline
   (`prep_visitors.py`: cut, box-filter to a 48px grid, 20-colour quantize,
   nearest-neighbour upscale). Reference renders are in `~/Pictures`
   (`RandomNPC1.jpg`, `4_NPCs.jpg`, `4NPCs_2.jpg`). Portrait paths are
   `/stackacres/sprites/traveler-<id>.png`.
5. Remove `visitors.ts`, `stackacres-visitor-greeting.tsx`, and the ten
   `visitor*` prop kinds once the scene draws the new cast.

The Pixel Pilgrim, the Midnight Merchant, the farmhand, and Ray's gift
friendship are separate systems and stay as they are.
