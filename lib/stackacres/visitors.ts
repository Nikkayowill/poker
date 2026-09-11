/**
 * The ten stranded visitors: static, tappable scenery with one line of
 * "art-style shock" flavour dialogue each -- true pixel art dropped into
 * StackAcres' flat-vector world, and they say so. Placement + a one-shot
 * greeting only. No gift economy, no quest turn-ins, no server routes, no
 * Gold moves for any of this -- that is future work, deliberately not built
 * here.
 *
 * Kept out of ./props.ts on purpose: that file is the shape every OTHER prop
 * (a windmill, a lamp post, a scarecrow) is measured against, hand-placed
 * one at a time against the yard's own fixed geometry. Ten new characters
 * with their own names, lines and portraits are a different kind of content
 * -- this module owns all of it, and only pulls `PropKind`/`PROP_SIZE` back
 * from ./props.ts for the placement geometry a `PropPlacement` still needs.
 *
 * `visitorHitAt` lives HERE rather than in ./world.ts, where `barnHitAt`'s
 * own doc comment says a tap-target function like this belongs: ./world.ts
 * cannot import ./props.ts (./props.ts imports ./world.ts, and the reverse
 * would be a cycle -- see props.ts's own header), so any hit-test that needs
 * `PROP_SIZE`'s real box sizes for ten different kinds has to live somewhere
 * that can see both, and restating ten boxes as bare literals (the way
 * `RAY_HOUSE_FOOTPRINT` restates one) is exactly the duplication a single
 * generic hit-test is supposed to avoid. This module already sits downstream
 * of both ./props.ts and ./world.ts, so it is the natural home.
 */

import { PROP_SIZE, YARD_PROPS, type PropKind, type PropPlacement } from "./props";
import { BARN_FOOTPRINT, seededRandom, seedFromId, type WorldPoint } from "./world";
import { STACKACRES_ZONES, zoneAt, type ZoneId } from "./zones";
import { nearPath } from "./paths";
import { inPondZone } from "./water";

export const VISITOR_IDS = [
  "bleep",
  "glimm",
  "nib",
  "pixl",
  "squee",
  "dott",
  "mira",
  "zeph",
  "kip",
  "tavo",
] as const;

export type VisitorId = (typeof VISITOR_IDS)[number];

/** Which `PropKind` (./props.ts) each visitor paints as. */
export const VISITOR_KIND: Readonly<Record<VisitorId, PropKind>> = {
  bleep: "visitorBleep",
  glimm: "visitorGlimm",
  nib: "visitorNib",
  pixl: "visitorPixl",
  squee: "visitorSquee",
  dott: "visitorDott",
  mira: "visitorMira",
  zeph: "visitorZeph",
  kip: "visitorKip",
  tavo: "visitorTavo",
};

const KIND_TO_VISITOR = new Map<PropKind, VisitorId>(
  VISITOR_IDS.map((id) => [VISITOR_KIND[id], id] as const),
);

/** The visitor a tapped `PropKind` names, or null for every other prop. */
export function visitorForKind(kind: PropKind): VisitorId | null {
  return KIND_TO_VISITOR.get(kind) ?? null;
}

/** The name shown in the greeting bubble. */
export const VISITOR_NAME: Readonly<Record<VisitorId, string>> = {
  bleep: "Bleep",
  glimm: "Glimm",
  nib: "Nib",
  pixl: "Pixl",
  squee: "Squee",
  dott: "Dott",
  mira: "Mira",
  zeph: "Zeph",
  kip: "Kip",
  tavo: "Tavo",
};

/**
 * Each visitor's one line, verbatim -- the "art-style shock" beat: true
 * pixel art reacting to a world drawn in smooth, flat vector.
 */
export const VISITOR_LINE: Readonly<Record<VisitorId, string>> = {
  bleep:
    "BZZT—new biosignature. You're not pixelated. Are you... smooth? My scanners don't know what to do with you.",
  glimm:
    "Oh! Oh no, you can see me? I've been hiding so well. ...wait, why do you look so clean-edged? Are YOU the glitch here?",
  nib: "Reporting... nothing. Ship's gone. Squad's gone. But your farm has really good anti-aliasing, for what it's worth.",
  pixl: "My facets keep catching light your world doesn't seem to make. I flicker. You don't. I find that deeply rude, somehow.",
  squee:
    "*click click* You register as... whole? I only render in blocks. This is either a compliment to you or an insult to me.",
  dott: "I peeked out of my shell for the first time in days and the grass has MORE PIXELS than me. I don't know how to feel about that.",
  mira: "Huh. Smooth gradients. Where I'm from, a sunset like that would melt my graphics card. Mind if I set up shop near your tools?",
  zeph: "Every star I ever charted looked like this world does. Sharp. Certain. I have not looked like that in a long while, child.",
  kip: "Whoa you're not BLOCKY! Are you a boss? Do bosses live on farms? Can I pet the cow, is the cow blocky too?",
  tavo:
    "Crashed my ship somewhere past that ridge. Helmet's cracked, pride's cracked worse. At least the landing was soft. Softer than me, actually.",
};

/** The real, already-generated pixel-art PNG each greeting bubble shows as a
 *  portrait -- the same file the world itself draws (`stackacres-sprites.ts`),
 *  reused rather than a second asset, since it is the true pixel art the
 *  whole joke is about. */
export const VISITOR_PORTRAIT: Readonly<Record<VisitorId, string>> = Object.fromEntries(
  VISITOR_IDS.map((id) => [id, `/stackacres/sprites/visitor-${id}.png`]),
) as Record<VisitorId, string>;

/** Which district each visitor stands in -- see this module's own header
 *  table in the feature brief: bleep by the Farmstead's barn/windmill;
 *  glimm/nib/pixl/squee/dott scattered through the Ancestral Oak and the
 *  Coastal Market; mira/tavo at the Mine Entrance; zeph/kip in Town Square. */
const VISITOR_ZONE: Readonly<Record<VisitorId, ZoneId>> = {
  bleep: "farmstead",
  glimm: "oak",
  pixl: "oak",
  dott: "oak",
  nib: "coast",
  squee: "coast",
  mira: "mine",
  tavo: "mine",
  zeph: "townsquare",
  kip: "townsquare",
};

/** Clear of the barn by a real margin, not just outside its own box -- a
 *  visitor standing flush against the wall reads as leaning on it. */
function nearBarn(x: number, y: number, clearance = 16): boolean {
  return (
    x >= BARN_FOOTPRINT.x - clearance &&
    x <= BARN_FOOTPRINT.x + BARN_FOOTPRINT.width + clearance &&
    y >= BARN_FOOTPRINT.y - clearance &&
    y <= BARN_FOOTPRINT.y + BARN_FOOTPRINT.height + clearance
  );
}

/** Clear of every hand-placed YARD_PROPS entry -- only checked for `bleep`,
 *  the one visitor sharing a district with that cluster. */
function nearYardProp(x: number, y: number, gap = 22): boolean {
  return YARD_PROPS.some((prop) => Math.hypot(prop.x - x, prop.y - y) < gap);
}

/**
 * Finds a spot for one visitor: a point genuinely inside `zone`'s own
 * district bounds, off every path, off the pond, off the barn and the yard's
 * own hand-placed clutter (farmstead only), and clear of every visitor
 * already placed in the same district this pass. Deterministic by `seed`, so
 * the same visitor lands on the same spot on every boot -- the same
 * reject-and-retry shape `farmsteadClutter` (./props.ts) already uses for
 * its own scatter, just over one point at a time instead of a whole grid:
 * ten fixed characters do not need a lattice, only a spot each that a real
 * `nearPath`/`inPondZone` call has actually cleared, rather than a hand-typed
 * coordinate nobody has checked against the real path geometry.
 */
function findVisitorSpot(
  zone: ZoneId,
  seed: number,
  taken: readonly WorldPoint[],
  minGap: number,
): WorldPoint {
  const bounds = STACKACRES_ZONES[zone].bounds;
  const margin = Math.min(bounds.width, bounds.height) * 0.18;
  const random = seededRandom(seed);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const x = bounds.x + margin + random() * Math.max(0, bounds.width - margin * 2);
    const y = bounds.y + margin + random() * Math.max(0, bounds.height - margin * 2);
    if (zoneAt(x, y) !== zone) continue;
    if (nearPath(x, y)) continue;
    if (inPondZone(x, y)) continue;
    if (zone === "farmstead" && (nearBarn(x, y) || nearYardProp(x, y))) continue;
    if (taken.some((p) => Math.hypot(p.x - x, p.y - y) < minGap)) continue;
    return { x, y };
  }
  // Reached only if 500 tries all collide, which does not happen at these
  // district sizes for one point -- kept so this stays total rather than
  // throwing, landing on the district's own centre as a last resort.
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** How far apart two visitors standing in the same district must land,
 *  measured centre to centre -- generous next to any one of their own
 *  footprints (./props.ts's PROP_SIZE, all under 22 wide). */
const VISITOR_MIN_GAP = 50;

/**
 * The ten visitors' own placements -- computed once, at module load, rather
 * than hand-typed: see `findVisitorSpot`'s own header for why a real
 * `nearPath`/`inPondZone` check beats a coordinate nobody has verified
 * against the actual road/pond geometry. Deterministic, so this is exactly
 * as fixed as a hand-placed `PropPlacement[]` would have been -- the search
 * only replaces how the numbers were arrived at, not their stability once
 * shipped.
 */
export const VISITOR_PROPS: readonly PropPlacement[] = (() => {
  const placed: PropPlacement[] = [];
  const takenByZone = new Map<ZoneId, WorldPoint[]>();
  for (const id of VISITOR_IDS) {
    const zone = VISITOR_ZONE[id];
    const taken = takenByZone.get(zone) ?? [];
    const spot = findVisitorSpot(zone, seedFromId(`stackacres-visitor-${id}`), taken, VISITOR_MIN_GAP);
    taken.push(spot);
    takenByZone.set(zone, taken);
    placed.push({ kind: VISITOR_KIND[id], x: spot.x, y: spot.y });
  }
  return placed;
})();

/**
 * Whether a tapped ground point lands on one of the ten visitors, and if so
 * which -- one generic hit-test over `VISITOR_PROPS` rather than ten bespoke
 * functions, the same box math `rayHouseHitAt` (./world.ts) uses for its own
 * single building.
 */
export function visitorHitAt(x: number, y: number): PropKind | null {
  for (const prop of VISITOR_PROPS) {
    const size = PROP_SIZE[prop.kind];
    const left = prop.x - size.w / 2;
    const top = prop.y - size.h;
    if (x >= left && x <= left + size.w && y >= top && y <= top + size.h) {
      return prop.kind;
    }
  }
  return null;
}
