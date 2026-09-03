/**
 * The drawing shorthands every StackAcres art module paints with, and the
 * one light they all share.
 *
 * Split out of stackacres-art.ts so an area's own art module (art-paths.ts,
 * art-water.ts, art-props.ts) can import them without importing the file
 * that imports it back: stackacres-art.ts spreads those modules' painter
 * records into PAINTERS, and a module cycle that reads a `const` at
 * evaluation time throws. Nothing here touches Phaser.
 */

/** Device pixels per world unit in a baked texture. Eight is enough that the
 *  camera's 5x ceiling still samples the texture down rather than up. */
import type { Ramp } from "./art-palette";

export const ART_SCALE = 8;

/**
 * The frame every painter's picture lives in. A baked canvas is padded out to
 * a power of two (see `bakeTexture` in stackacres-art.ts), so the texture's
 * default `__BASE` frame is the padded box and would draw the painter
 * off-centre with a transparent margin; this frame is the painted region
 * alone, and every image in the scene is created against it.
 */
export const ART_FRAME = "art";

/** Device pixels per world unit in ground art: the grass tile, the paths,
 *  the pond. Lower than ART_SCALE because those are hundreds of units across
 *  and only ever seen as a backdrop. */
export const GRASS_PX = 4;

export type Ctx = CanvasRenderingContext2D;
export type Paint = (ctx: Ctx) => void;
export type Stop = readonly [number, string];
export type Point = readonly [number, number];

/** A painter draws itself into a canvas 2D context in unit coordinates,
 *  scaled up by the caller. `w`/`h` are its natural size in units; `ax`/`ay`
 *  are its origin as a fraction of that box (art elsewhere anchors most
 *  things by their feet: ax .5, ay 1). */
export interface Painter {
  (ctx: Ctx): void;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** Rounded rect, corner radius clamped so a fat radius on a thin box does not
 *  invert the arcs. */
export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

export function ell(c: Ctx, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  c.closePath();
}

export function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: readonly Stop[]) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, colour] of stops) g.addColorStop(offset, colour);
  return g;
}

export function rad(c: Ctx, x: number, y: number, r0: number, r1: number, stops: readonly Stop[]) {
  const g = c.createRadialGradient(x, y, r0, x, y, r1);
  for (const [offset, colour] of stops) g.addColorStop(offset, colour);
  return g;
}

export function F(c: Ctx, colour: string | CanvasGradient): void {
  c.fillStyle = colour;
  c.fill();
}

export function poly(c: Ctx, points: readonly Point[]): void {
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
}

export function stroke(c: Ctx, colour: string, width: number, cap: CanvasLineCap = "round"): void {
  c.strokeStyle = colour;
  c.lineWidth = width;
  c.lineCap = cap;
  c.lineJoin = "round";
  c.stroke();
}

export function leaf(c: Ctx, x: number, y: number, w: number, h: number, rot: number, colour: string): void {
  ell(c, x, y, w, h, rot);
  F(c, colour);
}

/** Hangs a painter's box and anchor off the draw function itself. */
export function painter(w: number, h: number, paint: Paint, ax = 0.5, ay = 1): Painter {
  const p = paint as Painter;
  p.w = w;
  p.h = h;
  p.ax = ax;
  p.ay = ay;
  return p;
}

/* ---- light ------------------------------------------------------------- */
// One sun for the whole farm, high and to the upper-left. Every painter lights
// its top-left and shades its bottom-right, and every ground shadow falls a
// little to the right of whatever casts it. Shading that agrees from one
// sprite to the next is most of what makes flat shapes read as one lit place
// rather than as stickers on a lawn.

/**
 * Lights the shape that is the current path as a rounded mass: a radial wash
 * from the upper-left that is `glow` there, clear through the middle and
 * `shade` at the far rim. Clipped to the path, so call it straight after the
 * `ell`/`rr` that drew the mass (a fill leaves the path in place).
 */
export function litMass(c: Ctx, cx: number, cy: number, rx: number, ry: number, shade: string, glow: string): void {
  c.save();
  c.clip();
  const lx = cx - rx * 0.42;
  const ly = cy - ry * 0.48;
  const g = c.createRadialGradient(lx, ly, 0, lx, ly, Math.max(rx, ry) * 1.75);
  g.addColorStop(0, glow);
  g.addColorStop(0.42, "rgba(0,0,0,0)");
  g.addColorStop(1, shade);
  c.fillStyle = g;
  c.fillRect(cx - rx - 2, cy - ry - 2, rx * 2 + 4, ry * 2 + 4);
  c.restore();
}

/* ---- flat-vector primitives --------------------------------------------
 * The shapes the whole world is built from, added with the 2026-09-03 flat
 * vector pass. Everything below draws FLAT fills with a hard tone boundary
 * and outlines in the material's own `rim` -- see art-palette.ts for why that
 * outline rule is the load-bearing one.
 *
 * These live here rather than in homestead-art.ts for the same reason `rr` and
 * `ell` do: art-props.ts and art-water.ts need them, and importing the module
 * that spreads their painters back into PAINTERS is a cycle that throws at
 * evaluation time.
 */

/**
 * A 2:1 isometric slab: the diamond top plus its two visible side faces.
 *
 * The diamond's height is always half its width, because that is
 * `isoProject`'s own ratio (lib/homestead/iso.ts) and not a stylistic choice --
 * a slab drawn at any other ratio sits at a different camera from the rest of
 * the scene. Faces draw before the top so the top's outline covers their seam.
 */
export function slab(c: Ctx, cx: number, cy: number, w: number, thick: number, mat: Ramp): void {
  const hw = w / 2;
  const hh = w / 4;
  const top: Point[] = [
    [cx, cy - hh],
    [cx + hw, cy],
    [cx, cy + hh],
    [cx - hw, cy],
  ];
  poly(c, [[cx - hw, cy], [cx, cy + hh], [cx, cy + hh + thick], [cx - hw, cy + thick]]);
  F(c, mat.side);
  poly(c, [[cx, cy + hh], [cx + hw, cy], [cx + hw, cy + thick], [cx, cy + hh + thick]]);
  F(c, mat.rim);
  poly(c, top);
  F(c, mat.top);
  poly(c, top);
  stroke(c, mat.rim, Math.max(0.6, w * 0.016));
}

/**
 * A rounded two-tone mass -- the shape most organic props are built from.
 *
 * Two flat ellipses, the lit one offset up and left toward the sun, rather
 * than one ellipse under a radial gradient. That offset IS the shading: it
 * costs one fill and it never blurs into the soft-render look the flat
 * direction exists to avoid.
 */
export function blob(c: Ctx, x: number, y: number, rx: number, ry: number, mat: Ramp): void {
  ell(c, x, y, rx, ry);
  F(c, mat.side);
  ell(c, x - rx * 0.12, y - ry * 0.16, rx * 0.84, ry * 0.8);
  F(c, mat.top);
}

/**
 * An upright box seen at the isometric 45: two walls meeting at the near
 * vertical corner, with the lit top plane over them. `w` is the half-width of
 * the footprint diamond, `h` the box's height in units.
 */
export function isoBox(c: Ctx, cx: number, cy: number, w: number, h: number, mat: Ramp): void {
  poly(c, [[cx - w, cy - h], [cx, cy - h + w / 2], [cx, cy + w / 2], [cx - w, cy]]);
  F(c, mat.side);
  poly(c, [[cx + w, cy - h], [cx, cy - h + w / 2], [cx, cy + w / 2], [cx + w, cy]]);
  F(c, mat.rim);
  const top: Point[] = [
    [cx, cy - h - w / 2],
    [cx + w, cy - h],
    [cx, cy - h + w / 2],
    [cx - w, cy - h],
  ];
  poly(c, top);
  F(c, mat.top);
  poly(c, top);
  stroke(c, mat.rim, Math.max(0.5, w * 0.05));
}

/**
 * A canopy of overlapping puffs: every puff's shaded body first, then every
 * puff's lit cap.
 *
 * Drawing it in two passes rather than shading each puff as it lands is what
 * stops the canopy reading as a heap of separate balls -- the lit caps land on
 * a single continuous dark mass, so the whole crown shares one light.
 */
export function canopy(c: Ctx, puffs: readonly (readonly [number, number, number])[], mat: Ramp): void {
  for (const [x, y, r] of puffs) {
    ell(c, x, y, r, r * 0.86);
    F(c, mat.side);
  }
  for (const [x, y, r] of puffs) {
    ell(c, x - r * 0.14, y - r * 0.18, r * 0.8, r * 0.7);
    F(c, mat.top);
  }
}

/** A three-stroke grass tuft. The middle blade takes the lit tone. */
export function blades(c: Ctx, x: number, y: number, h: number, mat: Ramp, width = 0.9): void {
  for (const i of [-1, 0, 1]) {
    c.beginPath();
    c.moveTo(x + i * h * 0.2, y);
    c.quadraticCurveTo(x + i * h * 0.3, y - h * 0.6, x + i * h * 0.47, y - h);
    stroke(c, i === 0 ? mat.top : mat.side, width);
  }
}

/** A five-petal flower, flat, centred on (x, y). The reference's own motif. */
export function bloom(c: Ctx, x: number, y: number, r: number, petal: string, heart: string): void {
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ell(c, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.62, r * 0.68, r * 0.5);
    F(c, petal);
  }
  ell(c, x, y, r * 0.4, r * 0.3);
  F(c, heart);
}
