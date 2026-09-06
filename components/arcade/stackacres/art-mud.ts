// Types only: the Phaser runtime must not enter an art module (see the note
// at the top of stackacres-art.ts).
import type * as Phaser from "phaser";
import { ISO_K, projectedBounds } from "@/lib/stackacres/iso";
import { powerOfTwoCeil, seededRandom, type WorldPoint, type WorldRect, type YardMat } from "@/lib/stackacres/world";
import { ART_FRAME, GRASS_PX, ell, F, lin, type Ctx } from "./art-kit";
import type { PathBake } from "./art-paths";

/**
 * The muddy yard mats: the churned, trodden ground a barn, a greenhouse and
 * a hen pen stand in (lib/stackacres/world.ts's `YARD_MATS`), baked once
 * each as ground art the way the paths are and laid under them.
 *
 * A mat is deliberately not a rectangle. Its outline is the mat's own rect
 * pushed out into a rounded superellipse and then wandered by three seeded
 * sines around its perimeter, so no two mats share a silhouette and none
 * has a straight side; the edge is then feathered outward in translucent,
 * blurred steps exactly as a road's margin is (art-paths.ts), so the mud
 * bleeds into the lawn rather than stopping at it. Over the body: darker
 * mottles, a few wet puddles catching a pale glint, and a pair of wheel
 * ruts running the long way, so it reads as a worked yard rather than a
 * brown blob. Slightly darker and colder than a road's tan on purpose: the
 * road is packed and dry, the yard is where the water and the animals are.
 *
 * Baked in the camera's sheared space at GRASS_PX like a path, for the same
 * reason (see `bakePathTexture`'s header).
 */

const MUD_TOP = "#c99655";
const MUD_BOTTOM = "#a67a42";

/** Points around the outline. */
const OUTLINE_STEPS = 96;

/** Superellipse exponent: 2 is an ellipse, higher squares the corners. */
const CORNER_POWER = 3.2;

function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i += 1) h = (Math.imul(h, 33) ^ key.charCodeAt(i)) >>> 0;
  return h;
}

export function yardMatTextureKey(mat: YardMat): string {
  return `mud-${mat.id}`;
}

/** The wandered outline of a mat, scaled by `grow` past its rect. */
function outline(rect: WorldRect, phases: readonly number[], grow: number): WorldPoint[] {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const pow = 2 / CORNER_POWER;
  const pts: WorldPoint[] = [];
  for (let i = 0; i < OUTLINE_STEPS; i += 1) {
    const t = (i / OUTLINE_STEPS) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const wobble =
      1 + 0.06 * Math.sin(3 * t + phases[0]) + 0.035 * Math.sin(7 * t + phases[1]) + 0.02 * Math.sin(12 * t + phases[2]);
    const k = wobble * grow;
    pts.push({
      x: cx + Math.sign(c) * Math.abs(c) ** pow * hw * k,
      y: cy + Math.sign(s) * Math.abs(s) ** pow * hh * k,
    });
  }
  return pts;
}

function tracePolygon(c: Ctx, pts: readonly WorldPoint[]): void {
  c.beginPath();
  pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
  c.closePath();
}

/** Bakes one mat and returns where its texture's corner sits on screen. */
export function bakeYardMatTexture(scene: Phaser.Scene, mat: YardMat): PathBake | null {
  const key = yardMatTextureKey(mat);
  // Room for the feather and the outline's own wander past the rect.
  const pad = Math.max(12, Math.max(mat.rect.width, mat.rect.height) * 0.12);
  const world = { x: mat.rect.x - pad, y: mat.rect.y - pad, width: mat.rect.width + pad * 2, height: mat.rect.height + pad * 2 };
  const box = projectedBounds(world);
  if (scene.textures.exists(key)) return { key, x: box.x, y: box.y };
  const wpx = Math.ceil(box.width * GRASS_PX);
  const hpx = Math.ceil(box.height * GRASS_PX);
  const texW = powerOfTwoCeil(wpx);
  const texH = powerOfTwoCeil(hpx);
  if (texW > 4096 || texH > 4096) {
    console.warn(`stackacres: yard mat ${mat.id} would bake at ${texW}x${texH}; skipped`);
    return null;
  }
  const texture = scene.textures.createCanvas(key, texW, texH);
  if (!texture) return null;
  const c = texture.context;
  c.save();
  c.scale(GRASS_PX, GRASS_PX);
  c.translate(-box.x, -box.y);
  c.transform(ISO_K, ISO_K / 2, -ISO_K, ISO_K / 2, 0, 0);

  const r = seededRandom(hashKey(mat.id));
  const phases = [r() * Math.PI * 2, r() * Math.PI * 2, r() * Math.PI * 2];
  const rect = mat.rect;

  // Feather: three translucent, blurred outlines stepping out past the body.
  c.save();
  c.shadowColor = "rgba(95,62,30,.45)";
  c.shadowBlur = 7;
  for (const [grow, alpha] of [
    [1.1, 0.09],
    [1.06, 0.16],
    [1.025, 0.25],
  ] as const) {
    tracePolygon(c, outline(rect, phases, grow));
    F(c, `rgba(140,96,50,${alpha})`);
  }
  c.restore();

  // Body.
  tracePolygon(c, outline(rect, phases, 1));
  F(c, lin(c, 0, rect.y - 40, 0, rect.y + rect.height + 40, [[0, MUD_TOP], [1, MUD_BOTTOM]]));

  // Everything decorative stays inside the body: clip to it.
  c.save();
  tracePolygon(c, outline(rect, phases, 1));
  c.clip();

  // A paler worn patch off-centre, where the feet go most.
  ell(c, rect.x + rect.width * (0.35 + r() * 0.3), rect.y + rect.height * (0.4 + r() * 0.2), rect.width * 0.28, rect.height * 0.22, (r() - 0.5) * 0.6);
  F(c, "rgba(255,232,180,.14)");

  // Mottles: churned earth, dark and pale.
  const area = rect.width * rect.height;
  const mottles = Math.floor(area / 260);
  for (let i = 0; i < mottles; i += 1) {
    const x = rect.x + r() * rect.width;
    const y = rect.y + r() * rect.height;
    ell(c, x, y, 2.5 + r() * 5, 1.2 + r() * 2.2, r() * Math.PI);
    F(c, r() < 0.55 ? "rgba(120,78,36,.14)" : "rgba(255,238,200,.11)");
  }

  // Wheel ruts: two parallel wavy lines the long way across, dark with a
  // pale lip on the sun side.
  const longWays = rect.width >= rect.height;
  const span = longWays ? rect.width : rect.height;
  const across = longWays ? rect.height : rect.width;
  const gauge = Math.min(14, across * 0.18);
  const mid = (longWays ? rect.y : rect.x) + across * (0.4 + r() * 0.2);
  const phase = r() * Math.PI * 2;
  for (const lane of [-1, 1]) {
    for (const [tone, width, shift] of [
      ["rgba(255,236,190,.22)", 2.2, -0.9],
      ["rgba(105,66,28,.3)", 1.6, 0],
    ] as const) {
      c.beginPath();
      for (let k = 0; k <= 40; k += 1) {
        const t = k / 40;
        const along = (longWays ? rect.x : rect.y) + span * (0.12 + t * 0.76);
        const off = mid + (lane * gauge) / 2 + Math.sin(t * 5.3 + phase) * 1.6 + shift;
        const x = longWays ? along : off;
        const y = longWays ? off : along;
        if (k === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.strokeStyle = tone;
      c.lineWidth = width;
      c.lineCap = "round";
      c.stroke();
    }
  }

  // Puddles: a couple of dark wet patches with a pale glint.
  const puddles = 2 + Math.floor(r() * 2);
  for (let i = 0; i < puddles; i += 1) {
    const x = rect.x + rect.width * (0.15 + r() * 0.7);
    const y = rect.y + rect.height * (0.15 + r() * 0.7);
    const rx = 4 + r() * 6;
    const ry = rx * (0.45 + r() * 0.25);
    const rot = (r() - 0.5) * 0.8;
    ell(c, x, y, rx, ry, rot);
    F(c, "rgba(70,52,40,.38)");
    ell(c, x - rx * 0.25, y - ry * 0.3, rx * 0.35, ry * 0.3, rot);
    F(c, "rgba(220,230,240,.28)");
  }

  // Hoof and boot prints: small dark pairs, sparse.
  const prints = Math.floor(area / 900);
  for (let i = 0; i < prints; i += 1) {
    const x = rect.x + r() * rect.width;
    const y = rect.y + r() * rect.height;
    const rot = r() * Math.PI;
    for (const side of [-1, 1]) {
      ell(c, x + Math.cos(rot + Math.PI / 2) * side * 1.6, y + Math.sin(rot + Math.PI / 2) * side * 1.6, 1.3, 0.8, rot);
      F(c, "rgba(95,60,28,.3)");
    }
  }
  c.restore();

  c.restore();
  texture.add(ART_FRAME, 0, 0, 0, wpx, hpx);
  texture.refresh();
  return { key, x: box.x, y: box.y };
}
