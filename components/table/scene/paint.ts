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

import { CHIP_PALETTE, chipPalette } from "@/lib/scene/chip-physics";
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

/** An ellipse on the table plane, at a multiple of the felt's radii. */
function tableEllipse(ctx: CanvasRenderingContext2D, view: SceneView, scale: number, atY: number): void {
  const centre = project(view, { x: 0, y: atY, z: 0 });
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    FELT.radiusX * scale * view.scale,
    FELT.radiusZ * scale * TILT_SIN * view.scale,
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
  const vignette = ctx.createRadialGradient(
    felt.x, felt.y, FELT.radiusX * view.scale * 0.8,
    felt.x, felt.y, FELT.radiusX * view.scale * 2.4,
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
  const pool = ctx.createRadialGradient(felt.x, felt.y, 0, felt.x, felt.y, FELT.radiusX * view.scale);
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
 * One chip: face, edge, and the eight-wedge cadence carried over from both
 * previous renderers, at the size the projection dictates. A soft shadow
 * ellipse grounds any chip that is off the felt mid-arc.
 */
export function paintChip(ctx: CanvasRenderingContext2D, view: SceneView, chip: SceneChip): void {
  const palette = chipPalette(chip.denomination);
  const rx = CHIP_RADIUS * view.scale;
  const ry = rx * TILT_SIN;
  const { position } = chip;

  // Shadow on the felt, directly under the chip, fading with height.
  const height = Math.max(0, position.y - FELT.y);
  if (height > CHIP_THICKNESS) {
    const ground = project(view, { x: position.x, y: FELT.y, z: position.z });
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0.08, 0.3 - height * 0.12)})`;
    ctx.fill();
  }

  const bottom = project(view, { x: position.x, y: position.y - CHIP_THICKNESS / 2, z: position.z });
  const top = project(view, { x: position.x, y: position.y + CHIP_THICKNESS / 2, z: position.z });

  // Edge: the band between the two ellipse levels plus the lower arc.
  ctx.beginPath();
  ctx.ellipse(bottom.x, bottom.y, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(top.x - rx, top.y);
  ctx.lineTo(top.x + rx, top.y);
  ctx.closePath();
  ctx.fillStyle = hex(palette.base);
  ctx.fill();

  // Edge stripes at the wedge cadence — the tell that a cylinder is a chip.
  const edgeHeight = bottom.y - top.y;
  if (edgeHeight > 1) {
    ctx.fillStyle = hex(palette.accent);
    for (const fraction of [-0.72, -0.3, 0.18, 0.62]) {
      ctx.fillRect(top.x + fraction * rx, top.y + edgeHeight * 0.12, rx * 0.14, edgeHeight * 0.76);
    }
  }

  // Face: rim, groove, core — outside-in, as the texture drew it.
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = hex(palette.base);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.86, ry * 0.86, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(10, 8, 4, 0.5)";
  ctx.lineWidth = Math.max(0.5, rx * 0.04);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rx * 0.44, ry * 0.44, 0, 0, Math.PI * 2);
  ctx.fillStyle = hex(palette.core);
  ctx.fill();
}

/** Kept exported so a future asset audit can see every colour in one place. */
export const CHIP_COLOURS = CHIP_PALETTE;
