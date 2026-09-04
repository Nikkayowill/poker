/**
 * The flat-vector palette: every material in StackAcres, as one three-tone
 * ramp each.
 *
 * WHY THIS FILE EXISTS. The world is drawn by three different renderers -- the
 * Canvas2D painters baked into textures (homestead-art.ts and the area
 * modules), the ground diamonds drawn as Phaser Graphics (`paintGroundDiamond`),
 * and the buildings drawn as Graphics volumes (`drawIsoWalls` and friends) --
 * and until now each carried its own hard-coded hexes. That is the "drifted
 * hand-written copies" shape this codebase has been bitten by before
 * (STAKES_TIERS, the wager ladders, PROP_SIZE): nothing forced a barn's wall
 * and a barn's icon to be the same brown, so they slowly stopped being it.
 * Canvas2D wants `"#rrggbb"` and Phaser Graphics wants `0xrrggbb`, which is
 * exactly the kind of difference that makes people give up and retype a colour.
 * Both come from one entry here.
 *
 * WHY THREE TONES AND NOT A GRADIENT. The art direction is flat vector: a
 * surface is one flat fill, and depth comes from which face you are looking at,
 * not from a gradient across it. Every material therefore has exactly:
 *
 *   top   the lit plane, facing up and toward the sun (high, upper-left)
 *   side  the plane turned away -- a cell's left face, a wall in half light
 *   rim   the darkest tone, used for the far face AND for the outline
 *
 * Holding every material to that same three-step structure is the whole reason
 * a flat scene reads as one lit place rather than as stickers on a lawn: the
 * eye reads the CONSISTENCY of the step, not the individual colours.
 *
 * THE OUTLINE RULE, which is the single most load-bearing line here: a shape's
 * outline is its own `rim`, never black and never a shared neutral. A black
 * outline is what makes flat art read as clip-art instead of as a lit object,
 * and it was the clearest difference between the first sprite pass and the
 * reference Kayo approved.
 */

/** One material: lit plane, turned plane, darkest plane-and-outline. */
export interface Ramp {
  readonly top: string;
  readonly side: string;
  readonly rim: string;
}

export const RAMPS = {
  // 2026-09-03: grass/lawn/leaf/pine and path/wood widened -- more distance
  // between `top` and `rim` on each (the docstring above is right that the
  // eye reads that STEP, not the raw hue, so this is where "brighter" is
  // actually spent) plus a touch more saturation on `top` itself, aimed at
  // a livelier, more saturated read overall. `wild`/`soil`/`straw`/`muck`
  // deliberately untouched: the owned-vs-wild and worked-ground brightness
  // hierarchies these ramps encode (see their own comments, and
  // zones.ts's Ox Fields/Fold mood) depend on staying duller than what's
  // around them, so brightening them would undercut the exact hierarchy
  // that makes owned land read as the most inviting thing in frame.
  /** Open ground outside a plot. */
  grass: { top: "#9be23f", side: "#67ab2c", rim: "#3d6f19" },
  /** A cleared, owned plot -- deliberately the warmest, brightest green on
   *  screen, because owned land must be the most inviting thing in frame. */
  lawn: { top: "#b3ee66", side: "#79c136", rim: "#4a7d1f" },
  /** Land nobody has cleared: darker and cooler, so owned land wins. */
  wild: { top: "#5e9b3a", side: "#487a2b", rim: "#33591d" },
  path: { top: "#f7d98c", side: "#dbb46a", rim: "#9f7c40" },
  soil: { top: "#c89058", side: "#a87038", rim: "#7e5127" },
  straw: { top: "#efd98a", side: "#d4ba63", rim: "#a8913f" },
  muck: { top: "#7a5636", side: "#5c3f26", rim: "#3c2817" },
  wood: { top: "#dd9a4a", side: "#b8762c", rim: "#79491b" },
  /** Fences, trim, painted boards. */
  cream: { top: "#f8f1dc", side: "#e0d4b2", rim: "#b9a87e" },
  roof: { top: "#f05c42", side: "#ce3f2c", rim: "#9c2b1c" },
  water: { top: "#63c8e8", side: "#3fa6cc", rim: "#2a7e9e" },
  leaf: { top: "#6bd041", side: "#429322", rim: "#235411" },
  pine: { top: "#439f57", side: "#2c7a3f", rim: "#163f21" },
  carrot: { top: "#ff9a3c", side: "#e1741f", rim: "#ae5312" },
  corn: { top: "#ffd24d", side: "#e0ae28", rim: "#a87d14" },
  stone: { top: "#c3c1ba", side: "#a3a199", rim: "#7c7a73" },
  metal: { top: "#d6dbe0", side: "#aeb5bd", rim: "#7e858d" },
  /** Hens, sheep fleece, cow patches -- an off-white, never pure #fff, so a
   *  white animal still reads as lit rather than as a hole in the scene. */
  chalk: { top: "#ffffff", side: "#eae6dc", rim: "#b9b3a5" },
  hide: { top: "#9a7048", side: "#7a5634", rim: "#563a22" },
  /** The premium tier's ox and anything else that has to look expensive. */
  gold: { top: "#ffd75e", side: "#e5b02c", rim: "#a87b12" },
  /** Ironwork: hinges, wheel rims, lamp posts. */
  iron: { top: "#5c5851", side: "#454138", rim: "#2b2822" },
} as const satisfies Record<string, Ramp>;

export type RampName = keyof typeof RAMPS;

/**
 * The same colour as a Phaser Graphics fill.
 *
 * `paintGroundDiamond` and `drawIsoWalls` take numbers, the painters take
 * strings, and both must be the same colour or a plot's diamond stops matching
 * the props standing on it. Parsed rather than kept as a second literal table
 * for exactly that reason -- a second table is a table that drifts.
 */
export function hex(colour: string): number {
  return Number.parseInt(colour.slice(1), 16);
}

/** A ramp's three tones as Phaser numbers, in one call. */
export function rampHex(name: RampName): { top: number; side: number; rim: number } {
  const ramp = RAMPS[name];
  return { top: hex(ramp.top), side: hex(ramp.side), rim: hex(ramp.rim) };
}

/**
 * A translucent version of a ramp tone, for the few places that genuinely wash
 * over what is beneath rather than covering it (a plot tint, a shadow pool).
 * Kept here so those alphas are chosen against the palette rather than
 * invented at each call site.
 */
export function tint(colour: string, alpha: number): string {
  const n = hex(colour);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
