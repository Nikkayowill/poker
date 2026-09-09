import {
  ell,
  F,
  leaf,
  lin,
  painter,
  poly,
  rr,
  stroke,
  type Ctx,
  type Painter,
} from "./art-kit";
import { RAMPS } from "./art-palette";

/**
 * Everything that lives on the pond.
 *
 * The pond itself -- its water, shallows and sand -- is terrain now, cut
 * from the pack's tiles by lib/stackacres/terrain.ts and baked with the
 * roads and the shore (art-terrain.ts). What is left here is what sits ON
 * the water: the dock, the lily pads, the reeds, the glints the sun throws,
 * the ripples, the duck -- each an ordinary painter baked at ART_SCALE and
 * placed as a sprite, because those are the things that move or sort by
 * depth.
 *
 * One sun, high and upper-left: every prop here is lit there and shaded
 * lower-right, and what sits on the water throws its shadow onto it offset
 * down and right.
 */

export type WaterPainterName = "glint" | "ripple" | "lily" | "lilyFlower" | "reeds" | "dock" | "duck";

const TAU = Math.PI * 2;

/* ---- the things on the water ------------------------------------------ */

/** The lily pad's outline: a flat oval with a notch toward the viewer. */
function padPath(c: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  c.beginPath();
  c.moveTo(cx, cy);
  c.ellipse(cx, cy, rx, ry, 0, Math.PI / 2 + 0.36, Math.PI / 2 - 0.36 + TAU);
  c.closePath();
}

/** A blade of reed: a tapered leaf from the base to its tip, bowed a little. */
function blade(c: Ctx, bx: number, by: number, tx: number, ty: number, w: number, bend: number, colour: string): void {
  const mx = (bx + tx) / 2 + bend;
  const my = (by + ty) / 2;
  c.beginPath();
  c.moveTo(bx - w / 2, by);
  c.quadraticCurveTo(mx - w / 2, my, tx, ty);
  c.quadraticCurveTo(mx + w / 2, my, bx + w / 2, by);
  c.closePath();
  F(c, colour);
}

export const WATER_PAINTERS: Record<WaterPainterName, Painter> = {
  // A lozenge of sun on the water, fading out along its length so the ends
  // never cut off hard.
  glint: painter(
    8,
    2.5,
    (c) => {
      ell(c, 4, 1.25, 4, 1.25);
      F(
        c,
        RAMPS.water.top,
      );
    },
    0.5,
    0.5,
  ),

  // A ring that the scene grows and fades.
  ripple: painter(
    24,
    12,
    (c) => {
      ell(c, 12, 6, 11.2, 5.4);
      stroke(c, "rgba(225,250,255,.55)", 0.9);
      ell(c, 12, 6, 8, 3.8);
      stroke(c, "rgba(225,250,255,.28)", 0.6);
    },
    0.5,
    0.5,
  ),

  // The pad: notch toward the viewer, lit upper-left, its own contact shade
  // on the water down and to the right.
  lily: painter(
    10,
    9,
    (c) => {
      const cx = 4.6;
      const cy = 3.8;
      const rx = 4.3;
      const ry = 3.1;
      ell(c, cx + 0.7, cy + 0.9, rx, ry);
      F(c, "rgba(20,50,60,.3)");
      padPath(c, cx, cy, rx, ry);
      F(c, "#6fbf45");
      padPath(c, cx, cy, rx, ry);
      for (const a of [-2.3, -1.2, 0.2, 1.3]) {
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * rx * 0.85, cy + Math.sin(a) * ry * 0.85);
        stroke(c, "rgba(255,255,255,.16)", 0.35);
      }
      padPath(c, cx, cy, rx, ry);
      stroke(c, "#4d9a2e", 0.7);
    },
    4.6 / 10,
    3.8 / 9,
  ),

  lilyFlower: painter(
    6,
    6,
    (c) => {
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * TAU + 0.3;
        leaf(c, 3 + Math.cos(a) * 1.65, 3 + Math.sin(a) * 1.65, 1.35, 0.85, a, "#ff8fbf");
      }
      for (let k = 0; k < 5; k += 1) {
        const a = (k / 5) * TAU;
        leaf(c, 3 + Math.cos(a) * 0.95, 3 + Math.sin(a) * 0.95, 0.95, 0.6, a, "#ffd6e8");
      }
      ell(c, 3, 3, 0.7, 0.7);
      F(c, "#ffd23f");
      // The petals facing away from the sun.
      ell(c, 3, 3, 3, 3);
    },
    0.5,
    0.5,
  ),

  // A stand of reeds on the shore: leaves fanning from the base and two
  // stalks carrying cattail heads. Anchored at its feet.
  reeds: painter(
    12,
    24,
    (c) => {
      // Contact shade on the sand.
      ell(c, 6.8, 23.2, 4.2, 1.2);
      F(c, "rgba(90,70,20,.22)");
      blade(c, 4.6, 24, 1.2, 4, 1.5, -1.2, "#5e8a25");
      blade(c, 7.6, 24, 11.2, 6, 1.4, 1.6, "#5e8a25");
      blade(c, 5.4, 24, 3.6, 9.5, 1.2, -0.4, "#7aa832");
      blade(c, 6.6, 24, 8.4, 1.2, 1.5, 0.9, "#86b53a");
      for (const [x, top, hh] of [[6.2, 2, 4], [9.4, 7, 3.2]] as const) {
        c.beginPath();
        c.moveTo(x - 0.3, 24);
        c.quadraticCurveTo(x - 0.5, top + 12, x, top + hh);
        stroke(c, "#8aa63a", 0.6);
        rr(c, x - 0.7, top, 1.4, hh, 0.7);
        F(c, RAMPS.soil.rim);
        rr(c, x - 0.45, top + 0.3, 0.45, hh * 0.55, 0.25);
        F(c, "rgba(255,220,180,.35)");
      }
    },
    0.5,
    1,
  ),

  // The dock: planks running across the deck, a south face for thickness,
  // posts standing in the water and a bollard at the far end. Anchored at
  // the EAST end of the deck, at the posts' feet, so `put("dock", DOCK.x,
  // DOCK.y)` roots it on the sand and reaches it west over the water. Its
  // shadow on the water is baked in, offset down and right.
  dock: painter(
    38,
    24,
    (c) => {
      rr(c, 2, 7, 34, 14, 1.5);
      F(c, "rgba(20,50,60,.35)");
      for (const x of [3, 17, 31]) {
        rr(c, x - 1.5, 12, 3, 10, 1.2);
        F(c, RAMPS.soil.rim);
        rr(c, x - 1.8, 20.4, 3.6, 1.8, 0.9);
        F(c, "rgba(15,40,50,.35)");
      }
      rr(c, 0, 4, 34, 14, 1.6);
      F(c, "#8a5a2c");
      let k = 0;
      for (let x = 0.4; x < 33.6; x += 3.4) {
        rr(c, x, 4.35, 3, 13.3, 0.5);
        F(c, k % 2 === 0 ? "#c99a5a" : "#b5834a");
        k += 1;
      }
      rr(c, 0, 4, 34, 14, 1.6);
      c.save();
      c.clip();
      c.fillStyle = lin(c, 0, 4, 34, 18, [
        [0, "rgba(255,245,210,.24)"],
        [0.45, "rgba(255,245,210,0)"],
        [1, "rgba(70,35,10,.24)"],
      ]);
      c.fillRect(0, 4, 34, 14);
      c.restore();
      rr(c, 0, 17.2, 34, 2.6, 0.8);
      F(c, "#8a5a2c");
      rr(c, 0, 18.8, 34, 1, 0.5);
      F(c, "rgba(0,0,0,.22)");
      c.beginPath();
      c.moveTo(1, 4.4);
      c.lineTo(33, 4.4);
      stroke(c, "rgba(255,255,255,.3)", 0.6);
      // The bollard at the far end, and its shadow across the deck.
      ell(c, 4.6, 5.4, 2.6, 1);
      F(c, "rgba(60,30,10,.25)");
      rr(c, 1.5, 0, 3, 7.4, 1.2);
      F(c, RAMPS.soil.side);
      ell(c, 3, 0.7, 1.5, 0.7);
      F(c, "#c08650");
    },
    34 / 38,
    22 / 24,
  ),

  // A white duck, facing east (the art's own way); the scene flips it when
  // it paddles west. Anchored at the waterline under its belly.
  duck: painter(
    14,
    11,
    (c) => {
      ell(c, 6.5, 9.4, 6.2, 1.4);
      stroke(c, "rgba(230,250,255,.55)", 0.5);
      ell(c, 6.5, 9.8, 5.2, 1.2);
      F(c, "rgba(20,50,60,.22)");
      poly(c, [[1.6, 6.2], [0.2, 3.4], [3.4, 6.6]]);
      F(c, "#f2efe4");
      ell(c, 6.2, 7.2, 5.2, 2.9);
      F(c, RAMPS.cream.top);
      ell(c, 5.6, 7.5, 3.1, 1.6, -0.15);
      F(c, "rgba(120,120,100,.2)");
      ell(c, 6.2, 7.2, 5.2, 2.9);
      rr(c, 9.2, 3.6, 2.4, 4.4, 1.1);
      F(c, "#f6f4ec");
      ell(c, 10.6, 3.4, 2.5, 2.3);
      F(c, "#fefefa");
      ell(c, 10.6, 3.4, 2.5, 2.3);
      poly(c, [[12.6, 2.9], [14, 3.9], [12.6, 4.8]]);
      F(c, "#f4a020");
      ell(c, 11.5, 2.9, 0.45, 0.45);
      F(c, "#2b2b2b");
    },
    0.5,
    1,
  ),
};
