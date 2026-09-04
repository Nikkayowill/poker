// No Phaser here at all, not even a type: these are plain Canvas2D painters
// (see the note at the top of stackacres-art.ts).
import { ell, F, leaf, lin, painter, poly, rad, rr, stroke, type Ctx, type Painter } from "./art-kit";
import { RAMPS } from "./art-palette";

/**
 * The farm's props: the windmill and its blades, the well, the clutter by
 * the silo, the lamps down the lane, the mailbox and the signpost, the
 * scarecrow and the field wall, and the woodland floor's litter -- a fallen
 * log, a clutch of mushrooms, a boulder -- that the open world scatters.
 *
 * Every one is a small volume rather than a flat sticker: one sun, high and
 * upper-left, so each thing's top and left faces are lit and its bottom and
 * right fall into shade, with a highlight where the sun catches a curve.
 * The ground shadow under each is the scene's `shadow` painter, placed by
 * stackacres-scene.ts from lib/stackacres/props.ts's sizes, so it is not
 * drawn here. Anchors are the feet (0.5, 1), except the blades, which are
 * pinned by their hub and turned about it.
 *
 * At the opening shot a unit is about 1.3 CSS pixels, so a ten-unit prop is
 * thirteen pixels across: every silhouette here is drawn to read at that
 * size first, and the detail is for the zoomed-in look.
 */

export type PropPainterName =
  | "windmill"
  | "windmillBlades"
  | "well"
  | "wheelbarrow"
  | "crate"
  | "logPile"
  | "mailbox"
  | "signpost"
  | "lampPost"
  | "flowerBed"
  | "stoneWall"
  | "scarecrow"
  | "grandfatherRay"
  // Not props: the farmhand walks (see lib/stackacres/farmhand.ts) and so has
  // no `PropPlacement` and no entry in YARD_PROPS. He is drawn here because
  // this is where the map's people are drawn, Ray included. Both of these are
  // his UPPER BODY only -- see their own comment below.
  | "farmhand"
  | "farmhandBack"
  | "log"
  | "mushroom"
  | "boulder";

const TAU = Math.PI * 2;

/** A wooden member lit from the left: pale on its left edge, dark on its right. */
function timber(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  rr(c, x, y, w, h, r);
  F(c, RAMPS.wood.top);
}

/** A field stone: grey mass lit upper-left, a soft outline. */
function stone(c: Ctx, x: number, y: number, w: number, h: number): void {
  const r = Math.min(w, h) * 0.42;
  rr(c, x, y, w, h, r);
  F(c, RAMPS.metal.top);
  rr(c, x, y, w, h, r);
  rr(c, x, y, w, h, r);
  stroke(c, "rgba(30,40,50,.45)", 0.5);
}

/** A pitched roof over `x0..x1` with its ridge at `peak`, lit on the left slope. */
function roof(c: Ctx, x0: number, x1: number, y: number, peak: number, light: string, dark: string): void {
  const mid = (x0 + x1) / 2;
  poly(c, [[x0, y], [mid, peak], [x1, y]]);
  F(c, lin(c, 0, peak, 0, y, [[0, light], [1, dark]]));
  poly(c, [[x0, y], [mid, peak], [mid, y]]);
  F(c, "rgba(255,230,210,.14)");
  poly(c, [[mid, peak], [x1, y], [mid, y]]);
  F(c, "rgba(20,5,5,.22)");
  for (const t of [0.34, 0.66]) {
    c.beginPath();
    c.moveTo(x0 + (mid - x0) * t, y - (y - peak) * t);
    c.lineTo(x1 - (x1 - mid) * t, y - (y - peak) * t);
    stroke(c, "rgba(0,0,0,.16)", 0.5, "butt");
  }
  c.beginPath();
  c.moveTo(x0, y);
  c.lineTo(mid, peak);
  c.lineTo(x1, y);
  stroke(c, "rgba(255,225,205,.55)", 0.7);
}

/** A five-petal flower head with its centre. */
function bloom(c: Ctx, x: number, y: number, r: number, petal: string, centre: string): void {
  for (let k = 0; k < 5; k += 1) {
    const a = (k / 5) * TAU - Math.PI / 2;
    ell(c, x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15, r * 0.9, r * 0.9);
    F(c, petal);
  }
  // The petals turned away from the sun.
  ell(c, x + r * 0.35, y + r * 0.35, r * 1.9, r * 1.9);
  c.save();
  c.clip();
  ell(c, x, y, r * 2.1, r * 2.1);
  F(c, "rgba(90,40,60,.14)");
  c.restore();
  ell(c, x, y, r * 0.62, r * 0.62);
  F(c, centre);
  ell(c, x - r * 0.55, y - r * 0.6, r * 0.5, r * 0.3, -0.7);
  F(c, "rgba(255,255,255,.35)");
}

export const PROP_PAINTERS: Record<PropPainterName, Painter> = {
  // A whitewashed stone tower, tapering, under a dark red cap with the hub
  // boss on its face; the sails are `windmillBlades`, pinned there by the
  // scene (lib/stackacres/props.ts's WINDMILL_HUB) so they can turn.
  windmill: painter(30, 70, (c) => {
    const tower = () => poly(c, [[9.5, 15], [20.5, 15], [27, 70], [3, 70]]);
    tower();
    F(c, RAMPS.wood.top);
    tower();
    c.save();
    c.clip();
    // Courses of stone, faint, fanning a little with the taper.
    for (let y = 24; y < 70; y += 9) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(30, y + 0.4);
      stroke(c, "rgba(90,70,50,.16)", 0.6, "butt");
      const off = (Math.round(y / 9) % 2) * 4;
      for (let x = 4 + off; x < 28; x += 8) {
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 0.3, y + 6);
        stroke(c, "rgba(90,70,50,.12)", 0.5, "butt");
      }
    }
    // The cap's eave throws a band of shade down the wall; the sun side
    // carries a soft bright strip.
    c.fillStyle = lin(c, 0, 15, 0, 23, [[0, "rgba(60,40,25,.36)"], [1, "rgba(60,40,25,0)"]]);
    c.fillRect(0, 15, 30, 8);
    c.fillStyle = lin(c, 4, 0, 13, 0, [[0, "rgba(255,255,255,.34)"], [1, "rgba(255,255,255,0)"]]);
    c.fillRect(3, 15, 10, 55);
    c.restore();
    // Window and the arched door.
    rr(c, 12.6, 30, 4.8, 6.2, 1.6);
    F(c, "#5e4030");
    rr(c, 13.2, 30.6, 3.6, 5, 1.2);
    F(c, RAMPS.water.top);
    rr(c, 11.4, 55.5, 7.2, 14.5, 3.4);
    F(c, "#5e4030");
    rr(c, 12.1, 56.2, 5.8, 13.8, 2.8);
    F(c, RAMPS.soil.side);
    for (const x of [14, 16]) {
      c.beginPath();
      c.moveTo(x, 57.4);
      c.lineTo(x, 69.6);
      stroke(c, "rgba(0,0,0,.18)", 0.5, "butt");
    }
    ell(c, 16.8, 63.5, 0.5, 0.5);
    F(c, "#f2d27a");
    // The cap: eave underside, then the cone lit on its left slope.
    ell(c, 15, 15.3, 8.8, 2.7);
    F(c, "#3f2a22");
    roof(c, 5.2, 24.8, 15, 2.4, "#bb5642", "#5f261c");
    ell(c, 15, 2.3, 1.1, 1.1);
    F(c, "#d9b25a");
    // The hub boss the sails pin to.
    ell(c, 15, 14, 2.7, 2.7);
    F(c, RAMPS.hide.top);
  }),

  // Four sails on a hub, anchored at the hub. Each is a spar with a canvas
  // panel laced to one side of it, the way a real sail hangs, so the wheel
  // reads as sails and not as a plus sign.
  windmillBlades: painter(
    46,
    46,
    (c) => {
      c.save();
      c.translate(23, 23);
      for (let k = 0; k < 4; k += 1) {
        c.save();
        c.rotate((k * Math.PI) / 2);
        poly(c, [[0.8, -6.5], [6.4, -7.6], [5.8, -20.6], [0.8, -21.2]]);
        F(c, RAMPS.path.top);
        for (const y of [-9.6, -12.6, -15.6, -18.6]) {
          c.beginPath();
          c.moveTo(0.8, y);
          c.lineTo(6.1, y - 0.3);
          stroke(c, "rgba(120,80,40,.42)", 0.45, "butt");
        }
        c.beginPath();
        c.moveTo(6.4, -7.6);
        c.lineTo(5.8, -20.6);
        stroke(c, "#a8763f", 0.6);
        rr(c, -1, -21.6, 2, 22.6, 1);
        F(c, RAMPS.wood.top);
        c.restore();
      }
      ell(c, 0, 0, 3.5, 3.5);
      F(c, RAMPS.cream.rim);
      ell(c, 0, 0, 1.1, 1.1);
      F(c, "#3d2612");
      c.restore();
    },
    0.5,
    0.5,
  ),

  // A stone drum under a little shingled roof on two posts, with the
  // windlass, its rope and the bucket hanging at the mouth.
  well: painter(28, 32, (c) => {
    for (const x of [4.4, 21]) timber(c, x, 10, 2.6, 15, 1);
    rr(c, 3.4, 11.4, 21.2, 1.8, 0.9);
    F(c, RAMPS.soil.top);
    c.beginPath();
    c.moveTo(14, 13);
    c.lineTo(14, 16.4);
    stroke(c, "#8a6a44", 0.55);
    rr(c, 11.4, 16, 5.2, 4.6, 1.2);
    F(c, RAMPS.soil.top);
    rr(c, 11.4, 16, 5.2, 1.2, 0.6);
    F(c, "rgba(0,0,0,.22)");
    // The drum, then its stones and the shade under the rim.
    const drum = () => rr(c, 3, 19.6, 22, 12.4, 6);
    drum();
    F(c, RAMPS.metal.top);
    drum();
    c.save();
    c.clip();
    const stones: readonly (readonly [number, number, number, number])[] = [
      [3.6, 22.2, 5.4, 3.8],
      [9.6, 21.6, 6.2, 4.2],
      [16.4, 22.2, 5.6, 3.8],
      [22.4, 21.8, 5, 4.2],
      [6.2, 26.6, 6.2, 4],
      [13, 26.4, 6.6, 4.4],
      [20, 26.8, 6, 4],
    ];
    for (const [x, y, w, h] of stones) {
      rr(c, x, y, w, h, 1.6);
      F(c, "rgba(255,255,255,.15)");
      rr(c, x, y, w, h, 1.6);
      stroke(c, "rgba(40,50,60,.3)", 0.5);
    }
    c.fillStyle = lin(c, 0, 26, 0, 32, [[0, "rgba(20,30,40,0)"], [1, "rgba(20,30,40,.38)"]]);
    c.fillRect(3, 26, 22, 6);
    c.fillStyle = lin(c, 0, 19.6, 0, 23, [[0, "rgba(20,30,40,.3)"], [1, "rgba(20,30,40,0)"]]);
    c.fillRect(3, 19.6, 22, 4);
    c.restore();
    // The rim, the dark mouth and a glint of water down it.
    ell(c, 14, 20, 11.2, 3.7);
    F(c, RAMPS.metal.top);
    ell(c, 14, 20.2, 8.7, 2.6);
    F(c, "#23262b");
    ell(c, 14, 20.6, 7.2, 1.8);
    F(c, RAMPS.metal.rim);
    ell(c, 11.4, 20.2, 2.2, 0.5);
    F(c, "rgba(255,255,255,.35)");
    // The roof last: fascia, then the shingled pitch.
    rr(c, 0.6, 9.6, 26.8, 1.8, 0.9);
    F(c, "#5a3324");
    roof(c, 1, 27, 10.2, 1, "#d0654d", "#94402f");
  }),

  // Side-on: the wheel at the front (left), the tub full of hay, the
  // handles reaching back to the right.
  wheelbarrow: painter(28, 18, (c) => {
    for (const x of [20.2, 24.6]) timber(c, x, 12, 1.7, 6, 0.8);
    ell(c, 6, 13.6, 4.3, 4.3);
    F(c, "#3b3230");
    ell(c, 6, 13.6, 3.2, 3.2);
    F(c, RAMPS.soil.top);
    for (let k = 0; k < 3; k += 1) {
      const a = (k / 3) * Math.PI;
      c.beginPath();
      c.moveTo(6 - Math.cos(a) * 3, 13.6 - Math.sin(a) * 3);
      c.lineTo(6 + Math.cos(a) * 3, 13.6 + Math.sin(a) * 3);
      stroke(c, "rgba(0,0,0,.28)", 0.6, "butt");
    }
    ell(c, 6, 13.6, 1, 1);
    F(c, "#3b3230");
    ell(c, 4.8, 12.2, 1.2, 0.7, -0.7);
    F(c, "rgba(255,255,255,.3)");
    // The tub, wider at the top, its planks and its iron band.
    poly(c, [[6, 4.4], [24.6, 4.4], [22.6, 13], [8.6, 13]]);
    F(c, RAMPS.wood.top);
    for (const y of [7.3, 10.2]) {
      c.beginPath();
      c.moveTo(7.2, y);
      c.lineTo(23.4, y);
      stroke(c, "rgba(60,30,10,.22)", 0.5, "butt");
    }
    rr(c, 8.3, 12.1, 14.6, 1.2, 0.6);
    F(c, "rgba(55,45,40,.6)");
    rr(c, 5.4, 3.4, 19.8, 1.8, 0.9);
    F(c, RAMPS.wood.top);
    // Hay heaped over the top board.
    ell(c, 15.2, 3.4, 8.6, 2.7);
    F(c, RAMPS.gold.top);
    ell(c, 12.6, 2.5, 3.4, 1.3);
    F(c, "rgba(255,246,205,.5)");
    for (const [x0, x1, y] of [[9, 12, 4.2], [14, 17.5, 3.2], [18, 21.5, 4.4]] as const) {
      c.beginPath();
      c.moveTo(x0, y);
      c.lineTo(x1, y - 0.6);
      stroke(c, "rgba(150,110,30,.4)", 0.45);
    }
    // Handles.
    c.beginPath();
    c.moveTo(24, 5.4);
    c.lineTo(28, 4.2);
    stroke(c, "#8a5a2c", 1.5);
    c.beginPath();
    c.moveTo(24, 5);
    c.lineTo(27.8, 3.9);
    stroke(c, "rgba(255,230,190,.4)", 0.5);
  }),

  // A slatted crate with its lid face catching the sun.
  crate: painter(16, 14, (c) => {
    poly(c, [[2.2, 0.5], [13.8, 0.5], [15.5, 3.6], [0.5, 3.6]]);
    F(c, RAMPS.path.top);
    rr(c, 0.5, 3.6, 15, 10.2, 1);
    F(c, RAMPS.wood.top);
    for (const x of [5.4, 10.3]) {
      c.beginPath();
      c.moveTo(x, 4.6);
      c.lineTo(x, 13);
      stroke(c, "rgba(60,30,10,.22)", 0.6, "butt");
    }
    rr(c, 0.5, 3.6, 15, 1.7, 0.5);
    F(c, "rgba(255,235,200,.36)");
    rr(c, 0.5, 12.1, 15, 1.7, 0.5);
    F(c, "rgba(50,25,5,.32)");
    rr(c, 0.5, 3.6, 1.8, 10.2, 0.5);
    F(c, "rgba(255,235,200,.22)");
    rr(c, 13.7, 3.6, 1.8, 10.2, 0.5);
    F(c, "rgba(50,25,5,.3)");
    c.beginPath();
    c.moveTo(2.3, 12.1);
    c.lineTo(13.7, 5.3);
    stroke(c, "rgba(90,50,20,.38)", 1.2);
    for (const [x, y] of [[2.1, 5.2], [13.9, 5.2], [2.1, 12.4], [13.9, 12.4]] as const) {
      ell(c, x, y, 0.38, 0.38);
      F(c, "#5a3a1e");
    }
    rr(c, 0.5, 3.6, 15, 10.2, 1);
    stroke(c, "rgba(70,40,15,.45)", 0.6);
  }),

  // Logs stacked end-on: three below, two above, each a bark ring round a
  // pale sawn face.
  logPile: painter(30, 16, (c) => {
    // Dark between the logs only: a full slab under the pile read as a sled.
    rr(c, 4, 7.4, 22, 7, 3);
    F(c, "#4e2f14");
    const log = (x: number, y: number, r: number) => {
      ell(c, x, y, r, r);
      F(c, RAMPS.muck.top);
      ell(c, x, y, r * 0.74, r * 0.74);
      F(c, RAMPS.path.top);
      ell(c, x, y, r * 0.46, r * 0.46);
      stroke(c, "rgba(140,100,50,.5)", 0.4);
      ell(c, x, y, r * 0.2, r * 0.2);
      F(c, "#a67a48");
      ell(c, x - r * 0.36, y - r * 0.4, r * 0.32, r * 0.18, -0.7);
      F(c, "rgba(255,255,255,.35)");
    };
    log(6, 11.2, 4.6);
    log(15, 11.2, 4.6);
    log(24, 11.2, 4.6);
    log(10.5, 4.8, 4.4);
    log(19.5, 4.8, 4.4);
  }),

  // A domed box on a post, seen side-on, its flag up.
  mailbox: painter(12, 24, (c) => {
    timber(c, 5, 9.5, 2.4, 14.5, 1);
    const box = () => {
      c.beginPath();
      c.moveTo(1, 10.4);
      c.lineTo(1, 5.6);
      c.arc(6, 5.6, 5, Math.PI, 0);
      c.lineTo(11, 10.4);
      c.closePath();
    };
    box();
    F(c, RAMPS.metal.side);
    box();
    c.save();
    c.clip();
    c.fillStyle = "rgba(0,0,0,.24)";
    c.fillRect(9.2, 0, 2.2, 11);
    ell(c, 4.2, 2.6, 2.4, 1.1, -0.35);
    F(c, "rgba(255,255,255,.34)");
    c.fillStyle = lin(c, 0, 7, 0, 10.4, [[0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.22)"]]);
    c.fillRect(1, 7, 10, 3.4);
    c.restore();
    rr(c, 0.6, 10, 10.8, 1.3, 0.65);
    F(c, "#2d4a68");
    ell(c, 10.2, 6.6, 0.5, 0.5);
    F(c, "#f2d27a");
    rr(c, 2, 1.6, 0.8, 5.6, 0.4);
    F(c, "#a8322c");
    rr(c, 0.8, 0.2, 3.4, 2.2, 0.6);
    F(c, "#e63946");
  }),

  // Two arrow boards on a post, pointing opposite ways. No lettering: the
  // farm has no name to write on it, and text at this size is noise.
  signpost: painter(18, 26, (c) => {
    timber(c, 7.8, 4, 2.6, 22, 1.2);
    ell(c, 9.1, 4.2, 1.6, 0.8);
    F(c, "#d9a869");
    const board = (y: number, dir: -1 | 1) => {
      const h = 5.2;
      const pts: (readonly [number, number])[] =
        dir < 0
          ? [[0.6, y + h / 2], [3.4, y], [16.6, y], [16.6, y + h], [3.4, y + h]]
          : [[17.4, y + h / 2], [14.6, y], [1.4, y], [1.4, y + h], [14.6, y + h]];
      poly(c, pts);
      F(c, RAMPS.path.top);
      poly(c, pts);
      stroke(c, "#8c6432", 0.7);
      c.beginPath();
      c.moveTo(dir < 0 ? 5.6 : 3.4, y + h / 2);
      c.lineTo(dir < 0 ? 14 : 12.2, y + h / 2);
      stroke(c, "rgba(120,80,30,.32)", 1.1);
      for (const x of dir < 0 ? [4.8, 15] : [3, 13.2]) {
        ell(c, x, y + 1.1, 0.42, 0.42);
        F(c, "#7a5230");
      }
    };
    board(5.4, -1);
    board(12.2, 1);
  }),

  // An iron post with a warm glass lantern under a little cap, and the
  // faint halo a lit lamp throws even in daylight.
  lampPost: painter(9, 34, (c) => {
    ell(c, 4.5, 6.6, 4.5, 4.5);
    F(c, rad(c, 4.5, 6.6, 0, 4.5, [[0, "rgba(255,214,120,.34)"], [1, "rgba(255,214,120,0)"]]));
    rr(c, 2.2, 30.4, 4.6, 3.6, 1.2);
    F(c, RAMPS.metal.rim);
    rr(c, 3, 28.6, 3, 2.4, 0.8);
    F(c, "#3c3c46");
    rr(c, 3.7, 10, 1.6, 19.5, 0.8);
    F(c, RAMPS.metal.rim);
    rr(c, 2.8, 10.2, 3.4, 1.2, 0.6);
    F(c, "#3a3a44");
    rr(c, 1.6, 3.2, 5.8, 7.2, 1.2);
    F(c, RAMPS.gold.top);
    rr(c, 2.3, 3.9, 1.6, 4.6, 0.7);
    F(c, "rgba(255,255,255,.45)");
    rr(c, 1.6, 3.2, 5.8, 7.2, 1.2);
    stroke(c, "#2a2a32", 0.7);
    c.beginPath();
    c.moveTo(4.5, 3.4);
    c.lineTo(4.5, 10.2);
    stroke(c, "rgba(42,42,50,.55)", 0.45, "butt");
    poly(c, [[0.8, 3.4], [4.5, 0.6], [8.2, 3.4]]);
    F(c, RAMPS.metal.rim);
    ell(c, 4.5, 0.7, 0.7, 0.7);
    F(c, "#70707e");
  }),

  // A strip of turned soil with a row of blooms, pink, gold and white.
  flowerBed: painter(28, 12, (c) => {
    // A low mound of turned earth, not a trough: lit along its top lip,
    // falling into shade at the bottom with no hard edge there.
    ell(c, 14, 9.2, 13.4, 2.8);
    F(c, RAMPS.muck.top);
    ell(c, 14, 8.2, 12.4, 1.6);
    F(c, "rgba(255,225,180,.24)");
    for (let i = 0; i < 8; i += 1) {
      leaf(c, 3 + i * 3.4, 6.9, 1.5, 0.9, i % 2 ? 0.55 : -0.55, i % 2 ? "#4f9d46" : "#5fae52");
    }
    const petals = ["#ff7eb6", "#ffc844", "#fff5c2", "#ff7eb6", "#ffc844", "#fff5c2"];
    for (let i = 0; i < 6; i += 1) {
      const x = 3.8 + i * 4.1;
      const y = 3.2 + (i % 2) * 1.1;
      c.beginPath();
      c.moveTo(x, 6.8);
      c.lineTo(x, y + 0.6);
      stroke(c, "#4f9d46", 0.6);
      bloom(c, x, y, 1.15, petals[i], petals[i] === "#ffc844" ? "#a35a10" : "#f7d774");
    }
  }),

  // Two courses of dry stone, the bottom three big and the top two set
  // across their joints, with moss at the foot.
  stoneWall: painter(32, 10, (c) => {
    // Contact shade on the ground, then the dark core the stones are set
    // in: the seams between them are what keep the wall reading as stones
    // once the camera is far enough out to lose the shading on each.
    rr(c, 0.5, 7.6, 31, 2.4, 1.2);
    F(c, "rgba(25,45,15,.32)");
    rr(c, 0.8, 1.2, 30.4, 8.4, 2.6);
    F(c, "#454e55");
    stone(c, 0.5, 4.2, 10.5, 5.6);
    stone(c, 11.4, 3.8, 10.2, 6);
    stone(c, 22, 4.4, 9.5, 5.4);
    // The top course overhangs the bottom one and shades it.
    rr(c, 0.8, 4.8, 30.4, 1.8, 0.9);
    F(c, "rgba(20,30,40,.26)");
    stone(c, 5.2, 0.4, 10.6, 4.6);
    stone(c, 16.4, 0.6, 10.4, 4.4);
    ell(c, 8, 8.8, 2.6, 0.9);
    F(c, "rgba(80,140,50,.45)");
    ell(c, 25, 8.6, 2, 0.8);
    F(c, "rgba(80,140,50,.4)");
  }),

  // A sack head under a straw hat, a plaid shirt stuffed with straw, on a
  // cross post.
  scarecrow: painter(20, 36, (c) => {
    timber(c, 9.2, 12, 1.6, 24, 0.8);
    rr(c, 1.5, 15, 17, 1.5, 0.75);
    F(c, "#8a5a2c");
    for (const [x, d] of [[2.4, -1], [17.6, 1]] as const) {
      for (let k = 0; k < 4; k += 1) {
        c.beginPath();
        c.moveTo(x, 15.8);
        c.lineTo(x + d * (0.6 + k * 0.5), 17.6 + k * 0.5);
        stroke(c, "#e8c552", 0.6);
      }
    }
    rr(c, 2.6, 13.4, 5.8, 4.4, 1.8);
    F(c, "#5487d0");
    rr(c, 11.6, 13.4, 5.8, 4.4, 1.8);
    F(c, "#3e6bb0");
    rr(c, 5.6, 12.6, 8.8, 12, 3);
    F(c, RAMPS.water.top);
    for (const x of [8.2, 11.8]) {
      c.beginPath();
      c.moveTo(x, 13.2);
      c.lineTo(x, 24);
      stroke(c, "rgba(255,255,255,.18)", 0.6, "butt");
    }
    for (const y of [16.2, 20.2]) {
      c.beginPath();
      c.moveTo(6, y);
      c.lineTo(14, y);
      stroke(c, "rgba(220,60,60,.35)", 0.6, "butt");
    }
    for (const y of [15.6, 18.8, 22]) {
      ell(c, 10, y, 0.5, 0.5);
      F(c, "#f2e8c8");
    }
    for (let k = 0; k < 6; k += 1) {
      c.beginPath();
      c.moveTo(6.4 + k * 1.4, 24);
      c.lineTo(5.9 + k * 1.5 + (k % 2) * 0.4, 27.2);
      stroke(c, "#e8c552", 0.6);
    }
    rr(c, 8.4, 12, 3.2, 1.2, 0.6);
    F(c, "#c9443c");
    ell(c, 10, 8.4, 4.2, 4.4);
    F(c, RAMPS.path.top);
    ell(c, 10, 8.4, 4.2, 4.4);
    for (const x of [8.5, 11.5]) {
      ell(c, x, 8.2, 0.45, 0.45);
      F(c, "#3d2a14");
    }
    c.beginPath();
    c.arc(10, 9.4, 1.5, Math.PI * 0.2, Math.PI * 0.8);
    stroke(c, "#3d2a14", 0.45);
    ell(c, 10, 5.4, 7.2, 1.8);
    F(c, RAMPS.path.side);
    rr(c, 6.2, 0.8, 7.6, 5, 2.4);
    F(c, RAMPS.path.side);
    rr(c, 6.2, 3.6, 7.6, 1.3, 0.6);
    F(c, "#c9443c");
    ell(c, 10, 5.4, 7.2, 1.8);
    stroke(c, "rgba(90,60,20,.35)", 0.5);
    ell(c, 8.4, 1.9, 1.6, 0.6, -0.4);
    F(c, "rgba(255,255,255,.35)");
  }),

  // Grandfather Ray's fallback, drawn only until his own generated portrait
  // loads (see spriteBacked in stackacres-art.ts): straw hat, tan shirt,
  // brown bib overalls, boots -- tall and slender rather than square, the
  // one silhouette here built as a person rather than scenery.
  grandfatherRay: painter(20, 40, (c) => {
    for (const x of [6.4, 13.6]) {
      rr(c, x - 1.8, 37, 3.6, 3, 1.2);
      F(c, "#4a3324");
    }
    for (const x of [6.4, 13.6]) {
      rr(c, x - 1.9, 26, 3.8, 12, 1.4);
      F(c, "#6b4a30");
    }
    rr(c, 4.4, 15, 11.2, 13, 2.6);
    F(c, "#6b4a30");
    rr(c, 6.4, 12.4, 7.2, 5.6, 1.8);
    F(c, "#7a563a");
    for (const x of [3, 13.6]) {
      rr(c, x, 13.6, 3.4, 9, 1.6);
      F(c, "#e8dcc0");
    }
    for (const x of [6.6, 12.2]) {
      rr(c, x, 12.4, 1.2, 4, 0.5);
      F(c, "#5a3d26");
    }
    ell(c, 10, 8.2, 3.6, 4);
    F(c, "#8a5a3e");
    ell(c, 10, 5.6, 5.6, 1.7);
    F(c, "#d8b866");
    rr(c, 7.2, 1.6, 5.6, 4.4, 2.2);
    F(c, "#e6c878");
  }),

  /*
   * The farmhand, coming and going -- HIS UPPER BODY ONLY.
   *
   * Two pieces of art rather than one, and that is the whole reason this pair
   * exists: a mirror is a negative x scale (see `mirrorFor` in
   * stackacres-scene.ts) and can only ever express LEFT and RIGHT, so the two
   * screen directions a mirror cannot reach -- toward the camera and away
   * from it -- need a second drawing. `farmhand` x mirror gives SE and SW,
   * `farmhandBack` x mirror gives NE and NW: the four diagonals a 2:1 tile
   * has, off two painters and one sign. `Farmhand.towards` in
   * lib/stackacres/farmhand.ts picks between them.
   *
   * THESE STOP AT THE CROTCH, and there are no legs anywhere in this file.
   * The scene rigs them instead, from lib/stackacres/farmhand-walk.ts, so
   * they actually swing and bend -- a single frozen pose is what made the
   * first version read as a cardboard cutout being jiggled. The box and the
   * anchor are measured off the generated art these stand in front of (see
   * rig_farmhand.py): the anchor's y is the cut line and its x is the hip
   * midpoint, so placing one is just "put the pelvis here", and the two views
   * can carry their pelvis in different places inside their own box (they do).
   *
   * Built on Grandfather Ray's proportions deliberately -- the two are the
   * same species of silhouette. Everything else is pushed as far from Ray as
   * the palette allows, because at the opening shot they are thirteen pixels
   * tall and the only thing separating them is the outline. Ray is a straw
   * hat and earth tones; this is a peaked cap, a red shirt and blue denim.
   */
  farmhand: painter(
    11.375,
    25.625,
    (c) => {
      // Far arm first, a shade darker, so the near side reads as nearer.
      rr(c, 0.2, 12.4, 2.8, 8.2, 1.4);
      F(c, RAMPS.roof.rim);
      // The overalls run off the bottom of the box: the cut line is the hip,
      // and this denim carries on into the legs the scene draws.
      rr(c, 1.5, 13.6, 8, 12.1, 2.4);
      F(c, RAMPS.water.rim);
      // The shirt shows above the bib, which is what makes the torso two
      // colours rather than one flat block at a distance.
      rr(c, 1.2, 9.8, 8.6, 6.2, 2.2);
      F(c, RAMPS.roof.top);
      rr(c, 2.8, 12.4, 5.6, 4.4, 1.6);
      F(c, RAMPS.water.side);
      for (const x of [3.1, 7.3]) {
        rr(c, x, 10, 1.1, 3.2, 0.5);
        F(c, RAMPS.water.rim);
      }
      rr(c, 8.3, 12.8, 3, 8.2, 1.4);
      F(c, RAMPS.roof.side);

      ell(c, 5.5, 7, 3.4, 3.8);
      F(c, "#c08758");
      for (const x of [5.1, 7.3]) {
        ell(c, x, 7.4, 0.5, 0.7);
        F(c, "rgba(40,26,16,.8)");
      }
      // Peak first, crown over it, offset to the right: the peak is the one
      // shape carrying which way he is looking at thirteen pixels tall.
      ell(c, 6.8, 4.9, 3.9, 1.3);
      F(c, RAMPS.roof.rim);
      rr(c, 2.2, 1.2, 6.1, 4.3, 2.1);
      F(c, RAMPS.roof.side);
    },
    0.4725,
    1,
  ),

  // Walking away. No face, no bib (the overalls are one flat panel from
  // behind), and the straps cross -- the one detail that says "this is his
  // back" at a size where a face was never legible anyway.
  farmhandBack: painter(
    11.25,
    25.625,
    (c) => {
      rr(c, 0.2, 12.4, 2.8, 8.2, 1.4);
      F(c, RAMPS.roof.rim);
      rr(c, 1.6, 12.6, 8, 13.1, 2.4);
      F(c, RAMPS.water.rim);
      rr(c, 1.3, 9.8, 8.6, 4.6, 2);
      F(c, RAMPS.roof.top);
      c.beginPath();
      c.moveTo(3.2, 12.8);
      c.lineTo(7.8, 17.4);
      stroke(c, RAMPS.water.side, 1.1);
      c.beginPath();
      c.moveTo(7.8, 12.8);
      c.lineTo(3.2, 17.4);
      stroke(c, RAMPS.water.side, 1.1);
      rr(c, 8.2, 12.8, 3, 8.2, 1.4);
      F(c, RAMPS.roof.side);

      ell(c, 5.6, 7, 3.4, 3.8);
      F(c, "#c08758");
      rr(c, 2.7, 7.2, 5.8, 3, 1.5);
      F(c, "#5a3d26");
      // The cap's own back seam, and no peak: it is on the far side of his
      // head from here.
      ell(c, 5.6, 5.9, 3.7, 1.1);
      F(c, RAMPS.roof.rim);
      rr(c, 2.3, 1.5, 6.1, 4.4, 2.1);
      F(c, RAMPS.roof.side);
    },
    0.5667,
    1,
  ),

  /* ---- the woodland floor's litter, scattered by chunkScenery ---- */

  // A fallen log lying left to right with its sawn end toward the light.
  log: painter(22, 10, (c) => {
    rr(c, 0, 2.2, 19.5, 7.3, 3.6);
    F(c, RAMPS.muck.top);
    for (const y of [4.3, 6.1, 7.9]) {
      c.beginPath();
      c.moveTo(2, y);
      c.lineTo(17.5, y + 0.3);
      stroke(c, "rgba(40,20,5,.26)", 0.5, "butt");
    }
    ell(c, 7, 5.6, 1.4, 0.9);
    F(c, "#5a3618");
    ell(c, 7, 5.6, 0.6, 0.4);
    F(c, "#8a5a2c");
    rr(c, 1.5, 2.8, 15, 1.2, 0.6);
    F(c, "rgba(255,225,190,.22)");
    ell(c, 12, 2.9, 3.6, 1);
    F(c, "rgba(90,150,55,.6)");
    ell(c, 19, 5.9, 2.8, 3.6);
    F(c, RAMPS.wood.top);
    ell(c, 19, 5.9, 1.7, 2.2);
    stroke(c, "rgba(140,100,50,.5)", 0.45);
    ell(c, 19, 5.9, 0.7, 0.9);
    F(c, "#a67a48");
    ell(c, 19, 5.9, 2.8, 3.6);
    stroke(c, "#5a3618", 0.6);
  }),

  // Three toadstools, red caps with white spots, a big one between two small.
  mushroom: painter(12, 10, (c) => {
    const shroom = (x: number, base: number, r: number, tall: number) => {
      rr(c, x - r * 0.42, base - tall, r * 0.84, tall, r * 0.3);
      F(c, RAMPS.path.top);
      const cy = base - tall + r * 0.1;
      ell(c, x, cy, r, r * 0.62);
      F(c, RAMPS.roof.top);
      ell(c, x, cy, r, r * 0.62);
      for (const [dx, dy, dr] of [[-0.45, -0.15, 0.22], [0.25, -0.4, 0.2], [0.5, 0.12, 0.16]] as const) {
        ell(c, x + dx * r, cy + dy * r, dr * r, dr * r * 0.8);
        F(c, "#fff3e6");
      }
    };
    shroom(2.6, 10, 2.1, 2.6);
    shroom(9.6, 9.6, 2.3, 2.9);
    shroom(5.8, 9.4, 3.3, 4.2);
  }),

  // A boulder, bigger than `rock`: one lit mass with a crack and moss at
  // its foot.
  boulder: painter(26, 18, (c) => {
    const shape = () =>
      poly(c, [[1.5, 14.5], [2.5, 8], [6.5, 3], [13, 1], [20, 2.4], [24.5, 7], [25, 13], [22, 17], [6, 17.4]]);
    shape();
    F(c, RAMPS.metal.top);
    shape();
    c.beginPath();
    c.moveTo(15, 3.5);
    c.lineTo(13.5, 7.5);
    c.lineTo(15.5, 10.5);
    stroke(c, "rgba(40,50,60,.35)", 0.6);
    shape();
    c.save();
    c.clip();
    ell(c, 6, 14.8, 5, 2.4, 0.3);
    F(c, "rgba(90,150,55,.55)");
    ell(c, 20, 16, 3.6, 1.6);
    F(c, "rgba(90,150,55,.4)");
    c.restore();
    ell(c, 9, 4.8, 3.6, 1.8, -0.35);
    F(c, "rgba(255,255,255,.4)");
    shape();
    stroke(c, "rgba(40,50,60,.3)", 0.6);
  }),
};
