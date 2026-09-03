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
  ell,
  F,
  leaf,
  lin,
  litMass,
  painter,
  poly,
  rad,
  rr,
  stroke,
  type Ctx,
  type Paint,
  type Painter,
} from "./art-kit";
import { PROP_PAINTERS, type PropPainterName } from "./art-props";
import { WATER_PAINTERS, type WaterPainterName } from "./art-water";
import { ZONE_PAINTERS, type ZonePainterName } from "./art-zones";

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
  | "cloud"
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
 *  reads as a wood rather than as one tree stamped repeatedly. */
const treeRound =
  (dark: string, mid: string, light: string): Paint =>
  (c) => {
    rr(c, 10.2, 17, 3.8, 12, 1.6);
    F(c, lin(c, 10, 0, 14, 0, [[0, "#a46e3c"], [0.55, "#7d4f27"], [1, "#4b2d15"]]));
    // One dark mass with three lobes on it, then lit as a whole so the lobes
    // read as one canopy catching the sun rather than three stacked coins.
    ell(c, 12.2, 12.6, 11.2, 10.4);
    F(c, dark);
    for (const [x, y, rx, ry] of [[7.6, 12.6, 6.4, 5.6], [16.4, 13, 6.2, 5.4], [11.6, 7.8, 6.8, 5.8]] as const) {
      ell(c, x, y, rx, ry);
      F(c, mid);
    }
    ell(c, 12.2, 12.6, 11.2, 10.4);
    litMass(c, 12.2, 12.6, 11.2, 10.4, "rgba(8,45,22,.46)", light);
    for (const [x, y] of [[16.5, 15.5], [12.5, 18.5], [7.5, 16.5]] as const) {
      ell(c, x, y, 2.1, 1.5);
      F(c, "rgba(20,70,25,.24)");
    }
    for (const [x, y] of [[7.2, 6.4], [10.6, 4.6]] as const) {
      ell(c, x, y, 1.9, 1.2, -0.5);
      F(c, "rgba(238,255,205,.5)");
    }
  };

const flower =
  (colour: string): Paint =>
  (c) => {
    c.beginPath();
    c.moveTo(3, 8);
    c.lineTo(3.2, 4.2);
    stroke(c, "#4f9d46", 0.9);
    for (let k = 0; k < 5; k += 1) {
      const a = (k / 5) * Math.PI * 2;
      ell(c, 3 + Math.cos(a) * 1.7, 3 + Math.sin(a) * 1.7, 1.25, 1.25);
      F(c, colour);
    }
    ell(c, 3, 3, 0.95, 0.95);
    F(c, "#f7d774");
  };

/* ---- crops ------------------------------------------------------------- */
// Hoisted because the seed-strip icons draw the ripe frame directly.

const carrot2 = painter(12, 16, (c) => {
  leaf(c, 3, 9.6, 1.9, 4.8, -0.7, "#4fae47");
  leaf(c, 6, 8.2, 1.9, 5.4, 0, "#6cc25f");
  leaf(c, 9, 9.6, 1.9, 4.8, 0.7, "#4fae47");
  rr(c, 3.2, 11.6, 5.6, 4.6, 2.6);
  F(c, lin(c, 0, 11, 0, 16, [[0, "#ff9f3c"], [1, "#e2711d"]]));
  ell(c, 5, 12.8, 1.2, 0.6);
  F(c, "rgba(255,255,255,.4)");
});

const corn2 = painter(12, 22, (c) => {
  c.beginPath();
  c.moveTo(6, 22);
  c.lineTo(6, 3);
  stroke(c, "#5aa84f", 1.4);
  leaf(c, 3, 17, 1.5, 4.8, -0.9, "#5cb851");
  leaf(c, 9.2, 15, 1.5, 4.8, 0.9, "#5cb851");
  leaf(c, 3.4, 10.5, 1.3, 4, -0.8, "#6cc25f");
  rr(c, 6.6, 7.5, 3.6, 8.5, 1.8);
  F(c, lin(c, 6, 0, 10, 0, [[0, "#ffd75a"], [1, "#e8b62e"]]));
  leaf(c, 9.6, 12.5, 1.1, 4.2, 0.35, "#4fae47");
  for (const y of [1.5, 2.2]) {
    c.beginPath();
    c.moveTo(6, 3.4);
    c.lineTo(4.4, y);
    c.moveTo(6, 3.4);
    c.lineTo(7.6, y);
    stroke(c, "#d9c57a", 0.7);
  }
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

/** Every painter, by name. A record literal rather than a table built by
 *  mutation, so a name added to `PainterName` without a painter is a compile
 *  error instead of an undefined texture at boot. */
export const PAINTERS: Record<PainterName, Painter> = {
  ...WATER_PAINTERS,
  ...PROP_PAINTERS,
  ...ZONE_PAINTERS,

  // The ground shadow of whatever stands on it. Anchored at its own centre
  // rather than its bottom edge, so a caller placing it at a thing's feet
  // puts the pool UNDER the feet instead of hidden up behind the trunk; the
  // pool itself sits three units right of the anchor, the way a high sun to
  // the upper-left throws it. The tighter dark core at the contact point is
  // what stops a tree from reading as hovering over its own shadow.
  shadow: painter(
    36,
    16,
    (c) => {
      ell(c, 19, 8, 16.5, 6.6);
      F(
        c,
        rad(c, 19, 8, 0, 16.5, [
          [0, "rgba(15,45,15,.30)"],
          [0.55, "rgba(15,45,15,.18)"],
          [1, "rgba(15,45,15,0)"],
        ]),
      );
      ell(c, 17.5, 8, 7.5, 3);
      F(c, rad(c, 17.5, 8, 0, 7.5, [[0, "rgba(10,35,10,.24)"], [1, "rgba(10,35,10,0)"]]));
    },
    16 / 36,
    0.5,
  ),

  cloud: painter(160, 90, (c) => {
    for (const [x, y, r] of [[60, 45, 40], [95, 40, 36], [120, 52, 28], [40, 55, 26]] as const) {
      ell(c, x, y, r, r * 0.62);
      F(
        c,
        rad(c, x, y, 0, r, [
          [0, "rgba(15,40,15,.16)"],
          [0.7, "rgba(15,40,15,.10)"],
          [1, "rgba(15,40,15,0)"],
        ]),
      );
    }
  }),

  tree1: painter(24, 30, treeRound("#3f8a3c", "#57a94f", "rgba(160,225,135,.65)")),
  tree2: painter(24, 30, treeRound("#347a48", "#4a9b5a", "rgba(150,220,150,.6)")),
  tree3: painter(24, 30, treeRound("#4f8f34", "#6ab04a", "rgba(190,235,140,.6)")),

  pine: painter(20, 34, (c) => {
    rr(c, 8.4, 26, 3.2, 8, 1.2);
    F(c, "#7a4f2c");
    // Each skirt is stroked as well as filled, so the needles keep a soft
    // outline instead of a razor edge where two layers meet.
    const layer = (y0: number, y1: number, hw: number, colour: string) => {
      poly(c, [[10 - hw, y1], [10, y0], [10 + hw, y1]]);
      c.lineJoin = "round";
      c.strokeStyle = colour;
      c.lineWidth = 2.2;
      c.stroke();
      F(c, colour);
      // The half of each skirt facing away from the sun.
      poly(c, [[10, y0], [10 + hw + 1, y1 + 1], [10, y1 + 1]]);
      F(c, "rgba(5,40,30,.24)");
    };
    layer(10, 27, 9, "#2f7a4d");
    layer(5, 20, 7.4, "#3a9058");
    layer(1, 13.5, 5.6, "#4aa668");
    poly(c, [[10, 2], [4.6, 13], [10, 12]]);
    F(c, "rgba(190,240,190,.22)");
    poly(c, [[10, 7], [3.2, 20], [10, 19]]);
    F(c, "rgba(190,240,190,.16)");
  }),

  bush: painter(16, 12, (c) => {
    ell(c, 8, 7.8, 7.6, 4.2);
    F(c, "#3f8a3c");
    ell(c, 6, 6.2, 5, 4);
    F(c, "#5aa84f");
    ell(c, 10.4, 6.6, 4.6, 3.6);
    F(c, "#4f9d46");
    ell(c, 8, 7.4, 7.6, 4.6);
    litMass(c, 8, 7.4, 7.6, 4.6, "rgba(8,45,22,.42)", "rgba(190,240,160,.55)");
  }),

  rock: painter(14, 10, (c) => {
    poly(c, [[1, 8.2], [2.6, 3.4], [6.8, 1], [11, 2.4], [13, 6.8], [11.2, 9.6], [3, 9.6]]);
    F(c, lin(c, 2, 1, 12, 10, [[0, "#c3cacf"], [0.5, "#98a2a8"], [1, "#5f6a70"]]));
    poly(c, [[1, 8.2], [2.6, 3.4], [6.8, 1], [11, 2.4], [13, 6.8], [11.2, 9.6], [3, 9.6]]);
    litMass(c, 7, 5.5, 6.2, 4.5, "rgba(20,30,40,.4)", "rgba(255,255,255,.3)");
    ell(c, 5.2, 4, 2.6, 1.4, -0.4);
    F(c, "rgba(255,255,255,.4)");
  }),

  flower1: painter(6, 8, flower("#ff7eb6")),
  flower2: painter(6, 8, flower("#fff5c2")),
  flower3: painter(6, 8, flower("#ffb347")),

  tuft: painter(8, 6, (c) => {
    for (const [x0, x1] of [[2, 1.2], [4, 4], [6, 6.8]] as const) {
      c.beginPath();
      c.moveTo(x0, 6);
      c.quadraticCurveTo(x0, 3, x1, 0.8);
      stroke(c, "#5fae52", 0.9);
    }
  }),

  stump: painter(10, 8, (c) => {
    rr(c, 1, 2.6, 8, 5.4, 2);
    F(c, "#8b5a2b");
    ell(c, 5, 2.8, 4, 1.9);
    F(c, "#d9b27a");
    ell(c, 5, 2.8, 2.2, 1);
    stroke(c, "#b8905a", 0.5);
  }),

  puddle: painter(18, 8, (c) => {
    ell(c, 9, 4, 8.6, 3.4);
    F(c, "rgba(110,150,170,.75)");
    ell(c, 6.5, 3.2, 3, 1.1);
    F(c, "rgba(255,255,255,.35)");
  }),

  /* ---- the cell beds: one painter covers a whole plot ---- */

  // A cleared lot: mown a shade lighter than the lawn, with a cream dotted
  // rim the way a cozy farm marks land you can build on. The rim is what lets
  // an empty plot read as a plot with no ring on it at all.
  mown: painter(
    CELL,
    CELL,
    (c) => {
      rr(c, 2, 2, 76, 76, 7);
      F(c, lin(c, 2, 2, 78, 78, [[0, "rgba(255,255,220,.24)"], [1, "rgba(255,255,220,.06)"]]));
      for (let i = 1; i < 8; i += 2) {
        rr(c, 2, 2 + i * 9.5, 76, 9.5, 0);
        F(c, "rgba(255,255,255,.06)");
      }
      rr(c, 4.5, 4.5, 71, 71, 5.5);
      c.setLineDash([2.6, 2.4]);
      stroke(c, "rgba(255,252,235,.72)", 1);
      c.setLineDash([]);
      rr(c, 2, 2, 76, 76, 7);
      stroke(c, "rgba(35,80,30,.2)", 0.9);
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
      rr(c, 2, 2, 76, 76, 7);
      F(c, lin(c, 2, 2, 78, 78, [[0, "#bd8956"], [1, "#82502c"]]));
      rr(c, 2, 2, 76, 76, 7);
      c.save();
      c.clip();
      c.fillStyle = lin(c, 0, 2, 0, 11, [[0, "rgba(255,228,185,.34)"], [1, "rgba(255,228,185,0)"]]);
      c.fillRect(2, 2, 76, 9);
      c.fillStyle = lin(c, 2, 0, 11, 0, [[0, "rgba(255,228,185,.2)"], [1, "rgba(255,228,185,0)"]]);
      c.fillRect(2, 2, 9, 76);
      c.fillStyle = lin(c, 0, 69, 0, 78, [[0, "rgba(40,18,4,0)"], [1, "rgba(40,18,4,.34)"]]);
      c.fillRect(2, 69, 76, 9);
      c.fillStyle = lin(c, 69, 0, 78, 0, [[0, "rgba(40,18,4,0)"], [1, "rgba(40,18,4,.24)"]]);
      c.fillRect(69, 2, 9, 76);
      c.restore();
      for (const y of [13, 29, 45, 61]) {
        rr(c, 8, y - 1.8, 64, 2.4, 1.2);
        F(c, "rgba(255,218,165,.3)");
        rr(c, 8, y, 64, 6.5, 3.2);
        F(c, lin(c, 0, y, 0, y + 6.5, [[0, "#5b3719"], [1, "#7b4d2a"]]));
        rr(c, 8, y + 6.5, 64, 1.4, 0.7);
        F(c, "rgba(255,205,150,.22)");
      }
      const r = seededRandom(31);
      for (let i = 0; i < 14; i += 1) {
        const x = 6 + r() * 68;
        const y = 4 + r() * 72;
        const k = 0.8 + r() * 1.2;
        ell(c, x, y, k * 1.4, k);
        F(
          c,
          rad(c, x - k * 0.4, y - k * 0.4, 0, k * 1.6, [
            [0, "rgba(220,175,125,.55)"],
            [1, "rgba(80,48,20,.4)"],
          ]),
        );
      }
      rr(c, 2, 2, 76, 76, 7);
      stroke(c, "rgba(70,40,15,.4)", 1);
    },
    0,
    0,
  ),

  straw: painter(
    CELL,
    CELL,
    (c) => {
      rr(c, 2, 2, 76, 76, 7);
      F(c, lin(c, 2, 2, 78, 78, [[0, "#e2d29c"], [1, "#c9b67c"]]));
      const r = seededRandom(77);
      for (let i = 0; i < 9; i += 1) {
        ell(c, 8 + r() * 64, 8 + r() * 64, 5 + r() * 6, 2.5 + r() * 3);
        F(c, "rgba(170,140,80,.28)");
      }
      for (let i = 0; i < 26; i += 1) {
        const x = 6 + r() * 68;
        const y = 6 + r() * 68;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 3 + r() * 3, y - 1 + r() * 2);
        stroke(c, "rgba(255,245,200,.55)", 0.6);
      }
      // The fence along the bottom and right shades the straw inside it.
      rr(c, 2, 2, 76, 76, 7);
      c.save();
      c.clip();
      c.fillStyle = lin(c, 0, 66, 0, 78, [[0, "rgba(110,80,30,0)"], [1, "rgba(110,80,30,.26)"]]);
      c.fillRect(2, 66, 76, 12);
      c.fillStyle = lin(c, 68, 0, 78, 0, [[0, "rgba(110,80,30,0)"], [1, "rgba(110,80,30,.18)"]]);
      c.fillRect(68, 2, 10, 76);
      c.restore();
      rr(c, 2, 2, 76, 76, 7);
      stroke(c, "rgba(120,90,40,.28)", 0.9);
    },
    0,
    0,
  ),

  muckbed: painter(
    CELL,
    CELL,
    (c) => {
      rr(c, 2, 2, 76, 76, 7);
      F(c, lin(c, 0, 2, 0, 78, [[0, "#6e4a2e"], [1, "#4f3420"]]));
      rr(c, 2, 2, 76, 76, 7);
      stroke(c, "rgba(0,0,0,.18)", 0.9);
    },
    0,
    0,
  ),

  // Square, not rounded: wild cells tile edge to edge, and rounded corners
  // leave a four-pointed gap of bright grass everywhere four of them meet.
  wild: painter(
    CELL,
    CELL,
    (c) => {
      c.fillStyle = "rgba(20,60,20,.10)";
      c.fillRect(0, 0, CELL, CELL);
    },
    0,
    0,
  ),

  /* ---- the pen ---- */

  railH: painter(
    16,
    9,
    (c) => {
      rr(c, 0, 0, 3.2, 9, 1.2);
      F(c, lin(c, 0, 0, 3, 0, [[0, "#d7a062"], [1, "#9b6a38"]]));
      for (const y of [1.8, 5.2]) {
        rr(c, 2.4, y, 14, 1.8, 0.9);
        F(c, "#c98a4b");
        rr(c, 2.4, y + 1.2, 14, 0.6, 0.3);
        F(c, "rgba(0,0,0,.14)");
      }
    },
    0,
    0,
  ),

  railV: painter(
    9,
    16,
    (c) => {
      rr(c, 2.9, 0, 3.2, 3.6, 1.2);
      F(c, lin(c, 3, 0, 6, 0, [[0, "#d7a062"], [1, "#9b6a38"]]));
      for (const x of [1.3, 5.6]) {
        rr(c, x, 2.4, 1.8, 14, 0.9);
        F(c, "#c98a4b");
        rr(c, x + 1.2, 2.4, 0.6, 14, 0.3);
        F(c, "rgba(0,0,0,.14)");
      }
    },
    0,
    0,
  ),

  gate: painter(
    16,
    9,
    (c) => {
      for (const y of [1.8, 5.2]) {
        rr(c, 0, y, 16, 1.8, 0.9);
        F(c, "#c98a4b");
      }
      c.beginPath();
      c.moveTo(1, 2.5);
      c.lineTo(15, 6.5);
      c.moveTo(15, 2.5);
      c.lineTo(1, 6.5);
      stroke(c, "#b3743a", 1.1);
    },
    0,
    0,
  ),

  troughFull: painter(
    30,
    13,
    (c) => {
      rr(c, 0, 3, 30, 10, 2.2);
      F(c, lin(c, 0, 3, 0, 13, [[0, "#b57a45"], [1, "#82552b"]]));
      rr(c, 2, 4.6, 26, 6.4, 1.4);
      F(c, "#5a3d22");
      rr(c, 3, 4.2, 24, 4.8, 1.4);
      F(c, "#f2c94c");
      for (let i = 0; i < 10; i += 1) {
        ell(c, 5 + i * 2.3, 5.2 + (i % 2) * 1.4, 0.8, 0.6);
        F(c, "#e0a92c");
      }
    },
    0,
    0,
  ),

  troughEmpty: painter(
    30,
    13,
    (c) => {
      rr(c, 0, 3, 30, 10, 2.2);
      F(c, lin(c, 0, 3, 0, 13, [[0, "#b57a45"], [1, "#82552b"]]));
      rr(c, 2, 4.6, 26, 6.4, 1.4);
      F(c, "#4a3018");
    },
    0,
    0,
  ),

  /* ---- crops, three frames each ---- */

  carrot0: painter(12, 16, (c) => {
    leaf(c, 4.6, 12.6, 1.5, 2.8, -0.5, "#6cc25f");
    leaf(c, 7.4, 12.6, 1.5, 2.8, 0.5, "#6cc25f");
  }),

  carrot1: painter(12, 16, (c) => {
    leaf(c, 3.6, 11.4, 1.7, 4, -0.6, "#5cb851");
    leaf(c, 6, 10.4, 1.7, 4.6, 0, "#6cc25f");
    leaf(c, 8.4, 11.4, 1.7, 4, 0.6, "#5cb851");
    ell(c, 6, 15.2, 2.6, 1.2);
    F(c, "#f28c28");
  }),

  carrot2,

  corn0: painter(12, 22, (c) => {
    leaf(c, 4.8, 19, 1.4, 3, -0.5, "#6cc25f");
    leaf(c, 7.2, 19, 1.4, 3, 0.5, "#6cc25f");
  }),

  corn1: painter(12, 22, (c) => {
    c.beginPath();
    c.moveTo(6, 22);
    c.lineTo(6, 8);
    stroke(c, "#5aa84f", 1.3);
    leaf(c, 3.4, 16, 1.4, 4.4, -0.9, "#6cc25f");
    leaf(c, 8.6, 13, 1.4, 4.4, 0.9, "#5cb851");
    leaf(c, 3.8, 11, 1.2, 3.6, -0.8, "#6cc25f");
  }),

  corn2,

  /* ---- animals ---- */

  hen: painter(14, 14, (c) => {
    ell(c, 6.4, 8.6, 5, 4.1);
    F(c, lin(c, 0, 4, 0, 13, [[0, "#fffdf7"], [1, "#eee4d0"]]));
    ell(c, 2, 6.4, 2.1, 2.9, 0.5);
    F(c, "#e9dcc3");
    ell(c, 6.2, 9.4, 3, 1.9, 0.2);
    F(c, "#f3ecdc");
    ell(c, 10.4, 5, 2.9, 2.9);
    F(c, "#fffdf7");
    for (const [x, y] of [[9.2, 2.3], [10.5, 1.6], [11.8, 2.4]] as const) {
      ell(c, x, y, 1, 1);
      F(c, "#e63946");
    }
    ell(c, 11.2, 7.4, 0.8, 1.1);
    F(c, "#e63946");
    poly(c, [[13, 4.7], [14.2, 5.6], [13, 6.4]]);
    F(c, "#f4a261");
    ell(c, 11.3, 4.6, 0.5, 0.5);
    F(c, "#2b2b2b");
    for (const x of [4.8, 7.6]) {
      c.beginPath();
      c.moveTo(x, 12.4);
      c.lineTo(x, 14);
      c.moveTo(x - 0.9, 14);
      c.lineTo(x + 0.9, 14);
      stroke(c, "#f4a261", 0.7);
    }
  }),

  sheep: painter(20, 16, (c) => {
    for (const x of [4, 7.5, 11, 14]) {
      rr(c, x, 10.8, 1.8, 5, 0.9);
      F(c, "#4a4040");
    }
    // Each wool clump gets its own tone plus a soft outline, so the puff reads
    // as several curls instead of merging into one flat undefined oval.
    const clumps = [
      [9, 8, 8.2, 5.6, "#efe7d6"],
      [4.6, 6, 4.1, 3.6, "#e2d9c4"],
      [9, 4.4, 4.7, 3.6, "#fbf8f1"],
      [13.6, 6, 4.1, 3.6, "#ece3ce"],
    ] as const;
    for (const [x, y, rx, ry, tone] of clumps) {
      ell(c, x, y, rx, ry);
      F(c, tone);
      stroke(c, "rgba(150,132,100,.35)", 0.5);
    }
    ell(c, 9, 10.4, 6.4, 2.6);
    F(c, "rgba(60,50,40,.09)");
    ell(c, 16.6, 7.6, 3, 3.2);
    F(c, "#4a4040");
    ell(c, 14.9, 6.2, 1.5, 0.8, -0.4);
    F(c, "#4a4040");
    ell(c, 16.2, 4.7, 2.3, 1.6);
    F(c, "#f6f2ea");
    ell(c, 17.5, 7.1, 0.5, 0.5);
    F(c, "#2b2b2b");
    ell(c, 17.7, 6.9, 0.18, 0.18);
    F(c, "#fff");
  }),

  cow: painter(24, 18, (c) => {
    for (const x of [4, 7.6, 12.4, 16]) {
      rr(c, x, 12, 2.2, 5.6, 1);
      F(c, "#f0eae0");
      rr(c, x, 16.4, 2.2, 1.6, 0.8);
      F(c, "#3a2f2f");
    }
    rr(c, 2, 4, 17.5, 10, 5);
    F(c, lin(c, 0, 4, 0, 14, [[0, "#fdfbf6"], [1, "#eae2d4"]]));
    ell(c, 7.2, 8, 3.6, 2.9, 0.2);
    F(c, "#3a2f2f");
    ell(c, 13.6, 11, 2.9, 2.2, -0.3);
    F(c, "#3a2f2f");
    ell(c, 15.5, 6, 1.6, 1.2);
    F(c, "#3a2f2f");
    rr(c, 16, 5, 7.4, 7.2, 3);
    F(c, "#fdfbf6");
    rr(c, 18.4, 9, 5.2, 3.3, 1.6);
    F(c, "#f2b5b5");
    for (const x of [19.6, 21.8]) {
      ell(c, x, 10.7, 0.45, 0.45);
      F(c, "#c98484");
    }
    ell(c, 16.1, 4.6, 1.7, 0.9, -0.3);
    F(c, "#e8d9b8");
    ell(c, 15.4, 5.8, 1.4, 0.8, 0.3);
    F(c, "#3a2f2f");
    ell(c, 20.4, 7.2, 0.5, 0.5);
    F(c, "#2b2b2b");
    ell(c, 11, 14.2, 2.4, 1.2);
    F(c, "#f2b5b5");
    c.beginPath();
    c.moveTo(2.4, 6);
    c.quadraticCurveTo(0, 8, 1.2, 11.5);
    stroke(c, "#e0d6c6", 0.8);
  }),

  /* ---- the yard ---- */

  // Volume without changing the silhouette: the wall is lit from the left
  // and falls into shade on the right, the eave throws a band of shadow onto
  // it, the door is recessed, and the gable's two slopes are lit unequally
  // with a bright ridge cap between them.
  barn: painter(74, 62, (c) => {
    rr(c, 6, 58, 62, 4, 1.2);
    F(c, "#4f3a2e");
    rr(c, 7, 26, 60, 35, 3);
    F(c, lin(c, 7, 0, 67, 0, [[0, "#e7634f"], [0.5, "#d04b3b"], [1, "#a03226"]]));
    for (const y of [35, 43, 51]) {
      rr(c, 7, y, 60, 0.7, 0.3);
      F(c, "rgba(80,15,8,.16)");
    }
    rr(c, 7, 26, 60, 8, 0);
    F(c, lin(c, 0, 26, 0, 34, [[0, "rgba(40,8,4,.42)"], [1, "rgba(40,8,4,0)"]]));
    rr(c, 7, 26, 60, 2.2, 0);
    F(c, "#f7efe6");
    rr(c, 29, 38, 16, 23, 2);
    F(c, lin(c, 29, 38, 29, 61, [[0, "#6b3323"], [1, "#4a2112"]]));
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
      F(c, "#f7efe6");
      glass(c, x + 1.2, 35.2, 7.6, 5.6);
      rr(c, x, 42, 10, 1.6, 0.6);
      F(c, "rgba(40,8,4,.28)");
    }
    poly(c, [[1, 28], [37, 3], [73, 28]]);
    F(c, lin(c, 0, 3, 0, 28, [[0, "#846c6c"], [1, "#4a3737"]]));
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
    F(c, lin(c, 0, 26.5, 0, 29.5, [[0, "#6e5252"], [1, "#4a3636"]]));
    rr(c, 0, 29.5, 74, 1.4, 0.7);
    F(c, "rgba(0,0,0,.22)");
    rr(c, 33, 12, 8, 7, 1.5);
    F(c, "#f7efe6");
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
      F(c, lin(c, 0, 0, 0, 10, [[0, "#f0cc62"], [1, "#d0a83c"]]));
      for (const y of [2.5, 5, 7.5]) {
        c.beginPath();
        c.moveTo(1, y);
        c.lineTo(13, y);
        stroke(c, "rgba(150,110,30,.35)", 0.6);
      }
      rr(c, 0, 0, 14, 10, 2.2);
      stroke(c, "#b98f2c", 0.6);
    },
    0,
    0,
  ),

  barrel: painter(
    10,
    13,
    (c) => {
      rr(c, 0, 0, 10, 13, 3);
      F(c, lin(c, 0, 0, 10, 0, [[0, "#b17a46"], [1, "#6e4421"]]));
      for (const y of [3, 9.4]) {
        rr(c, 0, y, 10, 1.4, 0.7);
        F(c, "#4f321a");
      }
      ell(c, 5, 1.6, 4.4, 1.5);
      F(c, "#c4915b");
    },
    0,
    0,
  ),

  sign: painter(30, 24, (c) => {
    rr(c, 13.2, 9, 3.6, 15, 1.2);
    F(c, lin(c, 13, 0, 17, 0, [[0, "#b07a45"], [1, "#7d5028"]]));
    rr(c, 0, 0, 30, 13, 2.6);
    F(c, lin(c, 0, 0, 0, 13, [[0, "#f0cb84"], [1, "#d1a35b"]]));
    rr(c, 0, 0, 30, 13, 2.6);
    stroke(c, "#8c6432", 0.9);
    for (const x of [2.6, 27.4]) {
      ell(c, x, 2.6, 0.7, 0.7);
      F(c, "#7a5230");
    }
  }),

  /* ---- the DOM chrome's icons ---- */

  "ico-look": painter(24, 24, (c) => {
    ell(c, 10, 10, 6.5, 6.5);
    F(c, "rgba(192,123,255,.18)");
    ell(c, 10, 10, 6.5, 6.5);
    stroke(c, "#e6d6ff", 2.2);
    c.beginPath();
    c.moveTo(15, 15);
    c.lineTo(21, 21);
    stroke(c, "#e6d6ff", 3);
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
 *  which is what lets an unbounded camera stand on a single tile sprite. */
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
  c.fillStyle = "#86c96e";
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
  // A layer of broad, faint patches first: the lawn is not one green, it is
  // sunlit sweeps and cooler hollows. Kept under radius 40 and very faint --
  // a few huge ones (radius 62) tiled visibly into a "stained" pattern once
  // zoomed out, which is the same trap a stronger alpha would fall into.
  for (let i = 0; i < 16; i += 1) {
    const x = r() * units;
    const y = r() * units;
    const rx = 24 + r() * 16;
    const ry = rx * (0.5 + r() * 0.4);
    const rot = r() * 3;
    const light = r() < 0.55;
    wrapped(() => {
      ell(c, x, y, rx, ry, rot);
      F(
        c,
        rad(c, x, y, 0, rx, [
          [0, light ? "rgba(255,255,215,.09)" : "rgba(25,95,35,.08)"],
          [1, "rgba(0,0,0,0)"],
        ]),
      );
    });
  }
  // Smaller, more numerous patches read as mottling.
  for (let i = 0; i < 46; i += 1) {
    const x = r() * units;
    const y = r() * units;
    const rx = 9 + r() * 20;
    const ry = rx * (0.5 + r() * 0.4);
    const rot = r() * 3;
    const dark = r() < 0.5;
    wrapped(() => {
      ell(c, x, y, rx, ry, rot);
      F(
        c,
        rad(c, x, y, 0, rx, [
          [0, dark ? "rgba(40,110,40,.11)" : "rgba(255,255,255,.08)"],
          [1, "rgba(0,0,0,0)"],
        ]),
      );
    });
  }
  for (let i = 0; i < 140; i += 1) {
    const x = r() * units;
    const y = r() * units;
    wrapped(() => {
      for (const [x0, x1] of [[-1.2, -1.8], [0, 0], [1.2, 1.8]] as const) {
        c.beginPath();
        c.moveTo(x + x0, y);
        c.quadraticCurveTo(x + x0, y - 1.6, x + x1, y - 3.2);
        stroke(c, "rgba(70,150,60,.55)", 0.5);
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
