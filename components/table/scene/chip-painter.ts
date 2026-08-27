/**
 * A chip, drawn.
 *
 * FOUR LAYERS, AND THE SECOND ONE IS THE WHOLE JOB.
 *
 *   1. The side wall — the band of cylinder between the chip's bottom face and
 *      its top. Shaded across its width rather than down its height, because
 *      that is what a cylinder under a lamp does, and carrying the edge
 *      inserts wrapped around it at their true foreshortening.
 *   2. The top surface — a bevelled rim, a radial fall from the lit side, the
 *      alternating edge inserts, a scored groove, the pressed inlay, the
 *      denomination.
 *   3. The rim highlights — a lit arc along the top edge and a dark contact
 *      line along the bottom, which is also the shadow the chip above casts on
 *      the chip below.
 *   4. The shadows — contact, stack and flight, drawn in their own pass.
 *
 * The side wall is first in that list and first in importance. A chip without
 * one is a circle: no thickness, no weight, nothing to say the object is
 * cylindrical rather than printed. `chip-spec.ts` guarantees it 3–5 CSS pixels
 * at every breakpoint, which is why the sizing lives there and not here.
 *
 * WHY THE SHADOWS ARE A SEPARATE PASS. A shadow belongs to the felt, not to
 * the chip that casts it, so it has to be under *every* chip rather than under
 * the ones drawn after it. Painting each chip's shadow immediately before that
 * chip puts the near chips' shadows over the far chips' faces — a grey smear
 * across the top of the mound, which is precisely what a pot rendered
 * chip-by-chip looks like when nobody has separated the passes.
 *
 * WHY THE STACK HEIGHT IS SCREEN-SPACE. The scene hands over a ground position
 * and an integer stack index rather than a world Y. The painter multiplies the
 * index by a pitch derived from this chip's own drawn size, which is what
 * pins the gap between two stacked chips at 3–4 pixels on a desktop plate, on
 * a portrait phone, and at the far rail of a perspective table — three cases
 * where a world-space thickness projects to three different and mostly
 * useless numbers.
 *
 * Everything below works in CSS pixels. Nothing here invents a coordinate: all
 * world points arrive through `SceneProjection`.
 */

import type { ChipSpace } from "@/lib/scene/chip-space";
import type { SceneProjection } from "@/lib/scene/scene-projection";
import type { RenderChip } from "@/lib/scene/chips/chip-scene";
import {
  chipMaterial,
  chipMetrics,
  chipVariance,
  clamp,
  css,
  FACE,
  hash01,
  INSERT_COUNT,
  NUMERAL_MIN_RADIUS_PX,
  ROSETTE_MIN_RADIUS_PX,
  rgba,
  shade,
  type ChipMaterial,
} from "@/lib/scene/chips/chip-spec";

/**
 * The chip's placement on screen, in CSS pixels, after the projection, the
 * stack offset and every per-chip imperfection have been applied.
 */
interface Placement {
  /** The top face's centre. */
  x: number;
  y: number;
  /** Half the drawn width, and the face's foreshortened half-height. */
  rx: number;
  ry: number;
  /** The visible side wall. */
  wall: number;
  /** Silhouette rotation: the resting tilt plus any tumble. */
  rotation: number;
  /** Landing squash. */
  scaleX: number;
  scaleY: number;
  /** Face pattern orientation — chips in a stack are not aligned. */
  spin: number;
  /** Where the chip's column meets the cloth, for the shadow pass. */
  groundX: number;
  groundY: number;
}

/**
 * Everything the two passes need to agree on, worked out once per chip.
 *
 * `up` is measured rather than assumed. Under the classic room's orthographic
 * tilt, world-vertical is exactly screen-vertical; under the racetrack's
 * pinhole camera it leans slightly outward from the image centre, because a
 * vertical segment away from the principal point projects to a converging one.
 * Probing the projection with a point one chip-radius up gets both cases right
 * for the price of one extra projection, and hard-coding screen-vertical would
 * skew every stack on the perspective table by a pixel or two per chip.
 */
function place(
  projection: SceneProjection,
  space: ChipSpace,
  chip: RenderChip,
  chipRadius: number,
): Placement {
  const base = chip.position;
  const anchor = projection.project(base);
  const probe = projection.project({ x: base.x, y: base.y + chipRadius, z: base.z });
  const riseX = (probe.x - anchor.x) / chipRadius;
  const riseY = (probe.y - anchor.y) / chipRadius;
  const riseLength = Math.hypot(riseX, riseY) || 1;
  const upX = riseX / riseLength;
  const upY = riseY / riseLength;

  const variance = chipVariance(chip.seed);
  const metrics = chipMetrics(
    projection.scaleAt(base),
    projection.groundSquash,
    chipRadius,
    variance.sizeScale,
  );

  // The cloth directly under this chip: where its shadow lives, and the point
  // the whole column is measured up from.
  const ground = projection.project({ x: base.x, y: space.feltY, z: base.z });
  // Chip 0 rests its bottom face on the cloth, so its *top* face is one wall
  // up. Chip i's is (i + 1) walls up.
  const stackPx = (chip.stackIndex + 1) * metrics.pitchPx;

  return {
    x: anchor.x + upX * stackPx + chip.driftXPx + variance.slidePx,
    y: anchor.y + upY * stackPx + chip.driftYPx,
    rx: metrics.radiusPx,
    ry: metrics.faceRadiusPx,
    wall: metrics.wallPx,
    rotation: variance.tiltRad + chip.rollRad,
    scaleX: chip.scaleX,
    scaleY: chip.scaleY,
    spin: variance.spinRad,
    groundX: ground.x + chip.driftXPx,
    groundY: ground.y,
  };
}

/* ------------------------------------------------------------------ *
 * Pass one: shadows.
 * ------------------------------------------------------------------ */

/**
 * The chip's shadow on the cloth.
 *
 * Two of the three shadows in the system live here; the third (the contact
 * line between two stacked chips) is drawn as part of the chip itself, because
 * it falls on a chip rather than on the felt.
 *
 * THE FLIGHT SHADOW IS DECOUPLED FROM THE CHIP and that is the point of it: it
 * tracks the cloth under the chip while the chip climbs away from it, which is
 * the only honest depth cue a room with no perspective on height has. As the
 * chip rises the pool tightens, fades and softens; as it comes down the pool
 * hardens and darkens under it. That exchange is what makes a thrown chip read
 * as an object above a table rather than a sprite sliding across one.
 *
 * THE CONTACT SHADOW is drawn once per column, not once per chip. Nine chips
 * each dropping their own pool onto the same spot compounds into a black disc
 * with a hard edge, which reads as a hole in the felt.
 *
 * Drawn as radial gradients rather than `ctx.filter = "blur()"`: a per-chip
 * filter forces an intermediate compositing layer, which is real money on the
 * phones this canvas is already DPI-upscaled for.
 */
export function paintChipShadow(
  ctx: CanvasRenderingContext2D,
  projection: SceneProjection,
  space: ChipSpace,
  chip: RenderChip,
  chipRadius: number,
): void {
  const opacity = clamp(chip.opacity, 0, 1);
  if (opacity <= 0.01) return;
  const spot = place(projection, space, chip, chipRadius);
  const resting = !chip.airborne;
  // Only the chip on the bottom of a column shadows the cloth. `stackIndex` is
  // fractional mid-flight, so this is a threshold rather than an equality.
  if (resting && chip.stackIndex > 0.5) return;

  // 0 on the cloth, 1 at the apex of the tallest arc in the system.
  const height = clamp(chip.lift, 0, 1);
  const spread = spot.rx * (resting ? 1.02 : 1.02 - height * 0.42);
  // The shadow fades with the chip. A paid chip that dissolved while its
  // shadow stayed put would leave a dark smudge on the felt.
  const alpha = (resting ? 0.3 : 0.3 * (1 - height * 0.6)) * opacity;
  if (spread <= 0.2 || alpha <= 0.01) return;

  // The core's share of the radius: a tight, hard pool under a chip about to
  // land, a diffuse one under a chip at its apex.
  const core = resting ? 0.62 : Math.max(0.05, 0.62 - height * 0.5);

  ctx.save();
  ctx.translate(spot.groundX, spot.groundY);
  ctx.scale(1, Math.max(0.15, projection.groundSquash));
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, spread);
  pool.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
  pool.addColorStop(core, `rgba(0, 0, 0, ${alpha * 0.72})`);
  pool.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(0, 0, spread, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Pass two: the chip.
 * ------------------------------------------------------------------ */

export function paintChip(
  ctx: CanvasRenderingContext2D,
  projection: SceneProjection,
  space: ChipSpace,
  chip: RenderChip,
  chipRadius: number,
  /**
   * A player's own chip-design assignment for this denomination, resolved by
   * the caller (racetrack-scene.tsx knows which seat owns this chip; this
   * module doesn't). Falls back to the house `chipMaterial` lookup, same as
   * an unassigned or since-removed design does further up the chain.
   */
  materialOverride?: ChipMaterial,
): void {
  const opacity = clamp(chip.opacity, 0, 1);
  if (opacity <= 0.01) return;
  const spot = place(projection, space, chip, chipRadius);
  if (!Number.isFinite(spot.x) || !Number.isFinite(spot.y) || spot.rx <= 0) return;

  const material = materialOverride ?? chipMaterial(chip.denomination);
  const { rx, ry, wall } = spot;

  ctx.save();
  if (opacity < 1) ctx.globalAlpha = opacity;
  ctx.translate(spot.x, spot.y);
  if (spot.rotation !== 0) ctx.rotate(spot.rotation);
  if (spot.scaleX !== 1 || spot.scaleY !== 1) ctx.scale(spot.scaleX, spot.scaleY);

  paintWall(ctx, rx, ry, wall, material.body, material.spot, spot.spin);
  paintFace(ctx, rx, ry, material, spot.spin, chip.denomination, projection.groundSquash);

  ctx.restore();
}

/**
 * Layer 1: the side wall, plus layer 3's two rim lines.
 *
 * The fill is a *horizontal* gradient, which is the whole difference between a
 * cylinder and a ramp. A vertical shade — light at the top of the band, dark at
 * the bottom — is what the old painter used, and it describes a surface tilting
 * away from the lamp, not one curving around an axis. A cylinder's brightest
 * line runs vertically down its side, offset toward the light, and falls off
 * toward both silhouette edges; that is four stops across the width and it is
 * the reason a chip drawn this way reads as a turned object.
 *
 * A vertical darkening is then laid over it, because the wall really is in
 * shadow near the cloth. Both fills reuse the same path — the canvas keeps the
 * current path until the next `beginPath`, so the second fill is free.
 *
 * Exported alongside `paintFace` so a static preview (the store's chip-design
 * swatch, `components/store/chip-design-art.tsx`) can draw the same chip
 * outside a `RenderChip`/`SceneProjection` pair — everything below this point
 * only needs the geometry the caller already worked out, not the table.
 */
export function paintWall(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  wall: number,
  body: number,
  spot: number,
  spin: number,
): void {
  // The visible band: the front half of the top face, down the two silhouette
  // edges, and back along the front half of the bottom face.
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(-rx, wall);
  ctx.ellipse(0, wall, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();

  const barrel = ctx.createLinearGradient(-rx, 0, rx, 0);
  barrel.addColorStop(0, css(shade(body, -0.46)));
  barrel.addColorStop(0.32, css(shade(body, -0.1)));
  barrel.addColorStop(0.62, css(shade(body, -0.28)));
  barrel.addColorStop(1, css(shade(body, -0.5)));
  ctx.fillStyle = barrel;
  ctx.fill();

  const toCloth = ctx.createLinearGradient(0, -ry * 0.2, 0, wall + ry);
  toCloth.addColorStop(0, "rgba(0, 0, 0, 0)");
  toCloth.addColorStop(1, "rgba(0, 0, 0, 0.34)");
  ctx.fillStyle = toCloth;
  ctx.fill();

  // The inserts, wrapped around the cylinder at their true foreshortening: a
  // mark at azimuth a sits at x = rx*cos(a) and is squeezed by sin(a) as it
  // turns toward the silhouette. Drawing them as evenly spaced rectangles —
  // which is what the old painter did — puts the same width on a mark facing
  // the viewer and one nearly edge-on, and the cylinder immediately reads as a
  // flat strip with stripes on it.
  if (wall >= 3.2 && rx >= 7) {
    // Deliberately dim, and it took a nine-high column to find the right
    // value. The inserts on the face can be bright because they sit on a lit
    // surface seen flat; the same brightness on the wall turns a stack into a
    // black-and-white checkerboard, because nine chips' worth of unaligned
    // marks tile the whole side of the column. On a real stack the edge spots
    // are in the chip's own shadow — they mark the edge, they do not pattern
    // it — so they are shaded most of the way to the wall's own value.
    ctx.fillStyle = css(shade(spot, -0.52));
    const step = (Math.PI * 2) / INSERT_COUNT;
    const half = step * 0.16;
    for (let index = 0; index < INSERT_COUNT; index += 1) {
      const a = index * step + spin;
      // Front-facing only, and not so close to the silhouette that the mark
      // collapses into the edge line.
      if (Math.sin(a) < 0.22) continue;
      const x0 = rx * Math.cos(a - half);
      const y0 = ry * Math.sin(a - half);
      const x1 = rx * Math.cos(a + half);
      const y1 = ry * Math.sin(a + half);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1, y1 + wall);
      ctx.lineTo(x0, y0 + wall);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Layer 3, lower half: the contact line where this chip meets whatever is
  // under it. This is also the "shadow between stacked chips" — a chip in a
  // column sits on the chip below, and this dark arc is what that contact
  // looks like from here.
  ctx.beginPath();
  ctx.ellipse(0, wall, rx * 0.995, ry * 0.995, 0, 0, Math.PI);
  ctx.strokeStyle = "rgba(12, 9, 6, 0.55)";
  ctx.lineWidth = Math.max(0.7, rx * 0.07);
  ctx.stroke();
}

/**
 * Layer 2: the top surface, and layer 3's lit upper arc.
 *
 * Radial rather than linear, offset toward the upper left. A chip's face is a
 * shallow dome under a compressed inlay, not a flat disc, and the falloff from
 * an off-centre highlight is what says so. The highlight is deliberately weak:
 * compressed clay is matte, and a bright specular is the single fastest way to
 * make a chip look like injection-moulded plastic.
 *
 * `denomination` is nullable: a chip on the table always carries one, but a
 * store swatch previewing a chip *design* doesn't belong to any single
 * denomination (a player assigns the same design to whichever of the four
 * they like) — `null` skips the numeral and leaves the rosette as the face's
 * only stamp.
 */
export function paintFace(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  material: { body: number; spot: number; inlay: number; ink: number },
  spin: number,
  denomination: number | null,
  squash: number,
): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  const dome = ctx.createRadialGradient(-rx * 0.3, -ry * 0.45, rx * 0.05, 0, 0, rx * 1.08);
  dome.addColorStop(0, css(shade(material.body, 0.2)));
  dome.addColorStop(0.5, css(material.body));
  dome.addColorStop(1, css(shade(material.body, -0.22)));
  ctx.fillStyle = dome;
  ctx.fill();

  // The inserts: true angular sectors clipped to the rim ring, so they sit
  // flush with no bleed into the groove or off the edge.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * FACE.insertOuter, ry * FACE.insertOuter, 0, 0, Math.PI * 2);
  ctx.ellipse(0, 0, rx * FACE.insertInner, ry * FACE.insertInner, 0, 0, Math.PI * 2);
  ctx.clip("evenodd");
  ctx.fillStyle = css(material.spot);
  const step = (Math.PI * 2) / INSERT_COUNT;
  const half = step * 0.21;
  for (let index = 0; index < INSERT_COUNT; index += 1) {
    const a = index * step + spin;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.ellipse(0, 0, rx, ry, 0, a - half, a + half);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  paintGrain(ctx, rx, ry);

  // Layer 3, upper half: the bevel's lit arc, along the edge that faces the
  // lamp. Paired with the wall's dark contact line, these two are the whole
  // bevel — a rim that catches light on one side and loses it on the other.
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * FACE.bevel, ry * FACE.bevel, 0, Math.PI, Math.PI * 2);
  ctx.strokeStyle = rgba(shade(material.body, 0.55), rx > 11 ? 0.5 : 0.34);
  ctx.lineWidth = Math.max(0.6, rx * 0.05);
  ctx.stroke();

  // The groove scored between the inserts and the inlay.
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * FACE.groove, ry * FACE.groove, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(10, 8, 4, 0.42)";
  ctx.lineWidth = Math.max(0.5, rx * 0.04);
  ctx.stroke();

  // The pressed inlay.
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * FACE.inlay, ry * FACE.inlay, 0, 0, Math.PI * 2);
  const inlay = ctx.createRadialGradient(-rx * 0.16, -ry * 0.22, rx * 0.03, 0, 0, rx * FACE.inlay);
  inlay.addColorStop(0, css(shade(material.inlay, 0.14)));
  inlay.addColorStop(1, css(shade(material.inlay, -0.12)));
  ctx.fillStyle = inlay;
  ctx.fill();

  // The depression it sits in: clip to the inlay, then stroke a ring just
  // outside the clip with a blurred, downward-offset shadow. Only the shadow
  // lands inside, pooling along the upper inner edge exactly as a pressed
  // inlay shades under an overhead lamp.
  if (rx >= ROSETTE_MIN_RADIUS_PX) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * FACE.inlay, ry * FACE.inlay, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.shadowColor = "rgba(8, 6, 3, 0.5)";
    ctx.shadowBlur = rx * 0.2;
    ctx.shadowOffsetY = rx * 0.07;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = rx * 0.13;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * (FACE.inlay + 0.08), ry * (FACE.inlay + 0.08), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  paintRosette(ctx, rx, material.ink, squash);

  // The denomination, only at sizes where type is type rather than a smudge,
  // and only when there is one to print.
  if (denomination !== null && rx >= NUMERAL_MIN_RADIUS_PX) {
    const label = String(denomination);
    ctx.save();
    // Print lies on the face, so it foreshortens with it.
    ctx.scale(1, Math.max(0.15, squash));
    const size = rx * (label.length > 2 ? 0.42 : 0.56);
    ctx.font = `700 ${size.toFixed(1)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(material.ink, 0.88);
    ctx.fillText(label, 0, size * 0.06);
    ctx.restore();
  }
}

/**
 * The rosette: two thin scored rings and a five-point star, stamped behind
 * the denomination the way a real ceramic chip presses a crest into its
 * inlay instead of shipping a bare number. Faint on purpose -- the numeral
 * above it is drawn at 0.88 alpha, this is a fraction of that, in the same
 * "engraved, not printed" register as the groove and the edge inserts
 * rather than a bold logo competing with the number for attention.
 *
 * Every denomination gets one, house or bought: the emblem is table
 * furniture, like the wall's insert marks, not a thing Gold buys -- a
 * purchased design only ever changes the four material colours underneath
 * it.
 */
function paintRosette(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ink: number,
  squash: number,
): void {
  if (rx < ROSETTE_MIN_RADIUS_PX) return;
  ctx.save();
  // Lies on the face, so it foreshortens with it -- same reasoning as the
  // numeral's own `ctx.scale(1, squash)` just below.
  ctx.scale(1, Math.max(0.15, squash));

  ctx.strokeStyle = rgba(ink, 0.3);
  ctx.lineWidth = Math.max(0.5, rx * 0.02);
  ctx.beginPath();
  ctx.arc(0, 0, rx * FACE.rosetteOuter, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, rx * FACE.rosetteInner, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = rgba(ink, 0.4);
  ctx.beginPath();
  starPath(ctx, rx * FACE.rosetteInner * 0.82, rx * FACE.rosetteInner * 0.34, 5);
  ctx.fill();

  ctx.restore();
}

/** A five-point (or n-point) star, traced into the current path. */
function starPath(
  ctx: CanvasRenderingContext2D,
  outerRadius: number,
  innerRadius: number,
  points: number,
): void {
  const step = Math.PI / points;
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    // Starts pointing straight up, same "north" every other face marking
    // (the numeral, the insert cadence) implicitly assumes.
    const angle = index * step - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* ------------------------------------------------------------------ *
 * Material grain.
 * ------------------------------------------------------------------ */

/**
 * Compressed clay is not a flat colour, and the difference at chip scale is a
 * faint speckle rather than anything you could name. Without it a face is a
 * gradient, and a gradient is the look of a vector icon.
 *
 * One 64px tile, built once and reused by every chip on the table. Seeded from
 * `hash01` rather than `Math.random`, so the grain is identical across
 * reloads, across two tabs watching one table, and across a screenshot test —
 * a texture that changes on every refresh is a visual diff that never settles.
 */
let grainPattern: CanvasPattern | null = null;
let grainFailed = false;

function ensureGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainPattern || grainFailed) return grainPattern;
  const size = 64;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) {
    grainFailed = true;
    return null;
  }
  const image = tileCtx.createImageData(size, size);
  for (let index = 0; index < size * size; index += 1) {
    const noise = hash01(index, 17);
    const offset = index * 4;
    // Signed grain around mid-grey, laid down at low alpha and composited in
    // `overlay` so it darkens the dark colours and lightens the light ones
    // instead of washing every denomination toward the same haze.
    const value = Math.round(110 + noise * 70);
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  tileCtx.putImageData(image, 0, 0);
  grainPattern = ctx.createPattern(tile, "repeat");
  if (!grainPattern) grainFailed = true;
  return grainPattern;
}

function paintGrain(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
  // Below this the face is a dozen pixels across and the speckle is noise on
  // noise; the clean gradient reads better.
  if (rx < 8) return;
  const pattern = ensureGrain(ctx);
  if (!pattern) return;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = "overlay";
  // Multiplied rather than assigned: the caller may already have dimmed the
  // context for a payout chip's fade, and a flat assignment here would leave
  // the grain at full strength on a chip that is otherwise nearly gone.
  ctx.globalAlpha *= 0.14;
  ctx.fillStyle = pattern;
  ctx.fillRect(-rx, -ry, rx * 2, ry * 2);
  ctx.restore();
}
