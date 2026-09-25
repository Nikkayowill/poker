# StackAcres Travelers: Story and Questline

The optional story layer for StackAcres: eleven characters, each carrying a
short quest line, a dialogue script, and a keepsake reward. Nothing on the
farm waits on any of it. A player who never taps a traveler loses nothing.

**Fully shipped and live**, not a design doc for future work. This file
describes the current architecture and cast, then the five extensions in
flight on their own branches (see "Recent extensions" below) — read those
sections before touching the mechanism they cover.

## Premise

The farm is a plot of land in East Preston, Nova Scotia. Ray built the house
himself, raised heritage stock, and broke the ground with a team of oxen. An
auroral shimmer drops ten travelers from other dimensions onto his land. They
are retro pixel art in a flat-vector world and they can tell. The player
farms, processes goods, and helps each of them find a way home. Leo's beacon
is the finale, and it needs the other ten home first.

Ray is not a traveler — he is the land's own — but he is drawn on the same
character rig, at the same quality, as everyone else (a spirit standing near
his house, and true-pixel-art-in-a-flat-vector-world for the travelers, were
both an earlier isometric-era look; both are retired).

## Cast

| Traveler | Role | District | Unlock | Reward |
|---|---|---|---|---|
| Ray | The Pioneer | farmstead | always | `rays_heritage_cap` |
| Chef Pierre | The Retro Cook | farmstead | level 2 | `liquid_chowder_bowl` |
| Detective Miles | The Low-Res PI | coast | level 2 | `anomalous_scanner` |
| Artist Skye | The Street Animator | oak | level 3 | `glitched_neon_fence` |
| Diver Barnaby | The 16-Bit Aqua-Nut | coast | level 3 | `deepsea_waterwheel_node` |
| Knight Arthur | The Flat Kingdom Paladin | townsquare | `town_trusted` flag | `aegis_plaza_token` |
| Miner Brayden | The Blocky Excavator | mine | level 3 | `glitched_drill_bit` |
| Botanist Ivy | The Nursery Programmer | farmstead | level 4 | `hyperdense_square_seeds` |
| Cowboy Wes | The Low-Poly Wrangler | oxfields | `cleared_oxfields` flag | `oxen_speed_harness` |
| Beekeeper Bea | The Sprite Apiarist | oak | level 5 | `liquid_gold_honeycomb` |
| Astronaut Leo | The Cosmic Voyager | townsquare | every other traveler home | `infinite_shard_matrix` |

Brayden sits a rung earlier than his level-4 cohort on purpose: his arrival is
what opens the Mine (`WILD_AREA_TRAVELER`), the only Stone on the farm, and
level 4's own Feed Silo needs Stone to build — level 3 puts Stone in reach
before a player can afford the thing it builds.

"Level" is not a new stat. It is the supply store's own milestone ladder
(`lib/stackacres/shop-locks.ts`) plus one (`storyLevel`), so a fresh farm is
level 1 and a farm holding all five milestones is level 6. A locked
traveler's bubble shows the same "Requires: ..." label the store does.

## Quest lines

Every objective is a real farm verb. Counters tick off actions the server
already runs. Deliver objectives read the inventory at turn-in and debit it
then. Brayden's tool check reads the equipment rung live, so a player who
already holds the Iron Shovel is never asked to buy it again.

| Quest | Title | Objectives |
|---|---|---|
| ray.q1 | First Furrows | water 3 crops |
| ray.q2 | First Flour | make 1 flour |
| ray.q3 | A Full Basket | harvest 10 crops (any) |
| ray.q4 | First Order | fill 1 town order |
| pierre.q1 | Real Ingredients | bring 5 potatoes, 5 carrots |
| pierre.q2 | The Glitched Recipe | make 1 cake |
| miles.q1 | Scene of the Anomaly | find 3 hidden spots |
| miles.q2 | Heavy Evidence | clear 1 district |
| skye.q1 | Organic Pigment | bring 6 radishes, 6 tomatoes |
| skye.q2 | Canvas | make 2 cloth |
| barnaby.q1 | Sounding the Depths | catch 3 fish |
| barnaby.q2 | Pressure Lines | water 25 crops |
| arthur.q1 | Provisions for the Garrison | bring 10 wheat |
| arthur.q2 | The Town's Trust | fill 2 town orders |
| brayden.q1 | Iron Tools | own the Iron Shovel |
| brayden.q2 | A Better Edge | forge 1 enchantment |
| ivy.q1 | First Cross | 1 Crossbreeding Bed harvest |
| ivy.q2 | Maritime Strains | 3 Crossbreeding Bed harvests |
| wes.q1 | Hay in the Loft | buy 12 feed servings, feed 6 times |
| wes.q2 | Working Stock | collect from animals 8 times |
| bea.q1 | Fields of Flowers | harvest 16 bell pepper or green bean |
| bea.q2 | Keep Them Wet | water 20 crops |
| leo.q1 | Beacon Components | bring 5 flour, 5 cheese, 5 cloth |
| leo.q2 | Light the Beacon | fill 3 town orders, forge 1 enchantment |

Rewards are story items only (`lib/stackacres/story/items.ts`), the same
category as Ray's own friendship keepsakes and the Pixel Pilgrim's relics. A
turn-in never credits Gold. `stackacres-service.ts` pins Gold to four credit
sites and this is not a fifth.

## Where it lives

```
lib/stackacres/story/
  travelers.ts     the cast: name, district, unlock, reward
  items.ts         the traveler keepsakes
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
| soil-placed | place-soil-tile |
| contract-fulfilled | fulfill-contract |
| enchantment-forged | forge-enchantment |
| crossbreed-harvested | harvest-crossbreed |

The client's scene, dialogue bubble (`stackacres-story-dialogue.tsx`), and art
are all live. The Pixel Pilgrim, the farmhand, and Ray/Pierre/Ivy's own
friendship system (`lib/stackacres/friendship.ts`) are separate systems and
stay as they are.

## Recent extensions

Five independent gaps against a general-purpose "modular quest system" design
were closed after watching a devlog on the subject. Each ships as its own
branch/PR; check `git branch -a` for what has actually merged before
assuming any of this is live.

### Per-quest reward choice (`feat/stackacres-quest-reward-choice`)

Until now only a traveler's *last* quest granted anything
(`TravelerDef.reward`, one fixed item). `StoryQuest` gained an optional
`rewards?: readonly StoryItemId[]`: any quest can grant a reward at its own
turn-in, and 2+ options mean the player picks one (extra buttons on the same
turn-in bubble, no new modal). Brayden's Iron Tools (`brayden.q1`) is the
first quest to use it, offering a `cubic_pickaxe_head` or a
`sample_bag_of_curved_ore`. `TurnInResult.granted` changed shape from a
nullable single item to an array (0, 1, or 2 — 2 only on a line's last quest
that also declares its own `rewards`).

### Go-to-location objective (`feat/stackacres-quest-reach-place`)

A new objective kind, `reach-place`, tied to a small set of named spots
(`lib/stackacres/story/places.ts`'s `QUEST_PLACE_IDS`, starting with
`ray_porch`) — a deliberately separate id space from `../secrets.ts`'s
`HiddenZoneId`, since a hidden zone rolls a probabilistic once-a-day
discovery chance and a quest objective has to be deterministically
completable. A new `reach-quest-place` action mirrors `tap-secret-zone`
exactly (client reports an id, server trusts it, no position tracking), minus
the roll and the daily throttle.

### Checkpointed quest segments (`feat/stackacres-quest-segments`)

`StoryQuest` gained an optional `segments?: readonly StoryQuestSegment[]` —
an alternate, additive shape. Every existing quest still uses the flat
`objectives` list, checked all at once with one shared progress line. A
segmented quest instead has ordered checkpoints, each with its own objectives
and its own dialogue line, auto-advancing the moment a checkpoint's
objectives are satisfied; only the final checkpoint needs an explicit turn-in
tap. No live quest uses this yet — the mechanism shipped proven by a
synthetic test fixture. Converting a real quest (likely pairing this with
`reach-place`) is a follow-up once this has been observed live.

### Per-quest start requirements (`feat/stackacres-quest-requirements`)

`StoryQuest` gained an optional `requires?: readonly QuestRequirement[]`:
`{kind: "friendship", npc, points}` (only legal for an NPC in
`FRIENDSHIP_NPCS` — today Ray, Pierre, Ivy) or `{kind: "traveler-done",
traveler}`. Derived, never stored, re-checked continuously (not just at
accept time) — same "derived, not stored" posture `unlocks.ts` already takes
for a traveler's line-level unlock. Ray's First Order (`ray.q4`) is gated
behind 9 friendship points with him (his first ladder rung), openable for
free by greeting him along the way; nothing on the farm waits on his line
finishing, so this only delays his keepsake, never blocks farm progress.

### World-visual layer (`feat/stackacres-quest-visual-state`)

A small, pure, tested module (`lib/stackacres/story/visual-state.ts`)
deriving one of four stages — `absent`, `arrived`, `under-way`, `home` — from
a traveler's story progress, following the same pure-derivation contract
`../sectors.ts`'s `sectorOvergrowth` already commits to for a district's wild
growth. No renderer wiring in this pass: the live scene's actual prop/painter
setup needs checking fresh (it has drifted across worktrees) before picking
a concrete prop/variant pair to swap. That's a follow-up, and no new art is
required for it — the plan is to toggle between two prop kinds the renderer
already paints.
