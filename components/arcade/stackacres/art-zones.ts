// No Phaser here at all, not even a type: these are plain Canvas2D painters
// (see the note at the top of stackacres-art.ts).
import { ell, F, lin, litMass, painter, poly, rad, rr, stroke, type Painter } from "./art-kit";

/**
 * What stands in the three outer districts (lib/stackacres/zones.ts), plus
 * the scythe's own icon.
 *
 * Each district is drawn to be recognisable from its silhouette alone at the
 * zoom the map opens at, because that is the whole job here: a player who
 * pans east has to know they have arrived somewhere before they can read a
 * single label. So the three read as three materials rather than three
 * palettes of one -- the meadow is vertical strokes and no straight lines,
 * the ox fields are long horizontal furrows and squared-off timber, the
 * wallow is wet ellipses under a canopy.
 *
 * Same conventions as every other art module here: one sun, high and to the
 * upper-left; anchors at the feet (0.5, 1) unless a thing lies flat on the
 * ground, which anchors at its centre so the scene can place it on a point
 * without the painter's height shifting it; no time and no `Math.random`,
 * because a texture is baked once and never redrawn.
 */

export type ZonePainterName =
  // The Long Meadow. Three heights of grass plus the flowers through it.
  | "grassTall"
  | "grassMid"
  | "grassStubble"
  | "clover"
  | "buttercup"
  // The Ox Fields.
  | "furrow"
  | "hitchPost"
  | "hayBale"
  | "plough"
  | "oxTrough"
  | "ox"
  // The Fold.
  | "mudPool"
  | "wallowPost"
  | "shadeCanopy"
  | "hogTrough"
  | "hog"
  // Chrome.
  | "ico-scythe";

/** One blade of grass: a tapering curve from a fixed root. Shared by the
 *  three meadow heights so a tile that has been cut and half-regrown is
 *  visibly the same grass, shorter. */
function blade(
  c: CanvasRenderingContext2D,
  x: number,
  base: number,
  height: number,
  lean: number,
  colour: string,
  width: number,
): void {
  c.beginPath();
  c.moveTo(x, base);
  c.quadraticCurveTo(x + lean * 0.35, base - height * 0.6, x + lean, base - height);
  stroke(c, colour, width);
}

/** A tuft of grass at a given height, drawn into a fixed 14x`h` box. The
 *  blade positions are literals rather than rolled, because a painter may
 *  not read `Math.random` -- see the module header. */
function tuft(height: number, colours: readonly [string, string, string]) {
  return (c: CanvasRenderingContext2D): void => {
    const base = height;
    const spec: readonly (readonly [number, number, number, number])[] = [
      [3.0, 0.86, -1.9, 0],
      [5.2, 1.0, 0.7, 1],
      [7.0, 0.92, 2.4, 2],
      [9.2, 0.78, -1.1, 1],
      [11.0, 0.7, 1.8, 0],
    ];
    for (const [x, scale, lean, tone] of spec) {
      blade(c, x, base, height * scale, lean, colours[tone], height > 9 ? 1.05 : 0.9);
    }
  };
}

const GRASS_DARK = "#4f8c31";
const GRASS_MID = "#5f9a3d";
const GRASS_LIGHT = "#79b34f";

export const ZONE_PAINTERS: Record<ZonePainterName, Painter> = {
  /* ---- The Long Meadow ------------------------------------------------ */

  // Density 3: uncut. Tall enough to carry a seed head, which is the detail
  // that says "hay" rather than "lawn" at any zoom.
  grassTall: painter(14, 13, (c) => {
    tuft(13, [GRASS_DARK, GRASS_MID, GRASS_LIGHT])(c);
    for (const [x, y] of [[5.9, 1.2], [7.4, 2.6]] as const) {
      ell(c, x, y, 0.85, 1.7, 0.25);
      F(c, "#d9c97a");
    }
  }),

  // Density 2: a fortnight's regrowth, no seed heads yet.
  grassMid: painter(14, 8, tuft(8, [GRASS_DARK, GRASS_MID, GRASS_LIGHT])),

  // Density 1: stubble. Short, blunt and paler, because the cut ends catch
  // the light -- the visual difference between "1" and "0" is what stops a
  // half-regrown swathe reading as an uncut one.
  grassStubble: painter(14, 4, (c) => {
    for (const x of [3, 5.4, 7.6, 9.8, 11.6]) {
      c.beginPath();
      c.moveTo(x, 4);
      c.lineTo(x + 0.3, 0.8);
      stroke(c, "#8bbb63", 1.1, "butt");
    }
  }),

  clover: painter(9, 6, (c) => {
    c.beginPath();
    c.moveTo(4.5, 6);
    c.lineTo(4.5, 3.2);
    stroke(c, "#4d8a34", 0.7);
    for (const [x, y] of [[3.1, 2.6], [5.9, 2.6], [4.5, 1.2]] as const) {
      ell(c, x, y, 1.5, 1.35);
      F(c, "#5da33f");
    }
    ell(c, 4.5, 1.9, 3.1, 2.2);
    litMass(c, 4.5, 1.9, 3.1, 2.2, "rgba(10,50,15,.3)", "rgba(200,245,170,.5)");
    ell(c, 4.5, 0.9, 1.7, 1.1);
    F(c, "rgba(255,255,255,.72)");
  }),

  buttercup: painter(7, 9, (c) => {
    c.beginPath();
    c.moveTo(3.5, 9);
    c.quadraticCurveTo(2.8, 5.4, 3.5, 3.4);
    stroke(c, "#4d8a34", 0.75);
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      ell(c, 3.5 + Math.cos(a) * 1.35, 2.6 + Math.sin(a) * 1.35, 1.35, 1.15, a);
      F(c, "#ffd23f");
    }
    ell(c, 3.5, 2.6, 1, 0.95);
    F(c, "#f2a516");
  }),

  /* ---- The Ox Fields -------------------------------------------------- */

  // A single ploughed ridge, lying flat on the ground and anchored at its
  // centre: the scene lays these along the district and they are most of what
  // makes the field read as worked rather than merely brown.
  furrow: painter(
    46,
    9,
    (c) => {
      rr(c, 0, 2.4, 46, 4.4, 2.2);
      F(c, lin(c, 0, 2.4, 0, 6.8, [[0, "#8e6a3f"], [0.55, "#6d4e2c"], [1, "#4a341c"]]));
      // The lip the sun catches, and the shadow it throws into the trough.
      c.beginPath();
      c.moveTo(1.5, 3.4);
      c.lineTo(44.5, 3.4);
      stroke(c, "rgba(214,180,124,.7)", 1.1);
      c.beginPath();
      c.moveTo(2, 6.6);
      c.lineTo(44, 6.6);
      stroke(c, "rgba(30,18,6,.45)", 1.3);
      // Clods, at fixed spots.
      for (const [x, y, r] of [[8, 4.4, 1], [19, 5.4, 0.8], [31, 4.2, 1.1], [40, 5.6, 0.7]] as const) {
        ell(c, x, y, r, r * 0.66);
        F(c, "rgba(150,110,66,.75)");
      }
    },
    0.5,
    0.5,
  ),

  hitchPost: painter(8, 26, (c) => {
    // A squat post with a worn cap and the iron ring an ox is tied to.
    poly(c, [[2.4, 26], [5.6, 26], [5.2, 4], [2.8, 4]]);
    F(c, lin(c, 2.4, 0, 5.6, 0, [[0, "#a7784a"], [0.5, "#7d5730"], [1, "#4f371c"]]));
    ell(c, 4, 4, 1.9, 1);
    F(c, "#c19660");
    ell(c, 4, 3.7, 1.9, 1);
    F(c, "#8d6738");
    c.beginPath();
    c.arc(6.2, 9.4, 1.9, 0, Math.PI * 2);
    stroke(c, "#5b5f64", 0.9);
    c.beginPath();
    c.arc(6.2, 9.4, 1.9, -2.2, -0.7);
    stroke(c, "#9aa1a8", 0.7);
  }),

  hayBale: painter(26, 20, (c) => {
    // A round bale, seen from the side: banded, lit upper-left, sitting in
    // its own shadow so it does not float on a flat field.
    ell(c, 13, 12, 12.4, 8);
    F(c, rad(c, 8.5, 7.5, 1, 17, [[0, "#efdba4"], [0.55, "#d6c58c"], [1, "#9c8449"]]));
    ell(c, 13, 12, 12.4, 8);
    litMass(c, 13, 12, 12.4, 8, "rgba(60,44,12,.45)", "rgba(255,248,210,.55)");
    for (const r of [4.4, 8.2] as const) {
      c.beginPath();
      c.ellipse(13, 12, r, r * 0.64, 0, 0, Math.PI * 2);
      stroke(c, "rgba(120,96,44,.5)", 0.8);
    }
    // Loose straw off the top edge.
    for (const [x, y, dx] of [[7, 4.8, -2], [13, 3.9, 1.4], [18, 5.2, 2.2]] as const) {
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + dx, y - 2.4);
      stroke(c, "#c9b478", 0.7);
    }
  }),

  plough: painter(28, 18, (c) => {
    // Two wheels, a beam and the share, parked. Read at 28 units wide it is
    // a farm implement; read at 6 it is a dark angular thing among round
    // bales, which is all it needs to be.
    c.beginPath();
    c.moveTo(3, 8);
    c.lineTo(24, 5);
    stroke(c, "#6b4a28", 2.2);
    poly(c, [[18, 6], [26, 9], [21, 14], [16, 11]]);
    F(c, lin(c, 16, 6, 26, 14, [[0, "#b9c0c6"], [1, "#5d666d"]]));
    for (const [x, r] of [[6, 5.4], [15, 3.6]] as const) {
      c.beginPath();
      c.arc(x, 18 - r, r, 0, Math.PI * 2);
      stroke(c, "#4c3419", 1.5);
      c.beginPath();
      c.arc(x, 18 - r, r * 0.32, 0, Math.PI * 2);
      F(c, "#6b4a28");
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        c.beginPath();
        c.moveTo(x, 18 - r);
        c.lineTo(x + Math.cos(a) * r, 18 - r + Math.sin(a) * r);
        stroke(c, "rgba(76,52,25,.75)", 0.6);
      }
    }
  }),

  oxTrough: painter(24, 12, (c) => {
    poly(c, [[1, 4], [23, 4], [21, 11.4], [3, 11.4]]);
    F(c, lin(c, 0, 4, 0, 11.4, [[0, "#a07547"], [1, "#5c3f24"]]));
    ell(c, 12, 4.4, 10.4, 2);
    F(c, "#3f6d7d");
    ell(c, 9.4, 4.1, 4, 0.9);
    F(c, "rgba(255,255,255,.32)");
    c.beginPath();
    c.moveTo(1.4, 4.6);
    c.lineTo(22.6, 4.6);
    stroke(c, "rgba(212,176,126,.6)", 0.9);
  }),

  // The ox itself. Heavy, low-slung and horned -- the silhouette has to be
  // unmistakable against the pens' cattle, which are the same animal drawn
  // lighter, so this one is broader, darker and stands with its head down.
  ox: painter(30, 22, (c) => {
    ell(c, 15, 13.4, 10.6, 6.6);
    F(c, rad(c, 11, 8.6, 1, 15, [[0, "#7d6450"], [0.6, "#5d4838"], [1, "#3a2c22"]]));
    ell(c, 15, 13.4, 10.6, 6.6);
    litMass(c, 15, 13.4, 10.6, 6.6, "rgba(18,12,8,.5)", "rgba(238,220,196,.4)");
    // Legs, planted.
    for (const x of [7.5, 11.5, 19, 23] as const) {
      c.beginPath();
      c.moveTo(x, 17.5);
      c.lineTo(x, 21.6);
      stroke(c, "#33261d", 2.1, "butt");
    }
    // Head, down and forward.
    ell(c, 25.4, 11.6, 5, 4.2, 0.24);
    F(c, "#4a3a2c");
    ell(c, 28.4, 12.8, 2.2, 1.7);
    F(c, "#2b211a");
    // Horns.
    for (const dir of [-1, 1] as const) {
      c.beginPath();
      c.moveTo(24.6, 8.6);
      c.quadraticCurveTo(26.4 + dir, 6.2 + dir * 0.8, 28.4 + dir * 0.6, 7.4 + dir * 1.2);
      stroke(c, "#ddd3bd", 1.15);
    }
    // The pale muzzle and the shoulder hump, which is the ox tell.
    ell(c, 11.4, 8.2, 4.6, 3);
    F(c, "rgba(140,116,92,.55)");
  }),

  /* ---- The Fold --------------------------------------------------------- */

  // Wet mud, flat on the ground, centre-anchored. The sheen is the point:
  // it is what makes the district read as WET mud rather than as the ox
  // fields' dry brown.
  mudPool: painter(
    34,
    18,
    (c) => {
      ell(c, 17, 9, 16.4, 8.4);
      F(c, rad(c, 12, 6, 1, 20, [[0, "#5a4530"], [0.6, "#3f3020"], [1, "#2a1f13"]]));
      ell(c, 17, 9, 16.4, 8.4);
      litMass(c, 17, 9, 16.4, 8.4, "rgba(10,6,2,.55)", "rgba(196,178,150,.45)");
      // Two slicks of standing water catching the sky.
      ell(c, 12.6, 6.6, 6.2, 2.6, -0.22);
      F(c, "rgba(150,178,190,.4)");
      ell(c, 22, 11.4, 3.8, 1.6, 0.2);
      F(c, "rgba(150,178,190,.26)");
      // Churned rim.
      for (const [x, y, r] of [[4, 10, 1.6], [9, 15, 1.3], [26, 14.4, 1.5], [30, 7.6, 1.2]] as const) {
        ell(c, x, y, r, r * 0.6);
        F(c, "rgba(96,74,52,.7)");
      }
    },
    0.5,
    0.5,
  ),

  wallowPost: painter(7, 20, (c) => {
    // Leaning, and splashed with mud up its lower third -- the fence around
    // a wallow is never straight and never clean.
    poly(c, [[2.2, 20], [5, 20], [4.4, 2.6], [2.6, 2.6]]);
    F(c, lin(c, 2.2, 0, 5, 0, [[0, "#94714a"], [0.55, "#6d5133"], [1, "#42301b"]]));
    poly(c, [[2.4, 20], [5, 20], [4.8, 13.5], [2.5, 13.5]]);
    F(c, "rgba(48,36,22,.75)");
    ell(c, 3.5, 2.6, 1.5, 0.8);
    F(c, "#a8835a");
  }),

  // A lean-to on two legs: the only thing in the Fold with any height, so
  // it is what the eye lands on when the camera arrives.
  shadeCanopy: painter(42, 30, (c) => {
    for (const x of [4, 37] as const) {
      poly(c, [[x - 1.2, 30], [x + 1.2, 30], [x + 0.9, 12], [x - 0.9, 12]]);
      F(c, "#6d5133");
    }
    // Roof, sloping away from the sun.
    poly(c, [[0, 13.6], [42, 9.4], [42, 13.2], [0, 17.4]]);
    F(c, lin(c, 0, 9, 42, 17, [[0, "#8e6a3f"], [0.6, "#6b4e2c"], [1, "#493319"]]));
    // Thatch, laid in courses.
    for (let i = 0; i < 7; i += 1) {
      const t = i / 6;
      c.beginPath();
      c.moveTo(1 + t * 40, 13.5 - t * 4 + 0.4);
      c.lineTo(1 + t * 40, 17 - t * 4);
      stroke(c, "rgba(38,26,12,.35)", 0.7);
    }
    poly(c, [[0, 13.6], [42, 9.4], [42, 10.6], [0, 14.8]]);
    F(c, "rgba(255,236,196,.42)");
    // The shade it throws, which is why anything stands here at all.
    ell(c, 21, 27.5, 19, 4.4);
    F(c, "rgba(24,16,6,.26)");
  }),

  hogTrough: painter(20, 10, (c) => {
    poly(c, [[1, 3.4], [19, 3.4], [17.4, 9.6], [2.6, 9.6]]);
    F(c, lin(c, 0, 3.4, 0, 9.6, [[0, "#956c40"], [1, "#523720"]]));
    ell(c, 10, 3.8, 8.6, 1.7);
    F(c, "#6d5a37");
    ell(c, 8, 3.6, 3.2, 0.8);
    F(c, "rgba(210,190,140,.5)");
  }),

  hog: painter(20, 14, (c) => {
    ell(c, 10, 8.6, 7.4, 4.6);
    F(c, rad(c, 7, 5.4, 1, 11, [[0, "#e2a9a4"], [0.6, "#c98883"], [1, "#8d5b58"]]));
    ell(c, 10, 8.6, 7.4, 4.6);
    litMass(c, 10, 8.6, 7.4, 4.6, "rgba(60,24,22,.45)", "rgba(255,232,226,.5)");
    // Mud up the flank -- a clean hog in a wallow is a hog that has not been
    // in the wallow.
    ell(c, 8.6, 11, 5.6, 2);
    F(c, "rgba(63,48,32,.6)");
    for (const x of [5.6, 8.4, 12, 14.6] as const) {
      c.beginPath();
      c.moveTo(x, 11.8);
      c.lineTo(x, 13.6);
      stroke(c, "#7d514e", 1.5, "butt");
    }
    // Snout and ear.
    ell(c, 17, 7.4, 3.2, 2.6);
    F(c, "#d29691");
    ell(c, 19, 7.2, 1.35, 1.1);
    F(c, "#a86c68");
    poly(c, [[13.4, 4.4], [16.2, 3.2], [15.4, 6.2]]);
    F(c, "#b87a76");
    // Tail.
    c.beginPath();
    c.arc(3.2, 6.8, 1.5, -1.2, 2.4);
    stroke(c, "#c98883", 0.9);
  }),

  /* ---- Chrome --------------------------------------------------------- */

  // The toolbelt icon. Drawn in the same 24x24 box and the same two-tone
  // steel-and-timber register as the other `ico-*` tools, so it sits in the
  // dock as a sibling rather than as an import.
  "ico-scythe": painter(
    24,
    24,
    (c) => {
      // Snath, with the little side grip.
      c.beginPath();
      c.moveTo(6, 21);
      c.quadraticCurveTo(11, 15, 15.5, 7.5);
      stroke(c, "#8d6738", 2.4);
      c.beginPath();
      c.moveTo(10.4, 15.2);
      c.lineTo(14.2, 16.2);
      stroke(c, "#a7784a", 1.8);
      // Blade: a crescent, lit along its edge.
      c.beginPath();
      c.moveTo(15.5, 7.2);
      c.quadraticCurveTo(6.5, 3.4, 3.2, 8.6);
      c.quadraticCurveTo(8.4, 6.2, 15.2, 9.6);
      c.closePath();
      F(c, lin(c, 3, 4, 16, 10, [[0, "#e8edf1"], [0.55, "#aeb7bf"], [1, "#6d777f"]]));
      c.beginPath();
      c.moveTo(15.5, 7.2);
      c.quadraticCurveTo(6.5, 3.4, 3.2, 8.6);
      stroke(c, "rgba(255,255,255,.85)", 0.9);
    },
    0.5,
    0.5,
  ),
};
