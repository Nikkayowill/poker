// Types only: the Phaser runtime must not enter an art module (see the note
// at the top of stackacres-art.ts).
import type * as Phaser from "phaser";
import { POND, POND_SAND, pondBounds, type Ellipse } from "@/lib/stackacres/water";
import { powerOfTwoCeil, seededRandom } from "@/lib/stackacres/world";
import {
  ART_FRAME,
  GRASS_PX,
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
 * The pond, and everything that lives on it.
 *
 * Two kinds of picture. The pond itself is ground art like a path: one
 * texture baked at GRASS_PX (4) device pixels per unit covering the water,
 * its sand ring and the seam the sand feathers into the lawn with, placed
 * once at its world box just above the paths. Everything on the water --
 * the dock, the lily pads, the reeds, the glints the sun throws, the
 * ripples, the duck -- is an ordinary painter baked at ART_SCALE and placed
 * as a sprite, because those are the things that move or sort by depth.
 *
 * The look is FarmVille's, measured off the reference frames rather than
 * remembered: from the lawn inward it goes grass, a BRIGHT yellow sand ring
 * (not beige, not a mud ring), a thin dark wet line at the waterline, then
 * water that is deep teal in the middle and pale at the edge, with the bank
 * throwing a soft shadow onto the water along the sun side and white
 * lozenge glints on the same side. One sun, high and upper-left: every prop
 * here is lit there and shaded lower-right, and what sits on the water
 * throws its shadow onto it offset down and right.
 */

export type WaterPainterName = "glint" | "ripple" | "lily" | "lilyFlower" | "reeds" | "dock" | "duck";

/** The pond texture's key. Not a painter: it is baked by `bakePondTexture`
 *  at ground density, like the paths. */
export const POND_TEXTURE_KEY = "pond";

export interface PondBake {
  key: string;
  /** World position of the texture's top-left corner. */
  x: number;
  y: number;
}

const TAU = Math.PI * 2;

/** A soft-edged ellipse: a radial fade from `inner` at the centre to `outer`
 *  at the rim, in the ellipse's own space so the fade follows both axes. */
function softBlob(c: Ctx, x: number, y: number, rx: number, ry: number, rot: number, inner: string, outer: string): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(rx, ry);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  c.beginPath();
  c.arc(0, 0, 1, 0, TAU);
  c.fillStyle = g;
  c.fill();
  c.restore();
}

/**
 * Paints the whole pond in world units: sand, wet line, water, and the
 * baked-in detail (bank shadow, depth, still glints). Deterministic: every
 * wobble and blotch comes from `r`.
 */
function paintPond(c: Ctx, pond: Ellipse, r: () => number): void {
  const { x: cx, y: cy, rx, ry } = pond;
  const sand = POND_SAND;

  // The sand ring's outer edge: the water's ellipse pushed out by the ring's
  // width, with a slow seeded wobble of up to about three units so it is a
  // shore and not a drawn oval.
  const phaseA = r() * TAU;
  const phaseB = r() * TAU;
  const phaseC = r() * TAU;
  const wobble = (a: number) =>
    1.6 * Math.sin(3 * a + phaseA) + 1.2 * Math.sin(5 * a + phaseB) + 0.6 * Math.sin(8 * a + phaseC);
  const ring = () => {
    c.beginPath();
    const n = 96;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * TAU;
      const w = wobble(a);
      const x = cx + (rx + sand + w) * Math.cos(a);
      const y = cy + (ry + sand + w) * Math.sin(a);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  };

  // 1. Sand, feathered into the lawn: a soft green-shadow halo under the
  // ring's edge, then a faint seam over the edge itself, so the lawn reads
  // as lapping over the sand rather than the sand being cut out of it.
  c.save();
  c.shadowColor = "rgba(60,90,20,.45)";
  c.shadowBlur = 10;
  ring();
  F(c, "#f0d266");
  c.restore();
  ring();
  stroke(c, "rgba(60,90,20,.18)", 3);

  // Volume on the sand: lit at the upper-left, a shade darker lower-right,
  // and speckled so it is grit rather than a flat yellow band.
  ring();
  c.save();
  c.clip();
  c.fillStyle = lin(c, cx - rx, cy - ry, cx + rx, cy + ry, [
    [0, "rgba(255,250,225,.22)"],
    [0.5, "rgba(255,250,225,0)"],
    [1, "rgba(185,125,40,.18)"],
  ]);
  c.fillRect(cx - rx - sand - 6, cy - ry - sand - 6, (rx + sand + 6) * 2, (ry + sand + 6) * 2);
  for (let i = 0; i < 70; i += 1) {
    const a = r() * TAU;
    const t = r();
    const x = cx + (rx + 1.5 + t * (sand - 1.5)) * Math.cos(a);
    const y = cy + (ry + 1.5 + t * (sand - 1.5)) * Math.sin(a);
    const k = 0.3 + r() * 0.35;
    ell(c, x, y, k, k * 0.8);
    F(c, r() < 0.7 ? "rgba(160,120,50,.35)" : "rgba(255,255,240,.55)");
  }
  c.restore();

  // 2. The waterline, inside the sand: a soft damp band, then the wet line.
  ell(c, cx, cy, rx + 2.4, ry + 2.4);
  stroke(c, "rgba(185,138,63,.26)", 3.4);
  ell(c, cx, cy, rx + 0.9, ry + 0.9);
  stroke(c, "rgba(185,138,63,.6)", 1.6);

  // 3. Water. Deep in the middle, paler toward the shallows; the gradient is
  // built in the ellipse's own space so it follows the shore on both axes.
  ell(c, cx, cy, rx, ry);
  c.save();
  c.clip();
  c.save();
  c.translate(cx, cy);
  c.scale(rx, ry);
  const water = c.createRadialGradient(-0.06, 0.04, 0, 0, 0, 1);
  water.addColorStop(0, "#2a6a85");
  water.addColorStop(0.52, "#387b94");
  water.addColorStop(0.88, "#5bb0b3");
  water.addColorStop(1, "#78c6bf");
  c.fillStyle = water;
  c.fillRect(-1.1, -1.1, 2.2, 2.2);
  c.restore();

  // The pale shallows at the very edge.
  ell(c, cx, cy, rx - 1, ry - 1);
  stroke(c, "rgba(143,217,211,.85)", 2);
  ell(c, cx, cy, rx - 2.8, ry - 2.8);
  stroke(c, "rgba(143,217,211,.35)", 2);

  // The bank's shadow on the water: the sun is upper-left, so the north-west
  // shore shades the water just inside it. The crescent between the water's
  // edge and the same ellipse shifted down-right, blurred inward.
  c.save();
  c.shadowColor = "rgba(15,45,65,.6)";
  c.shadowBlur = 14;
  c.beginPath();
  c.rect(cx - rx - 6, cy - ry - 6, (rx + 6) * 2, (ry + 6) * 2);
  c.ellipse(cx + 4, cy + 5.5, rx, ry, 0, 0, TAU);
  c.fillStyle = "rgba(15,45,65,.38)";
  c.fill("evenodd");
  c.restore();

  // The surface: a few pale streaks lying with the wind, mostly across the
  // far half, so the water has a grain and not only a gradient.
  for (let i = 0; i < 9; i += 1) {
    const a = r() * TAU;
    const t = 0.15 + Math.sqrt(r()) * 0.7;
    const x = cx + rx * t * Math.cos(a);
    const y = cy + ry * t * Math.sin(a) + 4;
    const w = 5 + r() * 9;
    ell(c, x, y, w, 0.5, (r() - 0.5) * 0.12);
    F(c, "rgba(200,240,240,.16)");
  }

  // Depth: a few darker patches under the surface, soft-edged.
  for (let i = 0; i < 5; i += 1) {
    const a = r() * TAU;
    const t = Math.sqrt(r()) * 0.6;
    const x = cx + rx * t * Math.cos(a);
    const y = cy + ry * t * Math.sin(a);
    softBlob(c, x, y, 8 + r() * 7, 4 + r() * 3, (r() - 0.5) * 0.8, "rgba(40,95,119,.4)", "rgba(40,95,119,0)");
  }

  // The sky in the water: a faint paler wash across the far half.
  softBlob(c, cx + rx * 0.22, cy + ry * 0.28, rx * 0.62, ry * 0.5, -0.25, "rgba(190,235,235,.11)", "rgba(190,235,235,0)");

  // A bright rim where the sun catches the far shore's water.
  ell(c, cx, cy, rx - 0.6, ry - 0.6);
  c.strokeStyle = lin(c, cx - rx, cy - ry, cx + rx, cy + ry, [
    [0, "rgba(255,255,255,0)"],
    [0.55, "rgba(255,255,255,0)"],
    [1, "rgba(255,255,255,.32)"],
  ]);
  c.lineWidth = 1;
  c.stroke();

  // Still glints on the sun side, under the drifting ones the scene adds.
  for (let i = 0; i < 7; i += 1) {
    const a = Math.PI * (0.95 + r() * 0.65);
    const t = 0.3 + r() * 0.55;
    const x = cx + rx * t * Math.cos(a);
    const y = cy + ry * t * Math.sin(a);
    ell(c, x, y, 2 + r() * 2.5, 0.6);
    F(c, "rgba(223,248,255,.5)");
  }
  c.restore();
}

/**
 * Bakes the pond into one power-of-two texture at GRASS_PX and returns where
 * to place it. Returns null only if the bake would exceed 2048 px a side,
 * which water.test.ts rules out for POND.
 */
export function bakePondTexture(scene: Phaser.Scene): PondBake | null {
  const key = POND_TEXTURE_KEY;
  const box = pondBounds();
  if (scene.textures.exists(key)) return { key, x: box.x, y: box.y };
  const wpx = Math.ceil(box.width * GRASS_PX);
  const hpx = Math.ceil(box.height * GRASS_PX);
  const texW = powerOfTwoCeil(wpx);
  const texH = powerOfTwoCeil(hpx);
  if (texW > 2048 || texH > 2048) {
    console.warn(`stackacres: pond would bake at ${texW}x${texH}; skipped`);
    return null;
  }
  const texture = scene.textures.createCanvas(key, texW, texH);
  if (!texture) return null;
  const c = texture.context;
  c.save();
  c.scale(GRASS_PX, GRASS_PX);
  c.translate(-box.x, -box.y);
  paintPond(c, POND, seededRandom(0x2a0b_77d1));
  c.restore();
  texture.add(ART_FRAME, 0, 0, 0, wpx, hpx);
  texture.refresh();
  return { key, x: box.x, y: box.y };
}

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
