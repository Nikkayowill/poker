/**
 * The chips, in plain Canvas 2D.
 *
 * The felt, rail and floor are real art now (`public/pokertable/`, painted by
 * the DOM as ordinary CSS backgrounds) rather than procedural fills — see
 * `app/styles/06-table.css` and `99-scene.css` for why, and `table-scene.tsx`
 * for the one-line clear that replaced the room paint this file used to do.
 * What is left here is the one thing that still has to be canvas: chips
 * built from the exact `CHIP_PALETTE` the meshes wore before them (which
 * itself carried over from the CSS chips before that — the palette has
 * survived three renderer/backdrop changes now).
 *
 * All positions arrive in world units and go through `project`; nothing in
 * here invents its own coordinates. Pure drawing, no state.
 */

import { CHIP_PALETTE, chipPalette, shadeHex } from "@/lib/scene/chip-physics";
import { flightScale } from "@/lib/scene/chip-spring";
import { CHIP_RADIUS, CHIP_THICKNESS, type SceneChip } from "@/lib/scene/chip-layer";
import type { ChipSpace } from "@/lib/scene/chip-space";
import type { SceneProjection } from "@/lib/scene/scene-projection";

const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

/**
 * How many edge inserts a chip face carries — the eight-wedge cadence that
 * has survived both previous renderers, now stamped as true angular
 * sectors instead of four rectangles.
 */
const STRIPE_COUNT = 8;

/**
 * The face is legible print territory only above this radius, in CSS px.
 * Below it the numeral is a smudge (the dealer-avatar lesson: judge art at
 * the size it actually renders), so the inlay stays clean instead.
 */
const NUMERAL_MIN_RADIUS = 8;

/**
 * One chip, as a layered pipeline at the size the projection dictates:
 *
 * A — the rim base: face and edge filled with multi-stop linear gradients
 *     derived from the palette's one base colour (`shadeHex`), a lit top
 *     stop over a darker lower edge, so the disc reads as a bevelled
 *     physical token rather than a flat fill.
 * B — the injection-molded inserts: STRIPE_COUNT angular sectors at the
 *     (2π / STRIPE_COUNT) cadence, clipped to the rim ring so they sit
 *     perfectly flush with no bleed into the groove or off the edge.
 * C — the compressed inlay core: the centre disc under a clipped inset
 *     shadow (ctx.shadowBlur bleeding in from a stroke drawn just outside
 *     the clip), stamped with the denomination in foreshortened serif
 *     numerals when the chip is large enough to carry print.
 *
 * The ground shadow is decoupled from the token: it tracks the point on the
 * felt directly under the chip, shrinking and softening as the chip climbs
 * its arc. Drawn as a radial gradient rather than ctx.filter blur — a
 * per-chip filter forces an intermediate layer, which is real money on the
 * phones this scene is DPI-upscaled for.
 */
export function paintChip(
  ctx: CanvasRenderingContext2D,
  projection: SceneProjection,
  space: ChipSpace,
  chip: SceneChip,
): void {
  /* Standard layered 2D poker-chip painter. The cylinder edge, stack bands,
     bevel, inserts and inlay are all painted in screen space from the same
     authoritative SceneChip position. */
  const palette = chipPalette(chip.denomination);
  /**
   * The mid-flight swell.
   *
   * This projection is an orthographic tilt, so a chip a world unit above the
   * felt draws at exactly the same size as one resting on it — a flight has
   * no depth cue at all beyond its shadow, and that is a large part of why
   * bets used to read as decals sliding across the cloth rather than as
   * objects being thrown over it. Scaling with the arc's own lift is that
   * missing cue, and it is deliberately faked only for the airborne moment:
   * `lift` is 0 for every resting chip, so a settled pile is never resized.
   *
   * Note this is the *only* place the fake belongs. The R3F room has a real
   * perspective camera doing the same job honestly, and applying both would
   * double the effect.
   */
  // Keep the compact 2D token compact while moving; the stack itself is the
  // readable object, not a swelling billboard over the board.
  const swell = flightScale(chip.lift ?? 0);
  // The physical chip radius is deliberately enlarged in the 2D painter.
  // At the table's phone-sized projection, the true scale collapses the
  // cylinder edge and makes a whole stack read as colored specks.
  const { position } = chip;
  const rx = CHIP_RADIUS * projection.scaleAt(position) * swell * 1.35;
  const ry = rx * projection.groundSquash;

  // The decoupled ground shadow, only for a chip genuinely in flight. The
  // gate is the layer's own airborne flag, not height alone: a chip resting
  // mid-stack is also "high", and painting a hovering shadow pool under a
  // settled pile is exactly what made stacks read as floating chips.
  const height = Math.max(0, position.y - space.feltY);
  if (chip.airborne && height > CHIP_THICKNESS) {
    const ground = projection.project({ x: position.x, y: space.feltY, z: position.z });
    // 0..1 over the tallest arc in the system; drives both the shrink and
    // the softening, so a chip at its apex casts a small, diffuse pool and
    // one about to land casts a tight, hard one.
    //
    // Deliberately derived from world height rather than from `chip.lift`,
    // which the swell above uses. They are not the same quantity: a chip
    // dropping onto a pile it is joining is genuinely airborne but has no
    // arc, so its `lift` is 0 while it is still a world unit up. Keying the
    // pool off the arc would give that chip a tight, hard shadow the whole
    // way down and lose the drop entirely.
    const heightFraction = Math.min(1, height / 3);
    const spread = rx * (1.05 - heightFraction * 0.45);
    const alpha = 0.25 * (1 - heightFraction * 0.55);
    ctx.save();
    ctx.translate(ground.x, ground.y);
    ctx.scale(1, projection.groundSquash);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, spread);
    pool.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
    pool.addColorStop(Math.max(0.05, 0.65 - heightFraction * 0.45), `rgba(0, 0, 0, ${alpha * 0.85})`);
    pool.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(0, 0, spread, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const bottom = projection.project({ x: position.x, y: position.y - CHIP_THICKNESS / 2, z: position.z });
  const top = projection.project({ x: position.x, y: position.y + CHIP_THICKNESS / 2, z: position.z });

  // Edge: the band between the two ellipse levels plus the lower arc,
  // shaded darker toward the felt so the cylinder turns away from the lamp.
  ctx.beginPath();
  ctx.ellipse(bottom.x, bottom.y, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(top.x - rx, top.y);
  ctx.lineTo(top.x + rx, top.y);
  ctx.closePath();
  const edgeShade = ctx.createLinearGradient(0, top.y, 0, bottom.y + ry);
  edgeShade.addColorStop(0, hex(shadeHex(palette.base, -0.08)));
  edgeShade.addColorStop(1, hex(shadeHex(palette.base, -0.38)));
  ctx.fillStyle = edgeShade;
  ctx.fill();

  // The 2D room needs an intentional illustrated stack cue. At this scale a
  // physically exact chip edge is sub-pixel and the faces visually merge, so
  // give every chip a restrained dark lower rim and a warm contact highlight.
  // These are still part of the same chip, not extra chips or geometry.
  ctx.strokeStyle = "rgba(20, 12, 8, 0.78)";
  ctx.lineWidth = Math.max(0.9, rx * 0.075);
  ctx.beginPath();
  ctx.ellipse(bottom.x, bottom.y, rx * 0.96, ry * 0.96, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Edge stripes at the wedge cadence — the tell that a cylinder is a chip.
  const edgeHeight = bottom.y - top.y;
  if (edgeHeight > 1) {
    ctx.fillStyle = hex(palette.accent);
    for (const fraction of [-0.72, -0.3, 0.18, 0.62]) {
      ctx.fillRect(top.x + fraction * rx, top.y + edgeHeight * 0.12, rx * 0.14, edgeHeight * 0.76);
    }
  }

  // Layer A: the rim base. Three stops, lit at the top of the face and
  // falling to a darker rim at the bottom — the fake bevel.
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx, ry, 0, 0, Math.PI * 2);
  const rim = ctx.createLinearGradient(0, top.y - ry, 0, top.y + ry);
  rim.addColorStop(0, hex(shadeHex(palette.base, 0.22)));
  rim.addColorStop(0.55, hex(palette.base));
  rim.addColorStop(1, hex(shadeHex(palette.base, -0.26)));
  ctx.fillStyle = rim;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 239, 177, 0.58)";
  ctx.lineWidth = Math.max(0.7, rx * 0.045);
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.91, ry * 0.91, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Layer B: the inserts, as true angular sectors clipped to the rim ring.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.98, ry * 0.98, 0, 0, Math.PI * 2);
  ctx.ellipse(top.x, top.y, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2);
  ctx.clip("evenodd");
  ctx.fillStyle = hex(palette.accent);
  const step = (Math.PI * 2) / STRIPE_COUNT;
  const insetHalfWidth = step * 0.22;
  for (let index = 0; index < STRIPE_COUNT; index += 1) {
    const centreAngle = index * step;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.ellipse(
      top.x, top.y, rx, ry, 0,
      centreAngle - insetHalfWidth, centreAngle + insetHalfWidth,
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // A thin lit arc along the rim's far edge finishes the bevel.
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.985, ry * 0.985, 0, Math.PI, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, ${rx > 12 ? 0.28 : 0.18})`;
  ctx.lineWidth = Math.max(0.5, rx * 0.035);
  ctx.stroke();

  // The groove scored between the inserts and the inlay.
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(10, 8, 4, 0.5)";
  ctx.lineWidth = Math.max(0.5, rx * 0.04);
  ctx.stroke();

  // Layer C: the inlay core.
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.54, ry * 0.54, 0, 0, Math.PI * 2);
  ctx.fillStyle = hex(palette.core);
  ctx.fill();

  // The stamped depression: clip to the core, then stroke a ring just
  // outside the clip with a blurred, downward-offset shadow — only the
  // shadow lands inside, pooling along the top inner edge exactly as a
  // pressed inlay shades under an overhead lamp.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.54, ry * 0.54, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.shadowColor = "rgba(8, 6, 3, 0.55)";
  ctx.shadowBlur = rx * 0.22;
  ctx.shadowOffsetY = rx * 0.08;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = rx * 0.14;
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // The denomination, in foreshortened serif print, only at sizes where
  // type is type rather than a smudge.
  if (rx >= NUMERAL_MIN_RADIUS) {
    const label = String(chip.denomination);
    ctx.save();
    ctx.translate(top.x, top.y);
    // Print lies on the face, so it foreshortens with it.
    ctx.scale(1, projection.groundSquash);
    ctx.font = `700 ${(rx * (label.length > 2 ? 0.4 : 0.54)).toFixed(1)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(31, 24, 12, 0.8)";
    ctx.fillText(label, 0, rx * 0.04);
    ctx.restore();
  }
}

/** Kept exported so a future asset audit can see every colour in one place. */
export const CHIP_COLOURS = CHIP_PALETTE;
