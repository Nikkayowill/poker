// Types only: the Phaser runtime must not enter an art module (see the note
// at the top of stackacres-art.ts).
import type * as Phaser from "phaser";
import { ISO_K, projectedBounds } from "@/lib/stackacres/iso";
import { distanceToPath, pathBounds, type PathSpec } from "@/lib/stackacres/paths";
import { powerOfTwoCeil, seededRandom, type WorldPoint } from "@/lib/stackacres/world";
import { ART_FRAME, GRASS_PX, ell, F, lin, type Ctx } from "./art-kit";

/**
 * The farm's dirt paths, baked as ground art.
 *
 * A path is not a sprite: it is hundreds of units long and there is no box
 * to tile it from, so each one is baked ONCE into its own texture at
 * GRASS_PX (4) device pixels per unit -- the grass tile's density, since a
 * path is only ever seen as ground -- padded to a power of two like every
 * other texture here, and placed at its PROJECTED bbox at 1/GRASS_PX scale.
 * The bake itself happens in the camera's sheared space (see
 * `bakePathTexture`'s own header), not in the path's flat top-down layout,
 * so the strip agrees with the diamond-tiled ground it sits on rather than
 * being a flat sticker laid over a tilted world.
 *
 * The look is FarmVille's: a warm tan strip with a soft damp rim, a worn
 * lighter centre, dark grass lapping over both edges, and a row of round
 * cream stones a little way off ONE side. The polyline from lib/stackacres/
 * paths.ts is smoothed through its segments' midpoints, densified, and given
 * a slow seeded wobble along its normal, so no edge is a ruler line. The
 * wobble is tapered to nothing at both ends, which is what keeps a junction
 * exactly where the layout says it is.
 *
 * Junctions: a branch (the road, the track) starts inside the lane's body,
 * and its damp rim would otherwise paint a dark half-disc across the lane
 * where the two meet. So after its rim, a path repaints the body of every
 * path it branches off -- clipped to a disc around its own start, with the
 * same curve, gradient and mottles, so the pixels agree -- and only then
 * draws its own body over that. The body gradient runs in WORLD y for every
 * path, not along each path's own bbox, for the same reason: two strips that
 * meet must be the same tan where they meet.
 */

export interface PathBake {
  key: string;
  /** World position of the texture's top-left corner. */
  x: number;
  y: number;
}

interface CurvePoint {
  x: number;
  y: number;
  /** Unit normal: the tangent turned a quarter turn, (-ty, tx). */
  nx: number;
  ny: number;
  /** Arc length from the start, in units. */
  s: number;
}

/** Spacing of the densified curve, in units. Two is below anything the bake
 *  can resolve as a corner at 4 px per unit. */
const STEP = 2;

/** The one sun, as a direction the surface normal is dotted with. */
const SUN_X = -0.7071;
const SUN_Y = -0.7071;

const BODY_TOP = "#e2b262";
const BODY_BOTTOM = "#cc9a4e";

export function pathTextureKey(spec: PathSpec): string {
  return `path-${spec.key}`;
}

function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i += 1) h = (Math.imul(h, 33) ^ key.charCodeAt(i)) >>> 0;
  return h;
}

function mid(a: WorldPoint, b: WorldPoint): WorldPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The polyline smoothed through its midpoints and densified to STEP. */
function densify(points: readonly WorldPoint[]): WorldPoint[] {
  const out: WorldPoint[] = [];
  const line = (a: WorldPoint, b: WorldPoint) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
    for (let k = out.length === 0 ? 0 : 1; k <= n; k += 1) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  };
  const quad = (a: WorldPoint, ctrl: WorldPoint, b: WorldPoint) => {
    const n = Math.max(2, Math.ceil((Math.hypot(ctrl.x - a.x, ctrl.y - a.y) + Math.hypot(b.x - ctrl.x, b.y - ctrl.y)) / STEP));
    for (let k = 1; k <= n; k += 1) {
      const t = k / n;
      const u = 1 - t;
      out.push({
        x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
      });
    }
  };
  if (points.length < 3) {
    line(points[0], points[points.length - 1]);
    return out;
  }
  line(points[0], mid(points[0], points[1]));
  for (let i = 1; i < points.length - 1; i += 1) {
    quad(mid(points[i - 1], points[i]), points[i], mid(points[i], points[i + 1]));
  }
  line(mid(points[points.length - 2], points[points.length - 1]), points[points.length - 1]);
  return out;
}

function withNormals(points: readonly WorldPoint[]): CurvePoint[] {
  const out: CurvePoint[] = [];
  let s = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    if (i > 0) s += Math.hypot(p.x - prev.x, p.y - prev.y);
    out.push({ x: p.x, y: p.y, nx: -ty, ny: tx, s });
  }
  return out;
}

/**
 * The drawn centreline: smoothed, densified, then wobbled along its normal by
 * two slow sines seeded from the key. Amplitude about two units, tapered to
 * zero over the last twelve units at each end so the ends stay put.
 */
function pathCurve(spec: PathSpec): CurvePoint[] {
  const base = withNormals(densify(spec.points));
  const r = seededRandom(hashKey(spec.key));
  const phaseA = r() * Math.PI * 2;
  const phaseB = r() * Math.PI * 2;
  const amp = spec.width >= 14 ? 1.5 : 1.1;
  const total = base[base.length - 1].s;
  const wobbled: WorldPoint[] = base.map((p) => {
    const taper = Math.min(1, p.s / 12, (total - p.s) / 12);
    const w = amp * (Math.sin(p.s / 31 + phaseA) + 0.55 * Math.sin(p.s / 13.7 + phaseB)) * Math.max(0, taper);
    return { x: p.x + p.nx * w, y: p.y + p.ny * w };
  });
  return withNormals(wobbled);
}

function trace(c: Ctx, curve: readonly CurvePoint[]): void {
  c.beginPath();
  for (let i = 0; i < curve.length; i += 1) {
    if (i === 0) c.moveTo(curve[i].x, curve[i].y);
    else c.lineTo(curve[i].x, curve[i].y);
  }
}

function strokeCurve(c: Ctx, curve: readonly CurvePoint[], style: string | CanvasGradient, width: number): void {
  trace(c, curve);
  c.strokeStyle = style;
  c.lineWidth = width;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.stroke();
}

/** Softly darker, slightly blurred, a little wider than the body: the damp
 *  ground at the edge of a track rather than an outline around it. */
function paintRim(c: Ctx, curve: readonly CurvePoint[], width: number): void {
  c.save();
  c.shadowColor = "rgba(100,64,28,.5)";
  c.shadowBlur = 9;
  strokeCurve(c, curve, "rgba(176,122,60,.36)", width + 5);
  c.restore();
}

/**
 * The body, worn centre, edge light and the seeded mottling. `clear` says
 * whether a point is free to decorate -- false where another path's body
 * already is, so a branch never lays its own edge highlight across the strip
 * it grew out of.
 */
function paintBody(
  c: Ctx,
  spec: PathSpec,
  curve: readonly CurvePoint[],
  r: () => number,
  clear: (x: number, y: number) => boolean,
): void {
  const width = spec.width;
  strokeCurve(c, curve, lin(c, 0, -80, 0, 420, [[0, BODY_TOP], [1, BODY_BOTTOM]]), width);
  strokeCurve(c, curve, "rgba(255,236,190,.22)", width * 0.4);

  // Volume: the edge facing the sun catches a pale line, the edge facing away
  // falls into a soft shade. Both inset from the rim so the rim stays soft.
  // Each lit or shaded stretch is stroked as ONE path: a round-capped stroke
  // per two-unit step doubled its alpha at every join and read as a string
  // of beads along both edges.
  const inset = width / 2 - 1.7;
  for (const side of [1, -1]) {
    let run: CurvePoint[] = [];
    let runLit = 0;
    let runKind = 0;
    const flush = () => {
      if (runKind !== 0 && run.length >= 2) {
        const mean = runLit / (run.length - 1);
        c.beginPath();
        run.forEach((p, i) => {
          const x = p.x + p.nx * side * inset;
          const y = p.y + p.ny * side * inset;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        });
        c.strokeStyle =
          runKind > 0
            ? `rgba(255,244,210,${(0.3 * mean).toFixed(3)})`
            : `rgba(120,70,20,${(0.22 * -mean).toFixed(3)})`;
        c.lineWidth = 2.6;
        c.lineCap = "round";
        c.lineJoin = "round";
        c.stroke();
      }
      run = [];
      runLit = 0;
      runKind = 0;
    };
    for (let i = 1; i < curve.length; i += 1) {
      const a = curve[i - 1];
      const b = curve[i];
      const lit = (a.nx * side * SUN_X + a.ny * side * SUN_Y + b.nx * side * SUN_X + b.ny * side * SUN_Y) / 2;
      const kind = !clear(b.x, b.y) ? 0 : lit > 0.15 ? 1 : lit < -0.15 ? -1 : 0;
      if (kind !== runKind) {
        flush();
        if (kind !== 0) {
          runKind = kind;
          run.push(a);
        }
      }
      if (kind !== 0) {
        run.push(b);
        runLit += lit;
      }
    }
    flush();
  }

  // Mottling: a few darker and paler patches along the strip, so the tan is
  // trodden earth rather than a ribbon of one colour.
  const total = curve[curve.length - 1].s;
  const count = Math.floor(total / 14);
  for (let i = 0; i < count; i += 1) {
    const at = curve[Math.min(curve.length - 1, Math.floor((r() * total) / STEP))];
    const off = (r() * 2 - 1) * (width / 2 - 3);
    const rx = 2.5 + r() * 4;
    const ry = 1.2 + r() * 1.6;
    const rot = Math.atan2(-at.nx, at.ny) + (r() - 0.5) * 0.6;
    const dark = r() < 0.5;
    if (!clear(at.x, at.y)) continue;
    ell(c, at.x + at.nx * off, at.y + at.ny * off, rx, ry, rot);
    F(c, dark ? "rgba(150,100,45,.12)" : "rgba(255,240,200,.14)");
  }
}

function paintPebbles(c: Ctx, spec: PathSpec, curve: readonly CurvePoint[], r: () => number, clear: (x: number, y: number) => boolean): void {
  const total = curve[curve.length - 1].s;
  for (let i = 0; i < 6; i += 1) {
    const at = curve[Math.min(curve.length - 1, Math.floor((r() * total) / STEP))];
    const off = (r() * 2 - 1) * (spec.width / 2 - 3.5);
    const x = at.x + at.nx * off;
    const y = at.y + at.ny * off;
    const rad = 1.2 + r() * 0.6;
    if (!clear(x, y)) continue;
    ell(c, x + 0.4, y + 0.5, rad * 1.05, rad * 0.8);
    F(c, "rgba(90,60,20,.3)");
    ell(c, x, y, rad, rad * 0.78);
    F(c, lin(c, x - rad, y - rad, x + rad, y + rad, [[0, "#ead8b2"], [0.6, "#b9976a"], [1, "#7f5f3c"]]));
  }
}

/**
 * The soft edge. Two things, both sparse and both seeded: lawn-coloured laps
 * that sit over the rim and bite into it, so the edge is grass growing up to
 * the dirt rather than a line drawn round it; and a few dark blades leaning
 * in over the tan, low and diagonal. The first cut of this was blades alone,
 * every seven units on both sides, and it read as a picket fence.
 */
function paintTufts(c: Ctx, spec: PathSpec, curve: readonly CurvePoint[], r: () => number, clear: (x: number, y: number) => boolean): void {
  const total = curve[curve.length - 1].s;
  const half = spec.width / 2;
  const at = (s: number) => curve[Math.min(curve.length - 1, Math.max(0, Math.floor(s / STEP)))];

  for (let s = 3 + r() * 6; s < total - 3; s += 5 + r() * 6) {
    const p = at(s);
    const tx = p.ny;
    const ty = -p.nx;
    for (const side of [1, -1]) {
      if (r() < 0.35) continue;
      const out = half + 1.2 + r() * 1.6;
      const x = p.x + p.nx * side * out;
      const y = p.y + p.ny * side * out;
      if (!clear(x, y)) continue;
      const rot = Math.atan2(ty, tx) + (r() - 0.5) * 0.5;
      ell(c, x, y, 2.2 + r() * 2.6, 1.1 + r() * 0.9, rot);
      // A shade under the grass tile's base fill (#86c96e): the tile's sun
      // sweeps and mottles average darker than its base, and a lap in the
      // bare base colour sat on the lawn as a pale mint blob.
      F(c, r() < 0.5 ? "rgba(126,192,104,.92)" : "rgba(114,182,94,.9)");
    }
  }

  for (let s = 5 + r() * 8; s < total - 4; s += 11 + r() * 9) {
    const p = at(s);
    const tx = p.ny;
    const ty = -p.nx;
    for (const side of [1, -1]) {
      if (r() < 0.45) continue;
      const bx = p.x + p.nx * side * (half + 0.2);
      const by = p.y + p.ny * side * (half + 0.2);
      if (!clear(bx, by)) continue;
      const blades = 1 + (r() < 0.4 ? 1 : 0);
      const tone = r() < 0.5 ? "rgba(79,122,18,.75)" : "rgba(98,146,30,.75)";
      // One lean per cluster: two blades leaning apart read as a tick mark.
      const way = r() < 0.5 ? -1 : 1;
      for (let j = 0; j < blades; j += 1) {
        const along = (j - (blades - 1) / 2) * 1.4 + (r() - 0.5) * 0.9;
        const height = 1.8 + r() * 1.2;
        const lean = way * (1.4 + r() * 1.2);
        const x0 = bx + tx * along;
        const y0 = by + ty * along;
        const x1 = x0 - p.nx * side * height + tx * lean;
        const y1 = y0 - p.ny * side * height + ty * lean;
        c.beginPath();
        c.moveTo(x0, y0);
        c.quadraticCurveTo(x0 - p.nx * side * height * 0.6, y0 - p.ny * side * height * 0.6, x1, y1);
        c.strokeStyle = tone;
        c.lineWidth = 1;
        c.lineCap = "round";
        c.stroke();
      }
    }
  }
}

/** The parcel stones: round cream discs every nine units, five outside the
 *  body on one side, each with a soft halo to the lower-right. */
function paintStones(c: Ctx, spec: PathSpec, curve: readonly CurvePoint[], r: () => number, clear: (x: number, y: number) => boolean): void {
  if (spec.stones === 0) return;
  const total = curve[curve.length - 1].s;
  const out = spec.width / 2 + 5;
  for (let s = Math.max(6, spec.stonesFrom ?? 0); s < total - 3; s += 9) {
    const at = curve[Math.min(curve.length - 1, Math.floor(s / STEP))];
    const x = at.x + at.nx * spec.stones * out + (r() - 0.5) * 1.4;
    const y = at.y + at.ny * spec.stones * out + (r() - 0.5) * 1.4;
    const rad = 1.6 * (0.88 + r() * 0.24);
    if (!clear(x, y)) continue;
    ell(c, x + 0.6, y + 0.6, rad + 0.6, rad + 0.6);
    F(c, "rgba(90,60,20,.25)");
    ell(c, x, y, rad, rad);
    F(c, "rgba(255,246,216,.88)");
    ell(c, x - rad * 0.3, y - rad * 0.3, rad * 0.45, rad * 0.3, -0.6);
    F(c, "rgba(255,255,255,.5)");
  }
}

/**
 * Bakes one path into a power-of-two texture and returns where to place it.
 * `under` is every path drawn before this one that it may branch off; their
 * bodies are repainted around this path's start so no rim lands on them.
 * Returns null only if the bake would exceed 4096 px a side, which
 * paths.test.ts rules out for FARM_PATHS.
 *
 * The canvas is baked directly in the isometric camera's SHEARED space, not
 * in the path's own flat top-down coordinates. Every draw call below still
 * hands in plain world (x, y) -- the curve, the stones, the tufts, all of it
 * -- exactly as before; what changed is a single `c.transform` inserted
 * ahead of them that carries `isoProject`'s own shear (see ./iso.ts) into
 * the canvas's transform matrix, so the rasterizer projects each shape as it
 * draws it. That is what makes this path agree with the diamond-tiled ground
 * and every other object in the scene instead of sitting on top of them as a
 * flat, un-tilted sticker -- the flat bake was what read as the path
 * "wandering": its screen-space angles didn't correspond to the world's real
 * (sheared) directions at all, most visibly wherever the polyline turned.
 * `pathBounds`' own padding maths (world-space, unaffected by this) stays
 * valid under the shear: an offset of at most `pad` along a unit normal
 * changes world x and y by at most `pad` each, and isoProject is linear, so
 * bounding the pre-shear rect is still a safe bound after it.
 *
 * The projected footprint of a padded world rect can be noticeably bigger
 * than the rect itself -- isoProject's matrix has singular values sqrt(2)
 * and 1/sqrt(2), so a diagonal running close to its stretched eigen-
 * direction (world (1,-1)) can grow by up to sqrt(2)x on screen. `road`'s
 * own north-east curve runs close to exactly that direction, which is why
 * the cap here is 4096 rather than the 2048 the flat bake got away with --
 * comfortably inside what WebGL guarantees, and still a fraction of what any
 * of this scene's other baked textures cost.
 */
export function bakePathTexture(scene: Phaser.Scene, spec: PathSpec, under: readonly PathSpec[]): PathBake | null {
  const key = pathTextureKey(spec);
  const box = projectedBounds(pathBounds(spec));
  if (scene.textures.exists(key)) return { key, x: box.x, y: box.y };
  const wpx = Math.ceil(box.width * GRASS_PX);
  const hpx = Math.ceil(box.height * GRASS_PX);
  const texW = powerOfTwoCeil(wpx);
  const texH = powerOfTwoCeil(hpx);
  if (texW > 4096 || texH > 4096) {
    console.warn(`stackacres: path ${spec.key} would bake at ${texW}x${texH}; skipped`);
    return null;
  }
  const texture = scene.textures.createCanvas(key, texW, texH);
  if (!texture) return null;
  const c = texture.context;
  c.save();
  c.scale(GRASS_PX, GRASS_PX);
  c.translate(-box.x, -box.y);
  // isoProject(x, y) = ((x - y) * ISO_K, (x + y) * ISO_K / 2) -- the same
  // matrix, applied to the canvas's transform instead of to each point by
  // hand, so every subsequent draw call below (still expressed in plain
  // world coordinates) lands where isoProject would put it.
  c.transform(ISO_K, ISO_K / 2, -ISO_K, ISO_K / 2, 0, 0);

  const curve = pathCurve(spec);
  const clear = (x: number, y: number) => under.every((u) => distanceToPath(x, y, u) >= u.width / 2 + 3);
  // Stones keep out of another path's stone band too, or the lane's row and
  // the track's row pile up where the two start together at the corner.
  const clearOfStones = (x: number, y: number) =>
    under.every((u) => distanceToPath(x, y, u) >= u.width / 2 + 9);

  paintRim(c, curve, spec.width);

  // The junction repaint (see the header): the lane's body back over this
  // path's rim, within reach of this path's own start cap and rim.
  if (under.length > 0) {
    const start = spec.points[0];
    const reach = spec.width + 14;
    c.save();
    ell(c, start.x, start.y, reach, reach);
    c.clip();
    for (const u of under) {
      paintBody(c, u, pathCurve(u), seededRandom(hashKey(u.key)), () => true);
    }
    c.restore();
  }

  const r = seededRandom(hashKey(spec.key));
  paintBody(c, spec, curve, r, clear);
  paintPebbles(c, spec, curve, r, clear);
  paintTufts(c, spec, curve, r, clear);
  paintStones(c, spec, curve, r, clearOfStones);

  c.restore();
  texture.add(ART_FRAME, 0, 0, 0, wpx, hpx);
  texture.refresh();
  return { key, x: box.x, y: box.y };
}
