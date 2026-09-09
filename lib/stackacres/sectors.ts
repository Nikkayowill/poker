/**
 * Land you do not own yet, and what it costs to take it on.
 *
 * A SECTOR is a district (./zones.ts's `ZoneId`) seen through one extra
 * question: has this player cleared it? Same places, same bounds, same
 * labels -- there is no second map here, and `SectorId` is deliberately
 * `ZoneId` itself rather than a parallel id space that could drift out of
 * step with it. What this module adds is the ladder: the Farmstead is home
 * and is never locked, and the outer ones are wild ground until Gold and a
 * bit of farming clear them.
 *
 * WHY THE CROP FIELDS ARE NOT HERE ANY MORE. They were, as `meadow`, until
 * the 2026-09-08 map restructure merged that district into the Farmstead
 * (see ./zones.ts's own header). `SectorId = ZoneId` is exactly why they
 * could not stay a sector once that happened: the Farmstead is a HOME
 * sector, permanently unlocked, and a district cannot be both free to walk
 * into and gated behind 15,000 Gold at the same time. Their own gate moved
 * to ./crop-fields.ts instead -- same cost, same requirement, a standalone
 * flag rather than a row in this ladder.
 *
 * THE VISUAL CONTRACT, and the reason `sectorOvergrowth` lives here rather
 * than in the scene: a locked sector must look like SOMEWHERE, not like a
 * disabled control. No greyed-out pens, no dashed outlines, no padlock
 * hovering over an empty field. The pens and fields are simply not built
 * yet, so there is nothing there to grey out -- what stands there instead is
 * wild growth, and the only way to find out it is claimable at all is to tap
 * it. `stackacres-scene.ts` paints exactly what this function deals and
 * nothing else; when a sector is cleared, the growth is destroyed and the
 * district's own ground, fence and grow area take its place.
 *
 * UNLOCKS ARE DERIVED, NOT JUST STORED. `unlockedSectors` takes the cleared
 * list AND the player's units, and treats owning stock in a district as
 * proof that district is yours. That is what makes this safe to ship on a
 * live farm: every player who already keeps cattle at Ox Fields keeps them,
 * with no backfill migration to get right and nothing to strand behind a
 * gate that did not exist when they bought it. It is also self-healing --
 * a lost `homestead_sectors` row cannot cost somebody land they visibly own.
 *
 * Everything here is pure. The server decides (see
 * lib/server/stackacres-service.ts's `clearStackAcresSector`), the client
 * renders the same functions so the modal and the refusal can never word the
 * requirements differently.
 */

import { STACKACRES_STOCK, capFor, type StackAcresStock } from "./catalogue";
import { nearPath } from "./paths";
import type { StackAcresUnitSnapshot } from "./units";
import { seededRandom, stockZone, type SceneryKind, type WorldRect } from "./world";
import { STACKACRES_ZONES, type ZoneId } from "./zones";
// A strict leaf (imports nothing), so a plain value import with no cycle to
// work around. The Crop Fields' own ground, for `cropFieldOvergrowth`.
import { CROP_FIELD } from "./yard";

/** A sector IS a district. See the file header on why this is an alias and
 *  not a parallel id space. */
export type SectorId = ZoneId;

/**
 * What kind of ground a sector is. Three states, not two, since the
 * 2026-09-07 map re-lay.
 *
 *   home       never locked, yours from the first second
 *   claimable  under growth, on the ladder, buyable with Gold
 *   wild       under growth and NOT for sale, because there is nothing under
 *              it yet
 *
 * The third one is new, and it exists to stop a lie. A locked sector's modal
 * offers to clear the land for Gold and promises what appears when you do. The
 * re-lay reserved ground for four places whose systems do not exist (Town
 * Square, the Mine, the Coastal Market, the Ancestral Oak) so that building
 * them later does not shift the rest of the map -- and selling somebody Town
 * Square today would take real Gold for an empty field. A wild sector
 * therefore looks exactly like a claimable one from outside (same overgrowth,
 * same tap) and says what is coming instead of naming a price.
 */
export type SectorState = "home" | "claimable" | "wild";

/**
 * The sectors that are never locked.
 *
 * Home base has to be free, and not out of generosity: the Hen Coops are the
 * only stock a new farm can afford, the starting Bushel grant is sized
 * against them, and a farm whose every district is behind a Gold wall has no
 * first move at all.
 *
 * TWO of them since the re-lay, not one. The hens moved out of the Farmstead
 * into Hen Haven (see `STOCK_ZONE` in ./world.ts), so gating Hen Haven would
 * put that exact wall straight back up: a new farm would own a house with
 * nowhere to keep the one animal it can pay for.
 */
export const HOME_SECTORS: readonly SectorId[] = ["farmstead", "henhaven"];

/** The sector a farm is standing on before it does anything. Kept as its own
 *  constant, separate from `HOME_SECTORS`, because plenty of call sites mean
 *  "where you start" rather than "every free sector": a new farm's `sectors`
 *  list, the simulation's fixtures, the upkeep floor. */
export const HOME_SECTOR: SectorId = "farmstead";

/**
 * Ground the re-lay reserved with no system under it yet. Never unlockable by
 * any route -- not by Gold, not by an explicitly cleared row, not by owning
 * stock there (no stock kind maps to one). See `SectorState`.
 */
export const WILD_SECTORS: readonly SectorId[] = ["townsquare", "mine", "coast", "oak"];

/**
 * The order the outer sectors are cleared in.
 *
 * NOT `zonesByDistance`'s order, and the difference is deliberate. The
 * signpost lists districts by how far the walk is, because that is what a
 * signpost is for. This ladder is a progression through STOCK TIERS --
 * sheep, then cattle -- because what a player is really buying is access to
 * the next thing worth keeping, and the walk to it is beside the point.
 *
 * TWO RUNGS, NOT THREE, since the 2026-09-08 map restructure. Crops used to
 * be the first rung here (`meadow`, 15,000 Gold, unlocked before the Fold);
 * they still cost the same 15,000 Gold and still need to be unlocked before
 * anything grows, but the district they lived in merged into the Farmstead
 * (a HOME sector, never locked -- see ./zones.ts's own header on the merge),
 * so that gate could not stay a SECTOR clear. It is its own standalone flag
 * now -- see ./crop-fields.ts -- decoupled from this ladder entirely.
 * `wallow` no longer names a `requires` sector because of it: nothing left
 * in `SECTOR_IDS` is what used to come before it.
 */
export const SECTOR_LADDER: readonly SectorId[] = ["wallow", "oxfields"];

export const SECTOR_IDS: readonly SectorId[] = [
  ...HOME_SECTORS,
  ...SECTOR_LADDER,
  ...WILD_SECTORS,
];

export interface SectorDef {
  id: SectorId;
  /** Which of the three kinds of ground this is. The one field that decides
   *  whether the modal names a price or says "not yet". */
  state: SectorState;
  /** Gold to clear it, once, forever. 0 for the Farmstead, which is home. */
  clearCost: number;
  /** The sector that has to be cleared first, or null for the first rung.
   *  Null on the Farmstead too, which is never locked to begin with. */
  requires: SectorId | null;
  /**
   * Units the player must have standing anywhere before this land is offered.
   *
   * A Gold price alone would let somebody with a poker balance and no farm
   * buy every acre on day one and then look at three empty districts. This is
   * the "you have actually farmed" half of the requirement, and it is checked
   * against units owned rather than lifetime harvests so it reads off the
   * same list the rest of the screen already has -- no extra query, and the
   * player can see the number going up.
   */
  requiresUnits: number;
  /** What the clearing modal says is under the growth. One line. */
  promise: string;
}

/**
 * The ladder.
 *
 * PRICES. The old plot grid charged 10,000 Gold a tile for twelve tiles --
 * 120,000 for the whole map -- and that total is the anchor these are sized
 * against, not a fresh guess: land should still cost about what land cost.
 * They rise steeply because each rung opens a stock tier worth several times
 * the last (a Cattle Pen yields 880 Bushels a cycle against a Sprout Row's
 * 18), so a flat price per sector would make the last one a giveaway.
 *
 * None of this moves Gold in the paying direction -- clearing land is a pure
 * SINK, the same category as buying capacity. See the asymmetry note at the
 * top of lib/server/stackacres-service.ts: adding a path that spends Gold is
 * safe, adding one that pays it is the thing to stop over.
 */
export const STACKACRES_SECTORS: Readonly<Record<SectorId, SectorDef>> = {
  farmstead: {
    id: "farmstead",
    state: "home",
    clearCost: 0,
    requires: null,
    requiresUnits: 0,
    promise: "Home. The barn, the pond and the yard.",
  },
  // Free alongside the Farmstead -- see `HOME_SECTORS`.
  henhaven: {
    id: "henhaven",
    state: "home",
    clearCost: 0,
    requires: null,
    requiresUnits: 0,
    promise: "Yours already. Every Hen Coop you keep stands here.",
  },
  wallow: {
    id: "wallow",
    state: "claimable",
    clearCost: 45_000,
    // Used to be "meadow" -- see `SECTOR_LADDER`'s own header on why the
    // Crop Fields' unlock is no longer a sector this can chain off.
    requires: null,
    requiresUnits: 4,
    promise: "Cleared, this becomes your Sheep Pens.",
  },
  oxfields: {
    id: "oxfields",
    state: "claimable",
    clearCost: 100_000,
    requires: "wallow",
    requiresUnits: 6,
    promise: "Cleared, this becomes your Cattle Pens — the best-paying stock on the farm.",
  },

  // The four the map re-lay reserved. `clearCost: 0` is not a free sector: a
  // wild sector is refused before a price is ever read, by `sectorClearCheck`
  // here and by `clearStackAcresSector` on the server. The zero is there so a
  // stray render can only ever show nothing, never a real number somebody
  // might try to pay. `promise` is what is coming, worded as a promise rather
  // than an offer.
  townsquare: {
    id: "townsquare",
    state: "wild",
    clearCost: 0,
    requires: null,
    requiresUnits: 0,
    promise: "One day: the town itself, instead of a board you post to.",
  },
  mine: {
    id: "mine",
    state: "wild",
    clearCost: 0,
    requires: null,
    requiresUnits: 0,
    promise: "One day: a way down, and whatever is under the hill.",
  },
  coast: {
    id: "coast",
    state: "wild",
    clearCost: 0,
    requires: null,
    requiresUnits: 0,
    promise: "One day: market stalls on the shore, and a dock to work from.",
  },
  oak: {
    id: "oak",
    state: "wild",
    clearCost: 0,
    requires: null,
    requiresUnits: 0,
    promise: "One day: whatever the old tree has been waiting for.",
  },
};

/** Whether this ground is reserved with nothing under it yet. The one check
 *  every caller that could otherwise offer to sell it must make first. */
export function isWildSector(id: SectorId): boolean {
  return STACKACRES_SECTORS[id].state === "wild";
}

/** What the player calls a sector. Straight off the district, so the modal,
 *  the signpost and the arrival banner can never disagree. */
export function sectorLabel(id: SectorId): string {
  return STACKACRES_ZONES[id].label;
}

/**
 * Every sector this player may work, from what has been cleared and what they
 * already own.
 *
 * Three sources, unioned: home is always in, anything explicitly cleared is
 * in, and any district holding a unit is in. That last clause is the whole
 * live-farm story -- see the file header. Returned in `SECTOR_IDS` order so
 * the result is stable enough to compare and to render.
 */
export function unlockedSectors(
  cleared: readonly SectorId[],
  units: readonly Pick<StackAcresUnitSnapshot, "stock">[],
): SectorId[] {
  const open = new Set<SectorId>([...HOME_SECTORS, ...cleared]);
  for (const unit of units) open.add(stockZone(unit.stock));
  // A wild sector can never be open, whatever a row says. `homestead_sectors`
  // is player-writable through one guarded RPC, and the guard is here as well
  // as there so a legacy or hand-inserted row cannot hand somebody ground that
  // has nothing on it.
  return SECTOR_IDS.filter((id) => open.has(id) && !isWildSector(id));
}

export function isSectorUnlocked(id: SectorId, unlocked: readonly SectorId[]): boolean {
  return unlocked.includes(id);
}

/** The sectors still under growth. What the scene paints wild. */
export function lockedSectors(unlocked: readonly SectorId[]): SectorId[] {
  return SECTOR_IDS.filter((id) => !unlocked.includes(id));
}

/* ------------------------------------------------------------------ */
/* Clearing                                                            */
/* ------------------------------------------------------------------ */

/** One line of the modal's checklist: what is being asked, and whether this
 *  farm has it yet. */
export interface SectorRequirement {
  /** Written for the player, not for a log. */
  label: string;
  met: boolean;
}

export interface SectorClearCheck {
  id: SectorId;
  /** Gold. Shown whether or not the requirements are met -- a player deciding
   *  whether to save up needs the number before they qualify for it. */
  cost: number;
  /** True once every requirement below is met. Says nothing about Gold: the
   *  balance is the server's to judge, the same posture every other Gold
   *  spend in this app takes (see district-panel.ts's header). */
  ok: boolean;
  requirements: SectorRequirement[];
  /** Set when there is nothing to clear -- already yours, or home. */
  alreadyOpen: boolean;
  /** Set when this is reserved ground with no system under it. `ok` is false
   *  and `cost` is 0; the modal shows `promise` and no price. */
  wild: boolean;
}

/**
 * Whether this land can be taken on right now, and what is missing if not.
 *
 * ONE FUNCTION, TWO SURFACES. The clearing modal renders this straight, and
 * the server calls it before a single piece of Gold moves. That is why the
 * refusal wording lives on the requirement rather than in either caller: a
 * modal that promises something the route then refuses is the failure mode
 * this shape exists to make impossible.
 */
export function sectorClearCheck(
  id: SectorId,
  context: { unlocked: readonly SectorId[]; unitCount: number },
): SectorClearCheck {
  const def = STACKACRES_SECTORS[id];
  // Checked before `alreadyOpen`, and before the price is read at all: wild
  // ground is never open and never for sale, so neither branch below applies.
  if (def.state === "wild") {
    return { id, cost: 0, ok: false, requirements: [], alreadyOpen: false, wild: true };
  }
  if (isSectorUnlocked(id, context.unlocked)) {
    return { id, cost: def.clearCost, ok: false, requirements: [], alreadyOpen: true, wild: false };
  }

  const requirements: SectorRequirement[] = [];
  if (def.requires) {
    requirements.push({
      label: `Clear ${sectorLabel(def.requires)} first`,
      met: isSectorUnlocked(def.requires, context.unlocked),
    });
  }
  if (def.requiresUnits > 0) {
    requirements.push({
      label: `Keep ${def.requiresUnits} crops or animals going (you have ${context.unitCount})`,
      met: context.unitCount >= def.requiresUnits,
    });
  }

  return {
    id,
    cost: def.clearCost,
    ok: requirements.every((requirement) => requirement.met),
    requirements,
    alreadyOpen: false,
    wild: false,
  };
}

/* ------------------------------------------------------------------ */
/* Land maintenance                                                    */
/* ------------------------------------------------------------------ */

/**
 * A "plot", now that there is no plot grid: one slot a crop or an animal can
 * stand in.
 *
 * The 2026-09-03 pass deleted the sixteen-tile ladder outright, so the thing
 * a player actually accumulates is CAPACITY -- three free slots per stock
 * kind, up to three more each bought with Gold. A slot is what land used to
 * be, so a slot is what the land fee is charged on. Only slots on cleared
 * ground count: a Cattle Pen slot at Ox Fields costs nothing while Ox Fields
 * is still a wood.
 *
 * CROPS NEED A SECOND CHECK, since the 2026-09-08 district merge. Every crop
 * kind is zoned to `farmstead`, a HOME sector that is unconditionally
 * "unlocked" -- so `isSectorUnlocked` alone would count all 22 crop kinds'
 * slots against a brand-new farm that has never spent the 15,000 Gold to
 * unlock the Crop Fields at all (see ./crop-fields.ts). `cropFieldsUnlocked`
 * is the second gate that keeps a fresh account's free base at the Hen
 * Coop's three slots and nothing more, the same shape it held back when the
 * Crop Fields were still their own locked sector.
 */
export function unlockedPlotCount(
  unlocked: readonly SectorId[],
  capacity: Readonly<Partial<Record<StackAcresStock, number>>>,
  cropFieldsUnlocked: boolean,
): number {
  return STACKACRES_STOCK.reduce((total, stock) => {
    const zone = stockZone(stock);
    if (!isSectorUnlocked(zone, unlocked)) return total;
    if (zone === "farmstead" && !cropFieldsUnlocked) return total;
    return total + capFor(capacity[stock] ?? 0);
  }, 0);
}

/**
 * THE LAND FEE USED TO LIVE HERE, in Bushels. It moved to ./upkeep.ts when the
 * farm went single-currency, and it kept the two things this pass got right --
 * the charge base is still slots on cleared ground (`unlockedPlotCount`,
 * above) and the first three plots are still free. What changed is the
 * denomination and, more importantly, the SHAPE: the fee is netted out of what
 * a harvest pays and clamped at it, rather than debited from a balance, which
 * is what answers this file's own original objection to a Gold-denominated
 * upkeep.
 */

/* ------------------------------------------------------------------ */
/* What stands on land nobody has cleared                              */
/* ------------------------------------------------------------------ */

/** One piece of wild growth on locked ground. Same `SceneryKind` the open
 *  world's own woodland uses, so the scene draws it with painters that
 *  already exist rather than a second art set for "locked". */
export interface OvergrowthItem {
  kind: SceneryKind;
  /** World units, absolute. */
  x: number;
  y: number;
  /** Against the painter's own drawn size, the same contract
   *  `SceneryItem.scale` has. */
  scale: number;
}

/**
 * How far apart the growth's planting points sit.
 *
 * Tighter than the woodland's own `FOREST_SPACING` (44) on purpose. This is
 * not a wood the farm was cut out of, it is ground that has been left, and
 * the read has to be "nothing has been done here in years" at a glance --
 * loose enough and it just looks like the ordinary countryside the player has
 * been panning across all along, which would make the sector invisible rather
 * than inviting.
 */
const OVERGROWTH_SPACING = 30;

/** The mix. Trees carry the silhouette, scrub fills between them, and the
 *  ground layer is what stops the gaps reading as mown lawn. */
const OVERGROWTH_CANOPY: readonly SceneryKind[] = [
  "tree1",
  "tree2",
  "tree3",
  "pine",
  "pine2",
  "pine3",
  "pine5",
  "pine6",
  "pine8",
];
// Weighted toward the leggy, unkempt plates rather than the tidy round bush:
// a locked sector has to read as "nothing has been done here in years", and
// `scrubPlume`/`scrubLeafy` are the two that look most like they got away.
const OVERGROWTH_SCRUB: readonly SceneryKind[] = [
  "bush",
  "bush2",
  "bush3",
  "scrubPlume",
  "scrubPlume",
  "scrubLeafy",
  "scrubThicket",
  "scrubThicket",
  "scrubMound",
  "scrubBristle",
  "log",
  "boulder",
  "rock",
];
const OVERGROWTH_FLOOR: readonly SceneryKind[] = [
  "tuft",
  "tuft",
  "tuft2",
  "weed3",
  "weed5",
  "weed6",
  "frond2",
  "frond5",
  "flower1",
  "flower2",
  "flower3",
  "mushroom",
];

/**
 * A pale wash laid over a locked sector, under everything standing in it.
 *
 * The third of the three cues the brief asks for (growth, trees, light fog),
 * and the one doing the least work on purpose: it is a haze that says "far
 * off, not yours yet", not a scrim that says "disabled". Anything heavier
 * turns the sector grey, which is exactly the treatment this whole approach
 * exists to avoid -- so it is barely there, and the growth is what actually
 * reads.
 */
export const SECTOR_FOG = { colour: 0xcfe3ec, alpha: 0.16 } as const;

/**
 * Everything growing on one locked sector, dealt once for its whole extent
 * rather than per chunk.
 *
 * Per-chunk would match how the woodland is grown (`chunkScenery`) and would
 * be wrong here for two reasons. A sector is a fixed, bounded rectangle a few
 * hundred units across -- there is no unbounded plane to stream -- and its
 * growth has to be destroyed in one go the moment the land is cleared, which
 * a chunk lifecycle would fight. A few hundred sprites is well inside what
 * this scene already carries, and Phaser culls whatever is off camera.
 *
 * Deterministic by sector id and bounds, so a player who pans away and back
 * finds the same trees. Roads are left alone (`nearPath`): the lane south and
 * the road east both run straight through locked ground, and a wood grown
 * over the road would break the one promise the map makes about where you
 * can go.
 */
export function sectorOvergrowth(id: SectorId): OvergrowthItem[] {
  return overgrowthOver(STACKACRES_ZONES[id].bounds, id.length);
}

/**
 * The Crop Fields' own locked overgrowth -- everything `sectorOvergrowth`
 * says above, minus having a `SectorId` to read bounds off of. The Crop
 * Fields stopped being a district (and so a sector) in the 2026-09-08 map
 * restructure's merge into the Farmstead; their own gate is a standalone
 * flag now (./crop-fields.ts). Same contract as `sectorOvergrowth`: call
 * this only while the flag is false, the same way callers only call
 * `sectorOvergrowth` for a sector that is not yet unlocked.
 */
export function cropFieldOvergrowth(): OvergrowthItem[] {
  return overgrowthOver(CROP_FIELD, "cropfields".length);
}

/** The shared generator both `sectorOvergrowth` and `cropFieldOvergrowth`
 *  deal from -- one rectangle of wild growth, seeded by its own bounds and a
 *  caller-supplied salt so two rects the same size and position (which never
 *  actually happens on this map, but costs nothing to guard) still differ. */
function overgrowthOver(bounds: WorldRect, salt: number): OvergrowthItem[] {
  const random = seededRandom(
    (Math.round(bounds.x) * 374761393) ^ (Math.round(bounds.y) * 668265263) ^ (salt * 0x9e3779b1),
  );
  const items: OvergrowthItem[] = [];
  const cols = Math.max(1, Math.ceil(bounds.width / OVERGROWTH_SPACING));
  const rows = Math.max(1, Math.ceil(bounds.height / OVERGROWTH_SPACING));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      // A jittered lattice rather than uniform random points, the same reason
      // `chunkScenery` uses one: at this density uniform points clump and
      // leave bald patches, and the gaps have to come from the mix rather
      // than from the sampling.
      const x = bounds.x + (col + 0.5) * OVERGROWTH_SPACING + (random() - 0.5) * OVERGROWTH_SPACING * 0.8;
      const y = bounds.y + (row + 0.5) * OVERGROWTH_SPACING + (random() - 0.5) * OVERGROWTH_SPACING * 0.8;
      const roll = random();
      const size = random();
      if (x < bounds.x || x > bounds.x + bounds.width) continue;
      if (y < bounds.y || y > bounds.y + bounds.height) continue;
      if (nearPath(x, y)) continue;

      if (roll < 0.34) {
        items.push({
          kind: OVERGROWTH_CANOPY[Math.floor(size * OVERGROWTH_CANOPY.length)],
          x,
          y,
          // The same wide height range the woodland's trees get, for the same
          // reason: a stand grown all at one size reads as wallpaper.
          scale: 0.78 + random() * 0.58,
        });
      } else if (roll < 0.62) {
        items.push({
          kind: OVERGROWTH_SCRUB[Math.floor(size * OVERGROWTH_SCRUB.length)],
          x,
          y,
          scale: 0.85 + random() * 0.4,
        });
      } else {
        items.push({
          kind: OVERGROWTH_FLOOR[Math.floor(size * OVERGROWTH_FLOOR.length)],
          x,
          y,
          scale: 0.9 + random() * 0.35,
        });
      }
    }
  }

  // Painter's order, north to south, so the scene can add them in one pass
  // and let the ordinary feet-based depth sort do the rest.
  return items.sort((a, b) => a.x + a.y - (b.x + b.y));
}
