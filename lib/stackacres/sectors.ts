/**
 * Land you do not own yet, and what it costs to take it on.
 *
 * A SECTOR is a district (./zones.ts's `ZoneId`) seen through one extra
 * question: has this player cleared it? Same four places, same bounds, same
 * labels -- there is no second map here, and `SectorId` is deliberately
 * `ZoneId` itself rather than a parallel id space that could drift out of
 * step with it. What this module adds is the ladder: the Farmstead is home
 * and is never locked, and the other three are wild ground until Gold and a
 * bit of farming clear them.
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

/** A sector IS a district. See the file header on why this is an alias and
 *  not a parallel id space. */
export type SectorId = ZoneId;

/**
 * The one sector that is never locked.
 *
 * Home base has to be free, and not out of generosity: the Hen Coops are the
 * only stock a new farm can afford, the starting Bushel grant is sized
 * against them, and a farm whose every district is behind a Gold wall has no
 * first move at all.
 */
export const HOME_SECTOR: SectorId = "farmstead";

/**
 * The order the three outer sectors are cleared in.
 *
 * NOT `zonesByDistance`'s order, and the difference is deliberate. The
 * signpost lists districts by how far the walk is, because that is what a
 * signpost is for. This ladder is a progression through STOCK TIERS -- crops,
 * then sheep, then cattle -- because what a player is really buying is access
 * to the next thing worth keeping, and the walk to it is beside the point.
 * So the Fold (farthest away, mid-tier animals) is cleared before Ox Fields
 * (nearer, and the most valuable animal in the game).
 */
export const SECTOR_LADDER: readonly SectorId[] = ["meadow", "wallow", "oxfields"];

export const SECTOR_IDS: readonly SectorId[] = [HOME_SECTOR, ...SECTOR_LADDER];

export interface SectorDef {
  id: SectorId;
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
    clearCost: 0,
    requires: null,
    requiresUnits: 0,
    promise: "Home. The barn, the pond and your Hen Coops.",
  },
  meadow: {
    id: "meadow",
    clearCost: 15_000,
    requires: null,
    // Two hens. Enough that somebody has run a cycle and collected it, low
    // enough that it is met on the first afternoon rather than farmed for.
    requiresUnits: 2,
    promise: "Cleared, this becomes your Crop Fields — Sprout Rows and Cash Crops.",
  },
  wallow: {
    id: "wallow",
    clearCost: 45_000,
    requires: "meadow",
    requiresUnits: 4,
    promise: "Cleared, this becomes your Sheep Pens.",
  },
  oxfields: {
    id: "oxfields",
    clearCost: 100_000,
    requires: "wallow",
    requiresUnits: 6,
    promise: "Cleared, this becomes your Cattle Pens — the best-paying stock on the farm.",
  },
};

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
  const open = new Set<SectorId>([HOME_SECTOR, ...cleared]);
  for (const unit of units) open.add(stockZone(unit.stock));
  return SECTOR_IDS.filter((id) => open.has(id));
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
  if (isSectorUnlocked(id, context.unlocked)) {
    return { id, cost: def.clearCost, ok: false, requirements: [], alreadyOpen: true };
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
 */
export function unlockedPlotCount(
  unlocked: readonly SectorId[],
  capacity: Readonly<Partial<Record<StackAcresStock, number>>>,
): number {
  return STACKACRES_STOCK.reduce(
    (total, stock) =>
      isSectorUnlocked(stockZone(stock), unlocked) ? total + capFor(capacity[stock] ?? 0) : total,
    0,
  );
}

/**
 * Plots that are free of the land fee. The Farmstead's own three Hen Coop
 * slots, exactly -- so a farm that has cleared nothing and bought nothing
 * never sees a bill at all, and the first charge is the first thing a player
 * chose to take on.
 */
export const STACKACRES_UPKEEP_FREE_PLOTS = 3;

/** Bushels for the first chargeable plot. Deliberately trivial: the fee is
 *  meant to be noticed at the top of the ladder, not to tax a second Hen
 *  Coop into being a bad idea. */
export const STACKACRES_UPKEEP_BASE = 8;

/**
 * How fast the fee compounds per extra plot.
 *
 * This is the number the whole mechanic lives or dies on, so the arithmetic
 * is written down rather than left to be rediscovered. At 1.2:
 *
 *   4 plots  (one slot past the free base)      8 Bushels a day
 *   15 plots (all four sectors, nothing bought) 59
 *   21 plots                                    178
 *   30 plots (every sector, every slot bought)  916
 *
 * Against that, a fully built farm collected attentively grosses a few
 * thousand Bushels a day, and the exchange window will only ever take 7,500
 * of them out. So the top of the ladder costs a real, visible slice of a big
 * farm's day and nothing a small one would notice -- which is the point: the
 * fee exists so that owning everything is a commitment rather than a
 * one-way ratchet, not so that it is unaffordable.
 *
 * Raising this is a retune of the whole late game. sectors.test.ts pins the
 * shape (rising, exponential, zero at the free base) rather than the exact
 * figures, so a deliberate retune moves cleanly and an accidental sign flip
 * does not.
 */
export const STACKACRES_UPKEEP_GROWTH = 1.2;

/**
 * The day's land maintenance, in BUSHELS, for a farm of this many plots.
 *
 * Bushels, not Gold, and that is not a detail: the farm's own currency never
 * leaves the StackAcres, so a mistake in this curve costs a save state rather
 * than money. A Gold-denominated upkeep would be the first thing in this
 * subsystem that takes real value out of a player's balance on a timer, which
 * is a category nobody asked for.
 */
export function landUpkeepDue(plots: number): number {
  const chargeable = Math.floor(plots) - STACKACRES_UPKEEP_FREE_PLOTS;
  if (chargeable <= 0) return 0;
  return Math.round(STACKACRES_UPKEEP_BASE * STACKACRES_UPKEEP_GROWTH ** (chargeable - 1));
}

/** Today's land bill, as the client renders it. */
export interface StackAcresUpkeepState {
  /** Slots on cleared ground. What the fee is charged on. */
  plots: number;
  /** Bushels owed for the current UTC day. */
  due: number;
  /** Bushels already taken for the current UTC day. */
  paid: number;
  /** What is still owed today. Zero once settled, and zero all day for a
   *  farm under the free base. */
  outstanding: number;
  /** True when the bill is settled -- the gate on taking on more land. */
  settled: boolean;
}

export function upkeepState(plots: number, paidToday: number): StackAcresUpkeepState {
  const due = landUpkeepDue(plots);
  const paid = Math.max(0, Math.min(paidToday, due));
  return { plots, due, paid, outstanding: due - paid, settled: due - paid <= 0 };
}

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
const OVERGROWTH_CANOPY: readonly SceneryKind[] = ["tree1", "tree2", "tree3", "pine"];
const OVERGROWTH_SCRUB: readonly SceneryKind[] = ["bush", "bush", "log", "boulder", "rock"];
const OVERGROWTH_FLOOR: readonly SceneryKind[] = ["tuft", "tuft", "tuft", "flower1", "flower2", "flower3", "mushroom"];

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
  const bounds: WorldRect = STACKACRES_ZONES[id].bounds;
  const random = seededRandom(
    (Math.round(bounds.x) * 374761393) ^ (Math.round(bounds.y) * 668265263) ^ (id.length * 0x9e3779b1),
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
