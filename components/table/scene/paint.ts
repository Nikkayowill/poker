/**
 * Everything the room paints, in plain Canvas 2D.
 *
 * These replace the WebGL room's meshes and canvas-generated textures with
 * the same anatomy drawn directly: the mahogany floor with its diamond
 * lattice, the leather rail, the lit felt, and chips built from the exact
 * `CHIP_PALETTE` the meshes wore (which itself carried over from the CSS
 * chips before them — the palette has now survived two renderer changes).
 *
 * All positions arrive in world units and go through `project`; nothing in
 * here invents its own coordinates. Pure drawing, no state.
 */

import { CHIP_PALETTE, chipPalette, shadeHex } from "@/lib/scene/chip-physics";
import { CHIP_RADIUS, CHIP_THICKNESS, type SceneChip } from "@/lib/scene/chip-layer";
import { project, type SceneView } from "@/lib/scene/projection";
import { FELT, RAIL_SCALE, ROOM, TILT_SIN } from "@/lib/scene/scene-config";

const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

/**
 * The carpet, as a repeating tile — a dark geometric diamond lattice, the
 * pattern every card room on earth has on its floor. Two overlaid diagonal
 * lattices at different pitches are what make a tile stop looking like a
 * tile once it is repeated. 256px, drawn once per mount.
 */
export function carpetTile(): HTMLCanvasElement {
  const size = 256;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext("2d")!;

  ctx.fillStyle = ROOM.floor;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = ROOM.carpetLine;
  ctx.lineWidth = 2;
  for (let offset = -size; offset < size * 2; offset += 32) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + size, size);
    ctx.moveTo(offset + size, 0);
    ctx.lineTo(offset, size);
    ctx.stroke();
  }
  ctx.strokeStyle = ROOM.carpetLineFaint;
  ctx.lineWidth = 1;
  for (let offset = -size; offset < size * 2; offset += 64) {
    ctx.beginPath();
    ctx.moveTo(offset + 16, 0);
    ctx.lineTo(offset + 16 + size, size);
    ctx.moveTo(offset + 16 + size, 0);
    ctx.lineTo(offset + 16, size);
    ctx.stroke();
  }
  return tile;
}

/**
 * An ellipse on the table plane, at a multiple of the felt's radii.
 *
 * The depth radius comes off the *view*, not off `FELT`: the table's plan
 * shape is solved per fit so the painted oval matches the plate it is drawn
 * into (see `fitView`). Reading the constant here is what painted a wide
 * horizontal table onto a tall portrait plate.
 */
function tableEllipse(ctx: CanvasRenderingContext2D, view: SceneView, scale: number, atY: number): void {
  const centre = project(view, { x: 0, y: atY, z: 0 });
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    FELT.radiusX * scale * view.scale,
    view.radiusZ * scale * TILT_SIN * view.scale,
    0, 0, Math.PI * 2,
  );
}

/**
 * The room: carpet, the table's shadow, the rail, the felt and its light
 * pool, and the betting line. Painted back to front every frame — at these
 * element counts a full repaint is cheaper than damage tracking, and the
 * scheduler already keeps frames rare.
 */
export function paintRoom(
  ctx: CanvasRenderingContext2D,
  view: SceneView,
  size: { width: number; height: number },
  carpet: CanvasPattern | null,
): void {
  ctx.clearRect(0, 0, size.width, size.height);

  // The floor, and a vignette so the room darkens away from the table the
  // way the old spotlight's falloff did.
  ctx.fillStyle = carpet ?? ROOM.floor;
  ctx.fillRect(0, 0, size.width, size.height);
  const felt = project(view, { x: 0, y: FELT.y, z: 0 });
  /**
   * How far the felt reaches from its centre on screen, whichever way is
   * longer. The vignette and the lamp pool are both circular gradients, so
   * sizing them off the width alone drew a tight ring on a portrait plate —
   * where the table is nearly twice as tall as it is wide — and buried the
   * far and near ends of the cloth in the falloff meant for the carpet.
   */
  const reach = Math.max(FELT.radiusX * view.scale, view.radiusZ * TILT_SIN * view.scale);
  const vignette = ctx.createRadialGradient(
    felt.x, felt.y, reach * 0.8,
    felt.x, felt.y, reach * 2.4,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.78)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size.width, size.height);

  // The table's shadow on the carpet: the rail's ellipse, at floor height,
  // pushed down-screen a little. Cheapest grounding in the scene.
  ctx.save();
  ctx.translate(0, 10);
  tableEllipse(ctx, view, RAIL_SCALE * 1.02, 0);
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.filter = "blur(6px)";
  ctx.fill();
  ctx.restore();

  // The rail: table-height ellipse with a darker rim below it for thickness.
  tableEllipse(ctx, view, RAIL_SCALE, FELT.y - 0.25);
  ctx.fillStyle = ROOM.railEdge;
  ctx.fill();
  tableEllipse(ctx, view, RAIL_SCALE, FELT.y);
  ctx.fillStyle = ROOM.rail;
  ctx.fill();

  // The felt, its edge shading, the lamp's pool, and the betting line.
  tableEllipse(ctx, view, 1, FELT.y);
  ctx.fillStyle = ROOM.felt;
  ctx.fill();
  const pool = ctx.createRadialGradient(felt.x, felt.y, 0, felt.x, felt.y, reach);
  pool.addColorStop(0, ROOM.lampPool);
  pool.addColorStop(0.75, "rgba(255, 236, 180, 0.02)");
  pool.addColorStop(1, "rgba(0, 0, 0, 0.25)");
  ctx.save();
  tableEllipse(ctx, view, 1, FELT.y);
  ctx.clip();
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.restore();
  tableEllipse(ctx, view, 0.62, FELT.y);
  ctx.strokeStyle = ROOM.line;
  ctx.lineWidth = Math.max(1, view.scale * 0.05);
  ctx.stroke();
}

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
export function paintChip(ctx: CanvasRenderingContext2D, view: SceneView, chip: SceneChip): void {
  const palette = chipPalette(chip.denomination);
  const rx = CHIP_RADIUS * view.scale;
  const ry = rx * TILT_SIN;
  const { position } = chip;

  // The decoupled ground shadow, only for a chip genuinely in flight. The
  // gate is the layer's own airborne flag, not height alone: a chip resting
  // mid-stack is also "high", and painting a hovering shadow pool under a
  // settled pile is exactly what made stacks read as floating chips.
  const height = Math.max(0, position.y - FELT.y);
  if (chip.airborne && height > CHIP_THICKNESS) {
    const ground = project(view, { x: position.x, y: FELT.y, z: position.z });
    // 0..1 over the tallest arc in the system; drives both the shrink and
    // the softening, so a chip at its apex casts a small, diffuse pool and
    // one about to land casts a tight, hard one.
    const lift = Math.min(1, height / 3);
    const spread = rx * (1.05 - lift * 0.45);
    const alpha = 0.25 * (1 - lift * 0.55);
    ctx.save();
    ctx.translate(ground.x, ground.y);
    ctx.scale(1, TILT_SIN);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, spread);
    pool.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
    pool.addColorStop(Math.max(0.05, 0.65 - lift * 0.45), `rgba(0, 0, 0, ${alpha * 0.85})`);
    pool.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(0, 0, spread, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const bottom = project(view, { x: position.x, y: position.y - CHIP_THICKNESS / 2, z: position.z });
  const top = project(view, { x: position.x, y: position.y + CHIP_THICKNESS / 2, z: position.z });

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
    ctx.scale(1, TILT_SIN);
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
