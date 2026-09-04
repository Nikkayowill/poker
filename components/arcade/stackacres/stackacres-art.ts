// Types only -- the Phaser runtime must not enter this module. It is imported
// by stackacres-icon.tsx to paint a plain DOM canvas, and the lobby must not
// download the engine for a toolbelt icon; Phaser enters only through
// stackacres-world.tsx's dynamic import of the scene.
import type * as Phaser from "phaser";
import { STACKACRES_CELL, powerOfTwoCeil, seededRandom } from "@/lib/stackacres/world";
import {
  ART_FRAME,
  ART_SCALE,
  GRASS_PX,
  blades,
  blob,
  bloom,
  canopy,
  ell,
  F,
  leaf,
  lin,
  litMass,
  painter,
  poly,
  rr,
  stroke,
  type Ctx,
  type Paint,
  type Painter,
} from "./art-kit";
import { RAMPS, tint, type Ramp } from "./art-palette";
import { PROP_PAINTERS, type PropPainterName } from "./art-props";
import { WATER_PAINTERS, type WaterPainterName } from "./art-water";
import { ZONE_PAINTERS, type ZonePainterName } from "./art-zones";
import { isSpriteName, spriteImage, spriteLoadKey, type SpriteName } from "./stackacres-sprites";

export type { Painter } from "./art-kit";
// The bake constants live in art-kit.ts so a per-area art module can read
// them without importing this file back (this file spreads those modules'
// painters into PAINTERS at evaluation time); re-exported here because the
// scene and the icons have always taken them from this module.
export { ART_FRAME, ART_SCALE, GRASS_PX } from "./art-kit";

/**
 * The StackAcres's art, drawn rather than downloaded.
 *
 * Every picture in the world is a Canvas2D painter working in world units,
 * baked once at boot into a texture at ART_SCALE device pixels per unit. That
 * buys three things a sprite sheet could not: nothing is fetched (no sheet, no
 * decode, no 404 on a cache miss), the same painter draws both the world and
 * the DOM chrome's icons so a carrot in the seed strip is the carrot in the
 * field, and because the source is vector the camera can zoom to 5x without
 * ever showing a pixel edge.
 *
 * A painter is a plain function with four numbers hung off it: `w`/`h` are the
 * box it draws inside, in units, and `ax`/`ay` are its origin within that box
 * as a fraction. Most things anchor at their feet (0.5, 1) so they sort by the
 * ground they stand on; the ones that tile a whole cell anchor top-left.
 *
 * Painters must not read anything outside their arguments -- no time, no
 * Math.random -- because a texture is baked once and then never redrawn.
 */

/** Every picture the StackAcres's vector art can draw: scenery, crops,
 *  animals, buildings, and the `ico-*` toolbelt/HUD/barn icons, plus each
 *  area module's own set (the water's dock, lilies and reeds; the yard's
 *  windmill, well and lamps, and the woodland's logs and mushrooms). */
export type PainterName =
  | CorePainterName
  | WaterPainterName
  | PropPainterName
  | ZonePainterName;

type CorePainterName =
  | "shadow"
  | "edgeArrow"
  | "tree1"
  | "tree2"
  | "tree3"
  | "pine"
  | "bush"
  | "rock"
  | "flower1"
  | "flower2"
  | "flower3"
  | "tuft"
  | "stump"
  | "puddle"
  | "mown"
  | "soil"
  | "straw"
  | "muckbed"
  | "wild"
  | "railH"
  | "railV"
  | "gate"
  | "troughFull"
  | "troughEmpty"
  | "carrot0"
  | "carrot1"
  | "carrot2"
  | "corn0"
  | "corn1"
  | "corn2"
  | "hen"
  | "sheep"
  | "cow"
  | "barn"
  | "silo"
  | "hay"
  | "barrel"
  | "sign"
  | "ico-look"
  | "ico-plant"
  | "ico-harvest"
  | "ico-feed"
  | "ico-clear"
  | "ico-bushels"
  | "ico-gold"
  | "ico-egg"
  | "ico-fleece"
  | "ico-milk"
  | "ico-carrot"
  | "ico-corn";

// The drawing shorthands (rr, ell, lin, rad, F, poly, stroke, leaf, painter)
// and the shared light (litMass) live in ./art-kit.ts, so the per-area art
// modules this file spreads into PAINTERS can use them without a cycle.

/* ---- scenery ----------------------------------------------------------- */

/** The three broadleaves differ only in their greens, so a stand of them
 *  reads as a wood rather than as one tree stamped repeatedly. Flat vector:
 *  the crown is a canopy of puffs shaded in two passes (see `canopy`), not a
 *  mass under a radial light. */
const treeRound =
  (mat: Ramp): Paint =>
  (c) => {
    rr(c, 10.2, 17, 3.8, 12, 1.6);
    F(c, RAMPS.wood.side);
    rr(c, 12.1, 17, 1.9, 12, 0.9);
    F(c, RAMPS.wood.rim);
    canopy(
      c,
      [
        [7.4, 13.2, 6.6],
        [16.8, 13.2, 6.6],
        [12.1, 7.4, 7.8],
      ],
      mat,
    );
  };

const flower =
  (colour: string): Paint =>
  (c) => {
    c.beginPath();
    c.moveTo(3, 8);
    c.lineTo(3.2, 4.4);
    stroke(c, RAMPS.leaf.side, 0.9);
    bloom(c, 3, 3, 2.6, colour, RAMPS.corn.side);
  };

/* ---- crops ------------------------------------------------------------- */
// Hoisted because the seed-strip icons draw the ripe frame directly.

const carrot2 = painter(12, 16, (c) => {
  for (const i of [-1, 0, 1]) {
    c.beginPath();
    c.moveTo(6, 12);
    c.quadraticCurveTo(6 + i * 2.4, 8.4, 6 + i * 3.6, 5.2);
    stroke(c, i === 0 ? RAMPS.leaf.top : RAMPS.leaf.side, 1.5);
  }
  rr(c, 3.2, 11.4, 5.6, 4.8, 2.6);
  F(c, RAMPS.carrot.top);
  rr(c, 6.2, 11.4, 2.6, 4.8, 1.3);
  F(c, RAMPS.carrot.side);
  rr(c, 3.2, 11.4, 5.6, 4.8, 2.6);
  stroke(c, RAMPS.carrot.rim, 0.7);
});

const corn2 = painter(12, 22, (c) => {
  c.beginPath();
  c.moveTo(6, 22);
  c.lineTo(6, 4);
  stroke(c, RAMPS.leaf.side, 1.6);
  for (const [x, y, rx] of [[3.2, 16.5, 3.2], [9, 14.2, 3.2], [3.6, 10.6, 2.6]] as const) {
    ell(c, x, y, rx, 1.3);
    F(c, RAMPS.leaf.top);
  }
  rr(c, 6.3, 7, 3.8, 8.8, 1.9);
  F(c, RAMPS.corn.top);
  rr(c, 8.4, 7, 1.7, 8.8, 0.85);
  F(c, RAMPS.corn.side);
  rr(c, 6.3, 7, 3.8, 8.8, 1.9);
  stroke(c, RAMPS.corn.rim, 0.6);
});

/** Glass with a gradient and a diagonal streak; a flat fill reads as a hole
 *  punched in the barn wall rather than a window. */
function glass(c: Ctx, x: number, y: number, w: number, h: number): void {
  rr(c, x, y, w, h, 1);
  F(c, lin(c, x, y, x, y + h, [[0, "#c8ecfb"], [1, "#5b9dc2"]]));
  poly(c, [
    [x + w * 0.2, y + h * 0.85],
    [x + w * 0.45, y + h * 0.1],
    [x + w * 0.65, y + h * 0.1],
    [x + w * 0.4, y + h * 0.85],
  ]);
  F(c, "rgba(255,255,255,.35)");
}

const CELL = STACKACRES_CELL;

/** Every painter, by name, as drawn code. A record literal rather than a
 *  table built by mutation, so a name added to `PainterName` without a
 *  painter is a compile error instead of an undefined texture at boot.
 *
 *  Exported as `PAINTERS` below, with the four image-backed sprites wrapped
 *  over the top of their drawn versions. */
const DRAWN: Record<PainterName, Painter> = {
  ...WATER_PAINTERS,
  ...PROP_PAINTERS,
  ...ZONE_PAINTERS,

  // The ground shadow of whatever stands on it. Anchored at its own centre
  // rather than its bottom edge, so a caller placing it at a thing's feet
  // puts the pool UNDER the feet instead of hidden up behind the trunk; the
  // pool itself sits three units right of the anchor, the way a high sun to
  // the upper-left throws it. The tighter dark core at the contact point is
  // what stops a tree from reading as hovering over its own shadow.
  // The ground shadow of whatever stands on it. Anchored at its own centre
  // rather than its bottom edge, so a caller placing it at a thing's feet
  // puts the pool UNDER the feet instead of hidden up behind the trunk.
  // Kept as two flat ellipses rather than a radial gradient: a soft pool is
  // the one place the old render look survived a flat pass, and it read as
  // blur against everything else's hard edge.
  shadow: painter(
    36,
    16,
    (c) => {
      ell(c, 19, 8, 16.5, 6.6);
      F(c, tint(RAMPS.wild.rim, 0.2));
      ell(c, 17.5, 8, 9, 3.6);
      F(c, tint(RAMPS.wild.rim, 0.16));
    },
    16 / 36,
    0.5,
  ),

  // The "you've gone far enough" nudge, pinned to a screen edge by the scene
  // (stackacres-scene.ts's `fitEdgeGuides`) and rotated per edge -- drawn
  // pointing right so rotation 0 is the shape as-is. A single flat chevron,
  // gold like every other "look here" cue in the toolbelt (ico-gold, a
  // ready-to-harvest glow), outlined in its own rim rather than black per
  // the palette's usual rule even though this is a HUD glyph, not a world
  // object -- consistency with the rest of the art reads better than a
  // one-off UI convention for a single icon.
  edgeArrow: painter(
    32,
    20,
    (c) => {
      poly(c, [[6, 7], [18, 7], [18, 3], [30, 10], [18, 17], [18, 13], [6, 13]]);
      F(c, RAMPS.gold.top);
      stroke(c, RAMPS.gold.rim, 1.6);
    },
    0.5,
    0.5,
  ),

  tree1: painter(24, 30, treeRound(RAMPS.leaf)),
  tree2: painter(24, 30, treeRound({ top: "#7acb46", side: "#5ca632", rim: "#3f7620" })),
  tree3: painter(24, 30, treeRound({ top: "#4fae55", side: "#3a8840", rim: "#27622c" })),

  pine: painter(20, 34, (c) => {
    rr(c, 8.4, 24, 3.2, 10, 1.2);
    F(c, RAMPS.wood.side);
    // Three skirts, each split down the middle: lit half toward the sun, dark
    // half away. Flat triangles, no stroke -- the tone step IS the edge.
    for (const [y0, y1, hw] of [[10, 27, 9], [5.5, 20, 7.4], [1.5, 13.5, 5.6]] as const) {
      poly(c, [[10 - hw, y1], [10, y0], [10, y1]]);
      F(c, RAMPS.pine.top);
      poly(c, [[10, y0], [10 + hw, y1], [10, y1]]);
      F(c, RAMPS.pine.side);
      poly(c, [[10 - hw, y1], [10, y0], [10 + hw, y1]]);
      stroke(c, RAMPS.pine.rim, 0.7);
    }
  }),

  bush: painter(16, 12, (c) => {
    canopy(
      c,
      [
        [5.2, 8, 4.6],
        [10.8, 8, 4.6],
        [8, 5.4, 5.2],
      ],
      RAMPS.leaf,
    );
  }),

  rock: painter(14, 10, (c) => {
    blob(c, 7, 6, 6.2, 4.2, RAMPS.stone);
    poly(c, [[3.4, 4.6], [6.6, 1.6], [10.6, 4.8]]);
    F(c, RAMPS.stone.top);
    ell(c, 7, 6, 6.2, 4.2);
    stroke(c, RAMPS.stone.rim, 0.6);
  }),

  flower1: painter(6, 8, flower("#ff7eb6")),
  flower2: painter(6, 8, flower("#fff5c2")),
  flower3: painter(6, 8, flower("#ffb347")),

  tuft: painter(8, 6, (c) => {
    blades(c, 4, 6, 5.6, RAMPS.lawn, 0.85);
  }),

  stump: painter(10, 8, (c) => {
    rr(c, 1, 2.6, 8, 5.4, 2);
    F(c, RAMPS.wood.side);
    ell(c, 5, 2.8, 4, 1.9);
    F(c, RAMPS.wood.top);
    ell(c, 5, 2.8, 2.1, 1);
    F(c, RAMPS.wood.rim);
  }),

  puddle: painter(18, 8, (c) => {
    ell(c, 9, 4, 8.6, 3.4);
    F(c, RAMPS.water.side);
    ell(c, 7.6, 3.2, 5.6, 2);
    F(c, RAMPS.water.top);
  }),

  /* ---- the cell beds: one painter covers a whole plot ---- */

  // A cleared lot: mown a shade lighter than the lawn, with a cream dotted
  // rim the way a cozy farm marks land you can build on. The rim is what lets
  // an empty plot read as a plot with no ring on it at all.
  mown: painter(
    CELL,
    CELL,
    (c) => {
      rr(c, 2, 2, CELL - 4, CELL - 4, 7);
      F(c, RAMPS.lawn.top);
      for (const [x, y] of [[18, 22], [46, 30], [30, 54], [58, 60]] as const) {
        blades(c, x, y, 7, RAMPS.grass, 0.9);
      }
      rr(c, 2, 2, CELL - 4, CELL - 4, 7);
      stroke(c, RAMPS.lawn.rim, 1.2);
    },
    0,
    0,
  ),

  // Tilled earth: a raised bed lit along its top and left lips and shadowed
  // along the bottom and right, four furrows each with a sunlit ridge above
  // its trough, and clods scattered over the lot.
  soil: painter(
    CELL,
    CELL,
    (c) => {
      rr(c, 2, 2, CELL - 4, CELL - 4, 7);
      F(c, RAMPS.soil.top);
      for (const y of [22, 40, 58]) {
        rr(c, 8, y, CELL - 16, 3.4, 1.7);
        F(c, RAMPS.soil.rim);
      }
      rr(c, 2, 2, CELL - 4, CELL - 4, 7);
      stroke(c, RAMPS.soil.rim, 1.2);
    },
    0,
    0,
  ),

  straw: painter(
    CELL,
    CELL,
    (c) => {
      rr(c, 2, 2, CELL - 4, CELL - 4, 7);
      F(c, RAMPS.straw.top);
      for (let i = 0; i < 10; i += 1) {
        const a = i * 1.7;
        const x = 40 + Math.cos(a) * 24;
        const y = 40 + Math.sin(a) * 24;
        c.beginPath();
        c.moveTo(x - 4, y);
        c.lineTo(x + 4, y - 1.6);
        stroke(c, RAMPS.straw.rim, 1.2);
      }
      rr(c, 2, 2, CELL - 4, CELL - 4, 7);
      stroke(c, RAMPS.straw.rim, 1.2);
    },
    0,
    0,
  ),

  muckbed: painter(
    CELL,
    CELL,
    (c) => {
      rr(c, 2, 2, CELL - 4, CELL - 4, 7);
      F(c, RAMPS.muck.top);
      for (const [x, y] of [[24, 28], [52, 36], [34, 56]] as const) {
        blob(c, x, y, 7, 4, { top: RAMPS.muck.side, side: RAMPS.muck.rim, rim: RAMPS.muck.rim });
      }
      rr(c, 2, 2, CELL - 4, CELL - 4, 7);
      stroke(c, RAMPS.muck.rim, 1.2);
    },
    0,
    0,
  ),

  // Square, not rounded: wild cells tile edge to edge, and rounded corners
  // leave a four-pointed gap of bright grass everywhere four of them meet.
  // Square, not rounded: wild cells tile edge to edge, and rounded corners
  // leave a four-pointed gap of bright grass everywhere four of them meet.
  // No longer a flat grey wash -- it is a real darker green with tall blades,
  // which closes the "wild plot reads as a grey rectangle" gap.
  wild: painter(
    CELL,
    CELL,
    (c) => {
      c.fillStyle = RAMPS.wild.top;
      c.fillRect(0, 0, CELL, CELL);
      for (const [x, y] of [[14, 26], [34, 18], [56, 30], [22, 52], [46, 60], [64, 48]] as const) {
        blades(c, x, y, 12, RAMPS.grass, 1.1);
      }
    },
    0,
    0,
  ),

  /* ---- the pen ---- */

  railH: painter(
    16,
    9,
    (c) => {
      for (const y of [2.2, 5.4]) {
        rr(c, 0, y, 16, 1.6, 0.8);
        F(c, RAMPS.cream.side);
      }
      for (const x of [1.4, 8, 14.6]) {
        rr(c, x - 1.5, 0.6, 3, 8, 1.2);
        F(c, RAMPS.cream.top);
        rr(c, x + 0.1, 0.6, 1.4, 8, 0.6);
        F(c, RAMPS.cream.side);
        rr(c, x - 1.5, 0.6, 3, 8, 1.2);
        stroke(c, RAMPS.cream.rim, 0.5);
      }
    },
    0,
    0,
  ),

  railV: painter(
    9,
    16,
    (c) => {
      for (const x of [2.2, 5.4]) {
        rr(c, x, 0, 1.6, 16, 0.8);
        F(c, RAMPS.cream.side);
      }
      for (const y of [1.4, 8, 14.6]) {
        rr(c, 0.6, y - 1.5, 8, 3, 1.2);
        F(c, RAMPS.cream.top);
        rr(c, 0.6, y + 0.1, 8, 1.4, 0.6);
        F(c, RAMPS.cream.side);
        rr(c, 0.6, y - 1.5, 8, 3, 1.2);
        stroke(c, RAMPS.cream.rim, 0.5);
      }
    },
    0,
    0,
  ),

  gate: painter(
    16,
    9,
    (c) => {
      for (const y of [2.2, 5.4]) {
        rr(c, 0, y, 16, 1.6, 0.8);
        F(c, RAMPS.cream.top);
      }
      c.beginPath();
      c.moveTo(1, 6.6);
      c.lineTo(15, 2.2);
      stroke(c, RAMPS.cream.side, 1.4);
      for (const x of [0.4, 14.2]) {
        rr(c, x, 0, 1.8, 9, 0.8);
        F(c, RAMPS.wood.side);
      }
    },
    0,
    0,
  ),

  troughFull: painter(
    30,
    13,
    (c) => {
      // Body, then the hollow, then the near lip drawn OVER the contents --
      // without that lip the feed reads as painted onto a plank.
      rr(c, 0, 2.6, 30, 10.4, 2.4);
      F(c, RAMPS.wood.top);
      rr(c, 1.4, 3.6, 27.2, 6.2, 1.6);
      F(c, RAMPS.muck.rim);
      rr(c, 2.2, 4, 25.6, 4.4, 1.4);
      F(c, RAMPS.corn.top);
      rr(c, 2.2, 6, 25.6, 2.4, 1.2);
      F(c, RAMPS.corn.side);
      rr(c, 0, 9.4, 30, 3.6, 1.8);
      F(c, RAMPS.wood.side);
      rr(c, 0, 3, 30, 10, 2.2);
      stroke(c, RAMPS.wood.rim, 0.7);
    },
    0,
    0,
  ),

  troughEmpty: painter(
    30,
    13,
    (c) => {
      rr(c, 0, 2.6, 30, 10.4, 2.4);
      F(c, RAMPS.wood.top);
      rr(c, 1.4, 3.6, 27.2, 6.2, 1.6);
      F(c, RAMPS.muck.rim);
      rr(c, 0, 9.4, 30, 3.6, 1.8);
      F(c, RAMPS.wood.side);
      rr(c, 0, 3, 30, 10, 2.2);
      stroke(c, RAMPS.wood.rim, 0.7);
    },
    0,
    0,
  ),

  /* ---- crops, three frames each ---- */

  carrot0: painter(12, 16, (c) => {
    for (const i of [-1, 0, 1]) {
      c.beginPath();
      c.moveTo(6, 15);
      c.quadraticCurveTo(6 + i * 1.2, 13, 6 + i * 1.8, 11);
      stroke(c, i === 0 ? RAMPS.leaf.top : RAMPS.leaf.side, 1.2);
    }
  }),

  carrot1: painter(12, 16, (c) => {
    for (const i of [-1, 0, 1]) {
      c.beginPath();
      c.moveTo(6, 15);
      c.quadraticCurveTo(6 + i * 2.2, 11, 6 + i * 3.2, 7.6);
      stroke(c, i === 0 ? RAMPS.leaf.top : RAMPS.leaf.side, 1.4);
    }
  }),

  carrot2,

  corn0: painter(12, 22, (c) => {
    c.beginPath();
    c.moveTo(6, 22);
    c.lineTo(6, 16);
    stroke(c, RAMPS.leaf.top, 1.3);
    ell(c, 4.4, 17.2, 2, 0.9);
    F(c, RAMPS.leaf.top);
  }),

  corn1: painter(12, 22, (c) => {
    c.beginPath();
    c.moveTo(6, 22);
    c.lineTo(6, 10);
    stroke(c, RAMPS.leaf.side, 1.5);
    for (const [x, y, rx] of [[3.4, 15, 2.8], [8.6, 13, 2.8]] as const) {
      ell(c, x, y, rx, 1.2);
      F(c, RAMPS.leaf.top);
    }
  }),

  corn2,

  /* ---- animals ---- */

  hen: painter(14, 14, (c) => {
    blob(c, 7, 8.4, 4.6, 4.2, RAMPS.chalk);
    blob(c, 7, 4.6, 3.2, 2.9, RAMPS.chalk);
    poly(c, [[9.6, 4.2], [12, 5], [9.6, 5.8]]);
    F(c, RAMPS.carrot.top);
    ell(c, 8.4, 3.9, 0.7, 0.8);
    F(c, RAMPS.iron.rim);
    for (const x of [6, 7.8]) {
      ell(c, x, 1.9, 1.1, 1.2);
      F(c, RAMPS.roof.top);
    }
    poly(c, [[6, 12.4], [5.2, 14], [7, 14]]);
    F(c, RAMPS.carrot.side);
  }),

  sheep: painter(20, 16, (c) => {
    for (const [x, y, r] of [[6.4, 9, 4.4], [13.4, 9, 4.4], [10, 6.4, 4.8], [10, 10.6, 4.2]] as const) {
      ell(c, x, y, r, r * 0.86);
      F(c, RAMPS.chalk.side);
    }
    for (const [x, y, r] of [[6.4, 8.2, 3.6], [13.4, 8.2, 3.6], [10, 5.6, 3.9]] as const) {
      ell(c, x, y, r, r * 0.8);
      F(c, RAMPS.chalk.top);
    }
    blob(c, 4.6, 5.6, 3, 2.6, { top: "#4a4640", side: "#332f2a", rim: "#1e1b18" });
    ell(c, 3.6, 5.2, 0.6, 0.7);
    F(c, RAMPS.iron.rim);
    for (const x of [7, 12.4]) {
      rr(c, x, 12.6, 1.6, 3.2, 0.7);
      F(c, RAMPS.iron.side);
    }
  }),

  cow: painter(24, 18, (c) => {
    blob(c, 12, 9, 8, 5.6, RAMPS.chalk);
    for (const [x, y, r] of [[9, 7, 2.4], [15, 10.4, 1.9], [11.4, 11.4, 1.5]] as const) {
      ell(c, x, y, r, r * 0.7);
      F(c, "#3e3a34");
    }
    blob(c, 5.4, 5.6, 3.6, 3.2, RAMPS.chalk);
    ell(c, 4.2, 6.6, 1.6, 1.2);
    F(c, "#f2a6a0");
    ell(c, 4.4, 4.9, 0.6, 0.7);
    F(c, RAMPS.iron.rim);
    for (const x of [2.8, 7.4]) {
      poly(c, [[x, 3.2], [x - 0.6, 1.4], [x + 1.2, 2.8]]);
      F(c, RAMPS.cream.side);
    }
    for (const x of [8, 15]) {
      rr(c, x, 13.6, 1.9, 4.2, 0.9);
      F(c, "#3e3a34");
    }
  }),

  /* ---- the yard ---- */

  // Volume without changing the silhouette: the wall is lit from the left
  // and falls into shade on the right, the eave throws a band of shadow onto
  // it, the door is recessed, and the gable's two slopes are lit unequally
  // with a bright ridge cap between them.
  barn: painter(74, 62, (c) => {
    rr(c, 6, 58, 62, 4, 1.2);
    F(c, RAMPS.wood.rim);
    rr(c, 7, 26, 60, 35, 3);
    F(c, RAMPS.roof.top);
    for (const y of [35, 43, 51]) {
      rr(c, 7, y, 60, 0.7, 0.3);
      F(c, "rgba(80,15,8,.16)");
    }
    rr(c, 7, 26, 60, 8, 0);
    F(c, tint(RAMPS.roof.rim, 0.3));
    rr(c, 7, 26, 60, 2.2, 0);
    F(c, RAMPS.cream.top);
    rr(c, 29, 38, 16, 23, 2);
    F(c, RAMPS.wood.rim);
    rr(c, 29, 38, 16, 4.5, 0);
    F(c, "rgba(0,0,0,.28)");
    c.beginPath();
    c.moveTo(30, 39);
    c.lineTo(44, 60);
    c.moveTo(44, 39);
    c.lineTo(30, 60);
    stroke(c, "#f7efe6", 1.2);
    rr(c, 29, 38, 16, 23, 2);
    stroke(c, "#f7efe6", 1);
    for (const x of [12, 52]) {
      rr(c, x, 34, 10, 8, 1.5);
      F(c, RAMPS.cream.top);
      glass(c, x + 1.2, 35.2, 7.6, 5.6);
      rr(c, x, 42, 10, 1.6, 0.6);
      F(c, "rgba(40,8,4,.28)");
    }
    poly(c, [[1, 28], [37, 3], [73, 28]]);
    F(c, RAMPS.cream.top);
    poly(c, [[1, 28], [37, 3], [37, 28]]);
    F(c, "rgba(255,240,230,.12)");
    poly(c, [[37, 3], [73, 28], [37, 28]]);
    F(c, "rgba(20,8,8,.2)");
    for (const t of [0.28, 0.52, 0.76]) {
      c.beginPath();
      c.moveTo(1 + 36 * t, 28 - 25 * t);
      c.lineTo(73 - 36 * t, 28 - 25 * t);
      stroke(c, "rgba(0,0,0,.16)", 0.6, "butt");
    }
    poly(c, [[35.4, 3.8], [37, 2.4], [38.6, 3.8], [37, 5]]);
    F(c, "rgba(255,255,255,.4)");
    rr(c, 0, 26.5, 74, 3, 1.4);
    F(c, RAMPS.cream.side);
    rr(c, 0, 29.5, 74, 1.4, 0.7);
    F(c, "rgba(0,0,0,.22)");
    rr(c, 33, 12, 8, 7, 1.5);
    F(c, RAMPS.cream.top);
    glass(c, 34.2, 13.2, 5.6, 4.6);
  }),

  silo: painter(22, 62, (c) => {
    rr(c, 3, 12, 16, 50, 3.5);
    F(c, lin(c, 3, 0, 19, 0, [[0, "#f1ebe0"], [0.5, "#d3cabc"], [0.82, "#a89f92"], [1, "#857c70"]]));
    for (const y of [24, 36, 48]) {
      rr(c, 3, y, 16, 1.2, 0.6);
      F(c, "rgba(0,0,0,.14)");
    }
    rr(c, 5, 16, 3, 40, 1.4);
    F(c, "rgba(255,255,255,.3)");
    ell(c, 11, 12, 8.2, 7);
    F(c, lin(c, 3, 5, 19, 14, [[0, "#e6ded2"], [0.6, "#bfb6a8"], [1, "#8e8578"]]));
    ell(c, 11, 12, 8.2, 7);
    litMass(c, 11, 12, 8.2, 7, "rgba(40,30,20,.3)", "rgba(255,255,255,.45)");
    rr(c, 3, 17, 16, 3, 0);
    F(c, lin(c, 0, 17, 0, 20, [[0, "rgba(0,0,0,.2)"], [1, "rgba(0,0,0,0)"]]));
  }),

  hay: painter(
    14,
    10,
    (c) => {
      rr(c, 0, 0, 14, 10, 2.2);
      F(c, RAMPS.straw.top);
      rr(c, 0, 5.4, 14, 4.6, 2.2);
      F(c, RAMPS.straw.side);
      for (const y of [2.6, 5.2, 7.8]) {
        c.beginPath();
        c.moveTo(1.2, y);
        c.lineTo(12.8, y);
        stroke(c, RAMPS.straw.rim, 0.55);
      }
      rr(c, 0, 0, 14, 10, 2.2);
      stroke(c, RAMPS.straw.rim, 0.7);
    },
    0,
    0,
  ),

  barrel: painter(
    10,
    13,
    (c) => {
      rr(c, 0, 0, 10, 13, 3);
      F(c, RAMPS.wood.side);
      rr(c, 5.4, 0, 4.6, 13, 3);
      F(c, RAMPS.wood.rim);
      for (const y of [3, 9.4]) {
        rr(c, 0, y, 10, 1.4, 0.7);
        F(c, RAMPS.iron.side);
      }
      ell(c, 5, 1.6, 4.4, 1.5);
      F(c, RAMPS.wood.top);
      rr(c, 0, 0, 10, 13, 3);
      stroke(c, RAMPS.wood.rim, 0.6);
    },
    0,
    0,
  ),

  sign: painter(30, 24, (c) => {
    rr(c, 13.2, 9, 3.6, 15, 1.2);
    F(c, RAMPS.wood.side);
    rr(c, 15, 9, 1.8, 15, 0.8);
    F(c, RAMPS.wood.rim);
    rr(c, 0, 0, 30, 13, 2.6);
    F(c, RAMPS.wood.top);
    rr(c, 0, 8.4, 30, 4.6, 2.6);
    F(c, RAMPS.wood.side);
    rr(c, 0, 0, 30, 13, 2.6);
    stroke(c, RAMPS.wood.rim, 0.9);
    for (const y of [3.4, 6.2]) {
      rr(c, 4, y, 22, 1.4, 0.7);
      F(c, RAMPS.wood.rim);
    }
  }),

  /* ---- the DOM chrome's icons ---- */

  // Repainted 2026-09-04 out of Neon Marquee lilac (an rgba(192,123,255,.18)
  // lens behind a #e6d6ff frame) and into the world's own materials. Those
  // colours were picked when the toolbelt was a violet chrome panel, and it has
  // not been one since the dock became a cream-and-corn key -- on it the lens
  // read as a bruise and the pale frame all but vanished. Brass frame over a
  // `wood`-rim outline, `water` glass: the same three-tone materials and the
  // same outline rule (a shape's outline is its own rim, never black) as every
  // sprite in art-palette.ts.
  "ico-look": painter(24, 24, (c) => {
    ell(c, 10, 10, 6.5, 6.5);
    F(c, "rgba(99,200,232,.45)");
    c.beginPath();
    c.moveTo(15, 15);
    c.lineTo(20.5, 20.5);
    stroke(c, "#79491b", 4.6);
    c.beginPath();
    c.moveTo(15, 15);
    c.lineTo(20.5, 20.5);
    stroke(c, "#dd9a4a", 2.6);
    ell(c, 10, 10, 6.5, 6.5);
    stroke(c, "#79491b", 3.6);
    ell(c, 10, 10, 6.5, 6.5);
    stroke(c, "#e5b02c", 2);
    // The one lit highlight, up and to the left, where the sun is in every
    // other sprite here.
    c.beginPath();
    c.arc(10, 10, 3.9, Math.PI * 1.06, Math.PI * 1.5);
    stroke(c, "rgba(255,255,255,.8)", 1.3);
  }),

  "ico-plant": painter(24, 24, (c) => {
    ell(c, 12, 20, 8, 3);
    F(c, "#8d5e36");
    c.beginPath();
    c.moveTo(12, 19);
    c.lineTo(12, 9);
    stroke(c, "#5aa84f", 2);
    leaf(c, 8, 10, 3, 5, -0.9, "#6cc25f");
    leaf(c, 16, 8, 3, 5, 0.9, "#7fd36f");
  }),

  "ico-harvest": painter(24, 24, (c) => {
    rr(c, 3, 10, 18, 11, 3);
    F(c, lin(c, 0, 10, 0, 21, [[0, "#c98a4b"], [1, "#8b5a2b"]]));
    c.beginPath();
    c.arc(12, 10, 7, Math.PI, 0);
    stroke(c, "#8b5a2b", 2);
    rr(c, 8, 5, 3, 7, 1.5);
    F(c, "#f28c28");
    rr(c, 13, 4, 3, 8, 1.5);
    F(c, "#ffd75a");
  }),

  "ico-feed": painter(24, 24, (c) => {
    poly(c, [[4, 8], [20, 8], [17, 21], [7, 21]]);
    F(c, lin(c, 0, 8, 0, 21, [[0, "#b8bfc4"], [1, "#7d868c"]]));
    c.beginPath();
    c.arc(12, 8, 8, Math.PI, 0);
    stroke(c, "#9aa3a8", 1.8);
    ell(c, 12, 8.5, 7.5, 2.4);
    F(c, "#f2c94c");
  }),

  "ico-clear": painter(24, 24, (c) => {
    c.beginPath();
    c.moveTo(4, 20);
    c.lineTo(15, 9);
    stroke(c, "#b07a45", 2.4);
    rr(c, 13, 3, 9, 8, 2);
    F(c, lin(c, 13, 3, 22, 11, [[0, "#c9d0d4"], [1, "#7d868c"]]));
    for (const x of [15.5, 18, 20.5]) {
      c.beginPath();
      c.moveTo(x, 10);
      c.lineTo(x, 13.5);
      stroke(c, "#7d868c", 1.4);
    }
  }),

  "ico-bushels": painter(24, 24, (c) => {
    for (const [x0, x1] of [[9, 6], [12, 12], [15, 18]] as const) {
      c.beginPath();
      c.moveTo(12, 22);
      c.quadraticCurveTo(x0, 14, x1, 4);
      stroke(c, "#d9a83a", 1.6);
      for (let k = 0; k < 4; k += 1) {
        const t = 0.35 + k * 0.17;
        const x = 12 + (x1 - 12) * t + (x0 - 12) * (1 - t) * 0.3;
        const y = 22 - 18 * t;
        ell(c, x, y, 2, 1.1, x1 > 12 ? 0.9 : x1 < 12 ? -0.9 : 0);
        F(c, "#f2c94c");
      }
    }
  }),

  "ico-gold": painter(24, 24, (c) => {
    ell(c, 12, 12, 9.5, 9.5);
    F(c, lin(c, 3, 3, 21, 21, [[0, "#ffe08f"], [1, "#d9a412"]]));
    ell(c, 12, 12, 6.2, 6.2);
    stroke(c, "rgba(120,80,0,.45)", 1.4);
    ell(c, 9, 8.5, 2.6, 1.6, -0.6);
    F(c, "rgba(255,255,255,.5)");
  }),

  "ico-egg": painter(24, 24, (c) => {
    ell(c, 12, 13, 7, 9);
    F(c, lin(c, 5, 4, 19, 22, [[0, "#fffaf0"], [1, "#e6dac4"]]));
    ell(c, 9.5, 9, 2.4, 3.2, -0.3);
    F(c, "rgba(255,255,255,.6)");
  }),

  "ico-fleece": painter(24, 24, (c) => {
    for (const [x, y, r] of [[8, 13, 5], [12, 10, 5.5], [16, 13, 5], [12, 15, 5.5]] as const) {
      ell(c, x, y, r, r);
      F(c, "#f6f2ea");
    }
    ell(c, 12, 17, 6, 2);
    F(c, "rgba(60,50,40,.08)");
  }),

  "ico-milk": painter(24, 24, (c) => {
    rr(c, 7, 8, 10, 14, 2.5);
    F(c, lin(c, 7, 0, 17, 0, [[0, "#ffffff"], [1, "#d8e2ea"]]));
    rr(c, 9.5, 2, 5, 7, 1.5);
    F(c, "#c9d3da");
    rr(c, 8.5, 12, 7, 6, 1.5);
    F(c, "#7ec8e3");
  }),

  // The two crop icons are the ripe crop itself, so the seed strip and the
  // field can never drift apart.
  // carrot2 is only 12x16, so dropped into the 24x24 icon box unscaled it
  // sits half-size in the top-left corner while every other icon fills its
  // square. Blow it up to corn's height and centre it.
  "ico-carrot": painter(24, 24, (c) => {
    c.save();
    c.translate(3.75, 1);
    c.scale(1.375, 1.375);
    carrot2(c);
    c.restore();
  }),
  "ico-corn": painter(24, 24, (c) => {
    c.save();
    c.translate(6, 1);
    corn2(c);
    c.restore();
  }),
};

/**
 * A painter that draws its image once the image is here, and its own shapes
 * until then.
 *
 * Keeping the drawn version as the fallback is not just defensive: it is what
 * the server renders, what the first frame shows, and what is left if the
 * file 404s. The box (`w`, `h`, `ax`, `ay`) is the drawn painter's, unchanged,
 * because `PROP_SIZE`, `PROP_SHADOW`, `WINDMILL_HUB` and `propRect` are all
 * written against it -- the asset was fitted to that box, rather than the box
 * moved to the asset.
 */
function spriteBacked(name: SpriteName, drawn: Painter): Painter {
  const p = ((c: Ctx) => {
    const img = spriteImage(name);
    if (img) c.drawImage(img, 0, 0, drawn.w, drawn.h);
    else drawn(c);
  }) as Painter;
  p.w = drawn.w;
  p.h = drawn.h;
  p.ax = drawn.ax;
  p.ay = drawn.ay;
  return p;
}

/** Every painter, by name, with the generated sprites standing in front of
 *  the code that used to draw them. See stackacres-sprites.ts for what they
 *  cost and why there are only this many. */
export const PAINTERS: Record<PainterName, Painter> = {
  ...DRAWN,
  cow: spriteBacked("cow", DRAWN.cow),
  hen: spriteBacked("hen", DRAWN.hen),
  sheep: spriteBacked("sheep", DRAWN.sheep),
  ox: spriteBacked("ox", DRAWN.ox),
  hog: spriteBacked("hog", DRAWN.hog),
  barn: spriteBacked("barn", DRAWN.barn),
  windmill: spriteBacked("windmill", DRAWN.windmill),
  grandfatherRay: spriteBacked("grandfatherRay", DRAWN.grandfatherRay),
};

/**
 * Draws the named painter into a CanvasTexture and returns its key. No-op if
 * the texture already exists.
 *
 * The canvas is padded out to a power of two on each side, and that padding
 * is what makes the art smooth when the camera is zoomed OUT. The game config
 * asks for `LINEAR_MIPMAP_LINEAR`, but Phaser 3.90 only builds mipmaps for
 * textures whose sides are powers of two (`WebGLTextureWrapper.update` guards
 * `gl.generateMipmap` with `IsSizePowerOfTwo`, and WebGL1 -- the only context
 * the renderer requests -- cannot mip an NPOT texture at all); anything else
 * silently drops to plain bilinear, which at the 6x minification of the
 * fully zoomed-out farm samples one texel in every forty and shimmers as the
 * map pans. The painter's own region is registered as `ART_FRAME` so the
 * padding never shows.
 */
/**
 * Bakes one of the four image sprites, from the file the scene preloaded.
 *
 * Drawn through the same power-of-two canvas as `bakeTexture` rather than
 * used as a texture directly, and for the same reason: Phaser 3.90 on WebGL1
 * only builds mipmaps for power-of-two sides, and the fully zoomed-out farm
 * minifies about 6x, so an unmipped 192x144 cow shimmers as the map pans.
 * Baking also means the painter's name still resolves to a canvas texture
 * with an `ART_FRAME` frame, so no `add.image(..., ART_FRAME)` call site had
 * to learn the difference.
 *
 * Falls back to painting the drawn version if the file never arrived.
 */
export function bakeSpriteTexture(scene: Phaser.Scene, name: SpriteName): string {
  if (scene.textures.exists(name)) return name;
  const source = scene.textures.exists(spriteLoadKey(name))
    ? (scene.textures.get(spriteLoadKey(name)).getSourceImage() as CanvasImageSource)
    : null;
  if (!source) return bakeTexture(scene, name);
  const p = PAINTERS[name];
  const width = Math.ceil(p.w * ART_SCALE);
  const height = Math.ceil(p.h * ART_SCALE);
  const texture = scene.textures.createCanvas(name, powerOfTwoCeil(width), powerOfTwoCeil(height));
  if (!texture) return name;
  texture.context.drawImage(source, 0, 0, width, height);
  texture.add(ART_FRAME, 0, 0, 0, width, height);
  texture.refresh();
  return name;
}

/** Bakes whichever of the two the name is. */
export function bakeArt(scene: Phaser.Scene, name: PainterName): string {
  return isSpriteName(name) ? bakeSpriteTexture(scene, name) : bakeTexture(scene, name);
}

export function bakeTexture(scene: Phaser.Scene, name: PainterName): string {
  if (scene.textures.exists(name)) return name;
  const p = PAINTERS[name];
  const width = Math.ceil(p.w * ART_SCALE);
  const height = Math.ceil(p.h * ART_SCALE);
  const texture = scene.textures.createCanvas(name, powerOfTwoCeil(width), powerOfTwoCeil(height));
  if (!texture) return name;
  const ctx = texture.context;
  ctx.save();
  ctx.scale(ART_SCALE, ART_SCALE);
  p(ctx);
  ctx.restore();
  texture.add(ART_FRAME, 0, 0, 0, width, height);
  texture.refresh();
  return name;
}

/**
 * A screen-sized wash the scene pins over the world: the corners fall off
 * into a soft green-black and the sun's corner carries a warm glow. Baked
 * small (it is only gradients) and stretched to whatever the camera is; a
 * power of two so it is mipped like everything else.
 */
export function bakeVignette(scene: Phaser.Scene): string {
  const key = "vignette";
  if (scene.textures.exists(key)) return key;
  const px = 256;
  const texture = scene.textures.createCanvas(key, px, px);
  if (!texture) return key;
  const c = texture.context;
  const edge = c.createRadialGradient(px / 2, px / 2, px * 0.26, px / 2, px / 2, px * 0.8);
  edge.addColorStop(0, "rgba(18,40,18,0)");
  edge.addColorStop(1, "rgba(18,40,18,.32)");
  c.fillStyle = edge;
  c.fillRect(0, 0, px, px);
  const sun = c.createRadialGradient(px * 0.08, px * 0.04, 0, px * 0.08, px * 0.04, px * 0.95);
  sun.addColorStop(0, "rgba(255,238,170,.17)");
  sun.addColorStop(1, "rgba(255,238,170,0)");
  c.fillStyle = sun;
  c.fillRect(0, 0, px, px);
  texture.refresh();
  return key;
}

/** The ground: one 256-unit tile that repeats seamlessly in every direction,
 *  which is what lets the whole open lawn stand on a single tile sprite
 *  rather than one baked per district or per chunk. */
export function bakeGrass(scene: Phaser.Scene): void {
  const key = "grass";
  if (scene.textures.exists(key)) return;
  // 256 units at 4px each: a power-of-two texture, so the tiling stays exact
  // instead of being resampled up to the next power of two.
  const units = 256;
  const texture = scene.textures.createCanvas(key, units * GRASS_PX, units * GRASS_PX);
  if (!texture) return;
  const c = texture.context;
  c.scale(GRASS_PX, GRASS_PX);
  c.fillStyle = RAMPS.grass.top;
  c.fillRect(0, 0, units, units);
  const r = seededRandom(9001);
  // Every mark is drawn nine times, once per neighbouring tile, so a mark that
  // runs off one edge comes back on the other. Each mark's randomness has to be
  // rolled ONCE, outside the nine draws, or the copies do not line up.
  const wrapped = (draw: () => void) => {
    for (const dx of [-units, 0, units]) {
      for (const dy of [-units, 0, units]) {
        c.save();
        c.translate(dx, dy);
        draw();
        c.restore();
      }
    }
  };
  // 2026-09-04: BOTH radial-gradient patch layers that used to live here
  // (a broad "sunlit sweeps" pass and a smaller, denser "mottle" pass) are
  // gone. Cutting the first and shrinking the second was not enough -- a
  // smaller soft-edged blob is still a soft-edged blob, and Kayo still read
  // it as a cloud shadow stain on the grass. What is left to break up the
  // flat fill is every OTHER pass below: individual blade strokes and dew
  // dots (fine marks, not blobs) plus the clover/pebble accent pass -- none
  // of them a radial gradient, so none of them can read as a stain.
  for (let i = 0; i < 140; i += 1) {
    const x = r() * units;
    const y = r() * units;
    wrapped(() => {
      for (const [x0, x1] of [[-1.2, -1.8], [0, 0], [1.2, 1.8]] as const) {
        c.beginPath();
        c.moveTo(x + x0, y);
        c.quadraticCurveTo(x + x0, y - 1.6, x + x1, y - 3.2);
        stroke(c, tint(RAMPS.grass.side, 0.62), 0.5);
      }
    });
  }
  for (let i = 0; i < 40; i += 1) {
    const x = r() * units;
    const y = r() * units;
    const pale = r() < 0.5;
    wrapped(() => {
      ell(c, x, y, 0.9, 0.9);
      F(c, pale ? "rgba(255,255,255,.55)" : "rgba(255,230,120,.7)");
    });
  }
  // A last, faint accent pass: tiny clover flecks and pebbles, at roughly
  // the dew pass's own mark budget so the tile's total draw cost stays in
  // the same ballpark. Kept small and low-alpha for the same reason the
  // broad patches above are capped under radius 40 -- anything bigger or
  // bolder tiles visibly into a stamped-looking repeat at this 256-unit
  // scale. A clover patch or pebble that should read as its own, distinct,
  // non-repeating thing belongs in the world's scatter systems instead
  // (chunkScenery in lib/stackacres/world.ts, zones.ts's ZONE_SCATTER) --
  // this pass is texture, not content.
  for (let i = 0; i < 14; i += 1) {
    const x = r() * units;
    const y = r() * units;
    const rot = r() * Math.PI * 2;
    wrapped(() => {
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        ell(c, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.5, 0.36, a);
        F(c, tint(RAMPS.leaf.top, 0.4));
      }
      c.restore();
    });
  }
  for (let i = 0; i < 12; i += 1) {
    const x = r() * units;
    const y = r() * units;
    const rx = 0.5 + r() * 0.4;
    wrapped(() => {
      ell(c, x, y, rx, rx * 0.75, r() * 3);
      F(c, tint(RAMPS.stone.side, 0.5));
      ell(c, x - rx * 0.2, y - rx * 0.2, rx * 0.4, rx * 0.3);
      F(c, tint(RAMPS.stone.top, 0.55));
    });
  }
  texture.refresh();
}

/** Draws a painter, centred and fitted, into a DOM canvas sized `size` CSS
 *  pixels square, at up to 3x device pixel density. */
export function paintIcon(canvas: HTMLCanvasElement, name: PainterName, size: number): void {
  const p = PAINTERS[name];
  const dpr = Math.min(3, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(size * dpr));
  canvas.height = Math.max(1, Math.round(size * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = Math.min(size / p.w, size / p.h) * dpr;
  ctx.save();
  ctx.translate((size * dpr - p.w * k) / 2, (size * dpr - p.h * k) / 2);
  ctx.scale(k, k);
  p(ctx);
  ctx.restore();
}
