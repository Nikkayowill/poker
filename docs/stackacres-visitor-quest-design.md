# StackAcres Visitor Quest & Automation System

Design doc for the 10 stranded-visitor NPCs (concept art already built, see
`public/stackacres/sprites/visitor-*.png`). This adapts the "pixel refugees
gate late-game automation" brief to the cast and economy that actually exist
in this codebase, rather than inventing new characters or fabricated systems.
Every reward named below is a real, already-shipped StackAcres system — the
Synergy Tree, the Mill/Dairy/Loom, the Sunlight Forge, Ray's Museum secret
wing, Irrigation, the Crossbreeding Bed, and the Friendship/keepsake track.
Nothing here requires a new database table. A few genuinely new mechanics are
flagged explicitly as **PROPOSED, NOT BUILT** — treat those as a menu to pick
from later, not a spec to implement blind.

The premise stays exactly what Kayo signed off on for the cast: these 10 are
interdimensional refugees whose home universes ran out of memory, stranded on
a farm made of smooth, high-fidelity vector art — and they know it. Every
greeting line below leans on that mismatch.

## Cast

| Visitor | Kind | Visual | District |
|---|---|---|---|
| Bleep | Hovering robot | one glowing eye, cracked star-map device | Farmstead |
| Glimm | Blob alien | squishy body, cracked dome visor, worried face | Oak (woods) |
| Nib | Astronaut scout | tiny, alien face through a cracked visor | Oak (woods) |
| Pixl | Crystal being | faceted, glowing amber core, one flickering point | Coast |
| Squee | Insectoid scout | six legs, curled antennae, compound eyes | Oak (woods) |
| Dott | Shelled quadruped | saucer dome shell, worried face peeking out | Coast |
| Mira | Human mechanic | teal jumpsuit, tool belt, goggles, wrench | Mine |
| Zeph | Human elder navigator | purple star-robe, glowing-orb staff | Townsquare |
| Kip | Human child | chibi, yellow puffy jacket, striped cap | Townsquare |
| Tavo | Human pilot | burnt-orange flight suit, cracked helmet | Mine |

## 3-Act structure

### Act 1 — Manual to Mechanical (Farmstead)
**Arrival:** Bleep crash-lands by the windmill, half-dead, one eye flickering.
He's the tech gate: fixing him is the player's introduction to the idea that
a visitor is a *system*, not a shopkeeper. His reward track points at the
**Sunlight Forge** (permanent tool enchantments) and unlocking the second
Synergy archetype slot — the mechanical bridge before biology/scale show up.

### Act 2 — The Interlocking Network (Oak woods, Coast)
**Arrival:** five biological/alien anomalies, already hiding when the player
finds them — Glimm, Nib, Squee (Oak woods) and Pixl, Dott (Coast). None of
them trust the player alone; each needs something the *others* produce.
Materials loop between them (crossbreed items, forge-grade crops, processed
goods) so progress on one visitor stalls without progress on a neighbor. This
is the interlocking-dependency web the brief asks for, built from the
Crossbreeding Bed's existing byproducts (`golden_maize`, `sunroot_egg`,
`candied_husk`, `marbled_down`, `tallow_wool`, `custard_curd`) plus Mill/
Dairy/Loom goods.

### Act 3 — Hyper-Efficient Homestead (Mine, Townsquare)
**Arrival:** the futuristic humans — Mira and Tavo deep in the Mine, Zeph and
Kip make it as far as Townsquare. This act's reward is the Synergy Tree's
**third slot** and the top rung of the Friendship ladder for each of them —
"permanently anchoring their data to the smooth world" is, mechanically, each
of them putting down roots (a keepsake, a standing presence) rather than
staying a rescue-in-progress.

## Character frameworks

### Bleep — the Tech Gate
- **Visual profile:** small hovering robot, one cracked glowing eye, clutches
  a dead star-map device against his chassis.
- **Greeting (art-style shock):** *"BZZT—new biosignature. You're not
  pixelated. Are you... smooth? My scanners don't know what to do with you."*
- **Upgrades:** Sunlight Forge enchant slots (`lib/stackacres/forge.ts`) and
  the 2nd Synergy archetype unlock slot.

### Glimm, Nib, Squee, Pixl, Dott — the Biological Gate
Treated as one interlocking quest cluster rather than five separate gates —
see the pipeline below for how they hand off to each other.
- **Glimm** (blob, cracked visor): *"Oh! Oh no, you can see me? I've been
  hiding so well. ...wait, why do you look so clean-edged? Are YOU the
  glitch here?"*
- **Nib** (astronaut scout): *"Reporting... nothing. Ship's gone. Squad's
  gone. But your farm has really good anti-aliasing, for what it's worth."*
- **Squee** (insectoid): *"*click click* You register as... whole? I only
  render in blocks. This is either a compliment to you or an insult to me."*
- **Pixl** (crystal being): *"My facets keep catching light your world
  doesn't seem to make. I flicker. You don't. I find that deeply rude,
  somehow."*
- **Dott** (shelled quadruped): *"I peeked out of my shell for the first
  time in days and the grass has MORE PIXELS than me. I don't know how to
  feel about that."*
- **Upgrades:** the Crossbreeding Bed's yield odds, Ray's Museum secret wing
  (a themed exhibit slot), Irrigation pipe reach.

### Mira, Tavo — the Scale Gate (Mine)
- **Mira** (mechanic): *"Huh. Smooth gradients. Where I'm from, a sunset
  like that would melt my graphics card. Mind if I set up shop near your
  tools?"*
- **Tavo** (pilot): *"Crashed my ship somewhere past that ridge. Helmet's
  cracked, pride's cracked worse. At least the landing was soft. Softer than
  me, actually."*
- **Upgrades:** Automated Logistics (farmhand speed) and High-Yield
  Processing (Mill double-output) — the two Synergy perks that are
  literally named "automation" already.

### Zeph, Kip — the Anchor (Townsquare)
- **Zeph** (elder navigator): *"Every star I ever charted looked like this
  world does. Sharp. Certain. I have not looked like that in a long while,
  child."*
- **Kip** (child): *"Whoa you're not BLOCKY! Are you a boss? Do bosses live
  on farms? Can I pet the cow, is the cow blocky too?"*
- **Upgrades:** 3rd Synergy archetype slot, top Friendship ladder keepsakes
  for the whole cast (Zeph and Kip are the ones who convince the other eight
  to stay for good).

## Gated quest pipeline

All "inputs" are real items from `lib/stackacres/items.ts`,
`machine-items.ts`, or `crossbreed-items.ts`. All "rewards" are real unlocks.

| # | Quest (Act) | Giver & dependency lock | Motivation | Inputs | Reward | Key dialogue beats |
|---|---|---|---|---|---|---|
| 1 | Reboot Bleep (1) | Bleep, no lock — first contact | His last charge is going; he needs raw calories, not tech, to reboot | 10× any Tier-1 crop (garlic/onion/beet/poppy/potato/carrot/cabbage) | Unlocks Bleep as a standing NPC + Forge enchant slot 1 | Accept: *"Feed the eye. I know how that sounds."* / Empty: *"Still one eye. Still dim. Still hungry."* / Done: *"Charge holding. First good news in a very blocky while."* |
| 2 | Bleep's Diagnostic (1) | Bleep, locked until #1 | He can scan the farm now, but the scan itself needs Flour to run — cheap, but processed | 5× Flour (Mill) | Unlocks 2nd Synergy archetype slot | Accept: *"Run me through the mill's own math and I can read your whole farm."* / Empty: *"No Flour, no diagnostic. I can wait. I'm good at waiting, it turns out."* / Done: *"Diagnostic clean. You have more headroom than you think — go find it."* |
| 3 | Glimm Won't Come Out (2) | Glimm, locked until Bleep's Diagnostic (his scan is what finds her) | She only trusts something that took real effort to make, not raw produce | 3× Cloth (Loom) | Opens her dialogue for good, +1 Museum secret-wing roll chance | Accept: *"...you found me because a ROBOT told you where to look? Fine. FINE. Bring me something that isn't just... grown."* / Empty: *"Still just grass and dirt out there? I can wait longer than you can grow."* / Done: *"Woven. Actually made. Okay. Okay, you're alright."* |
| 4 | Squee's Trade (2) | Squee, locked until Glimm Won't Come Out | Squee wants what Glimm has now (Cloth) to line a nest — sibling handoff, the interlock in action | 2× Cloth + 3× Cheese (Dairy) | Unlocks Crossbreeding Bed yield-odds bump | Accept: *"*click* She has the woven thing. I want the woven thing. Bring two. And something dairy, don't ask why."* / Empty: *"*click click* (disappointed clicking)"* / Done: *"*happy click* Nest complete. You are now nest-approved."* |
| 5 | Nib's Star-Chart (2) | Nib, locked until Squee's Trade | Nib needs a Crossbreed item (a farm-grown oddity) as a substitute component for his dead scanner | 1× Golden Maize (crossbreed) | Unlocks Irrigation pipe +1 reach | Accept: *"My scanner needs a power crystal. You don't have one. You have... this weird corn. It might work."* / Empty: *"Still just ordinary corn out there? Keep looking."* / Done: *"It's reading. Barely. But it's reading. I might find my way home yet."* |
| 6 | Pixl and Dott's Standoff (2) | Pixl + Dott together, locked until Nib's Star-Chart | Pixl's light-flicker and Dott's shell-crack are the same kind of damage; fixing one needs the other's material | 1× Sunroot Egg + 1× Candied Husk (crossbreed) | Opens both permanently, +2 Museum secret-wing roll chance | Accept (Pixl): *"Dott says the egg stops the flicker. Dott is probably wrong. Bring it anyway."* / Accept (Dott): *"Pixl says the husk seals a shell. Pixl is probably wrong too. But bring it."* / Done: *"...huh. We were both right for once."* |
| 7 | Mira's Toolkit (3) | Mira, locked until the full Oak/Coast cluster (quests 3–6) is done | She won't set up in the Mine until the surface visitors are safe — she's the second wave, not the first | 5× Flour + 5× Cheese + 5× Cloth | Unlocks Automated Logistics perk purchase | Accept: *"Get your surface friends settled first. Then we'll talk tools."* / Empty: *"Still nothing processed coming out of that mill of yours? I can't work with raw."* / Done: *"Wrench fits. Belt's stocked. Let's automate something."* |
| 8 | Tavo's Wreck (3) | Tavo, locked until Mira's Toolkit | His ship's black box needs Mira's tools to crack open — direct hand-off between the two humans | 3× Flour + 3× Cheese + 3× Cloth (Mira's toolkit, spent again) | Unlocks High-Yield Processing perk purchase | Accept: *"Mira's got the tools now. I've got the wreck. Bring me the same stack she used."* / Empty: *"Box is still sealed. So is my mood."* / Done: *"Cracked it. Whole flight log. Whole crash. Not fun to relive, but — thank you."* |
| 9 | Zeph's Reading (3) | Zeph, locked until Tavo's Wreck (the black box gives him the coordinates he needs) | He needs the flight log's data plus a physical offering — the last quest that still costs anything | 10× any Tier-3 crop + 5× Cloth | Unlocks 3rd Synergy archetype slot | Accept: *"Tavo's log has numbers. I need something grown to weigh against them — an old ritual, don't ask."* / Empty: *"The numbers still don't balance. Bring more."* / Done: *"They balance. For the first time since I landed, they balance."* |
| 10 | Kip Wants Everyone to Stay (3) | Kip, locked until Zeph's Reading | Not a material quest — a gift round to all 9 other visitors, closing the Friendship ladder for the whole cast at once | 1× any keepsake-eligible gift to each of the other 9 | Top Friendship ladder rung for all 10 visitors, permanent standing NPCs | Accept: *"If EVERYONE gets a present do you think they'll stay? Even Bleep? Even Zeph, he's kind of grumpy."* / Empty: *"You haven't given everyone something yet. I'm counting. I'm ALWAYS counting."* / Done: *"They're staying. They're actually staying. I did that. WE did that."* |

## PROPOSED, NOT BUILT — automation objects the brief names that don't exist yet

The brief specifically asks for sprinklers/drones/auto-harvesters as
unlockable blueprints. Those aren't real systems today — flagging them here
as options rather than building them speculatively:

- **Laser Sprinklers** — would need a new irrigation variant in
  `lib/stackacres/irrigation.ts` that auto-waters on a timer instead of
  requiring a pipe-network tap. Real scope: a new tile-state + a cron-like
  check, similar shape to the existing hunger/thirst clocks.
- **Drone Nodes** — `bakeDroneTexture` already exists in
  `stackacres-scene.ts` for wildlife defense; a *harvest* drone would be a
  new, separate mechanic (auto-collects ready units), not a reskin of that
  one. Real scope: bigger — would need its own settlement path under the
  one-faucet/one-ceiling rule every other payout follows.

Neither is needed for the 10-quest pipeline above; both are here only
because the original brief named them by name.
