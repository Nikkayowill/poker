/**
 * The racetrack room: floor, table body, rail and cloth, from the live camera.
 *
 * The classic 2D table is a photograph -- `.poker-rail`'s CSS background art,
 * cut at one fixed perspective (`public/pokertable/`). That works precisely
 * because nothing about it moves. This room's table is drawn from
 * `lib/scene/table-anchors.ts` through whatever camera `fitCamera` solved for
 * the frame it was handed, so it is the same table at every aspect instead of
 * one image stretched to several.
 *
 * WHAT IS DELIBERATELY NOT HERE. No betting line, no felt logo, no wood
 * grain, no rail stitching. The composition was signed off with a plain
 * gradient cloth, and detailing it is a separate decision that was explicitly
 * left open rather than one to slip in alongside the wiring -- a table that
 * arrives in the game looking different from the render that was approved is
 * a table nobody actually approved.
 *
 * The palette is the render's own. It is intentionally NOT the brand chrome
 * palette: `CLAUDE.md`'s styling contract scopes that to everything except
 * the table, and says the felt and its gold are out of scope for chrome work.
 *
 * DRAW ORDER IS THE DEPTH MODEL. There is no z-buffer here and none is
 * wanted: the scene is a handful of nested convex shells seen from a fixed
 * elevation, so painting floor, then pedestal, then slab, then rail, then
 * cloth is both correct and cheaper than sorting anything. The one ordering
 * that is not obvious -- people before the table, so the rail paints over
 * their chests -- is the caller's business, because in the live room the
 * players are DOM cut-outs layered above this canvas rather than paint.
 */

import {
  FELT_TOP_Y,
  FLOOR_Y,
  RAIL_LIP_HEIGHT,
  SLAB_BOTTOM_Y,
  feltOutline,
  pedestalOutline,
  project,
  tableOutline,
  type Camera,
} from "@/lib/scene/table-anchors";

interface PlanPoint {
  x: number;
  z: number;
}

interface ScreenBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Traces a plan outline at a given height into the current path. */
function tracePlan(ctx: CanvasRenderingContext2D, camera: Camera, plan: PlanPoint[], y: number): void {
  ctx.beginPath();
  plan.forEach((point, index) => {
    const screen = project(camera, { x: point.x, y, z: point.z });
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.closePath();
}

/**
 * The band between one outline at two heights -- a solid's side wall.
 *
 * Needs no face culling, and the reason is a property of this camera rather
 * than luck: lowering a point always moves it DOWN the screen from any
 * elevation above the plane, so the lower outline can never cross above the
 * upper one. Tracing the top forward and the bottom back therefore always
 * yields a simple closed ring covering the wall and the top face together;
 * the top face is painted over it afterwards.
 */
function traceSideWall(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  plan: PlanPoint[],
  topY: number,
  bottomY: number,
): void {
  ctx.beginPath();
  plan.forEach((point, index) => {
    const screen = project(camera, { x: point.x, y: topY, z: point.z });
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  for (let i = plan.length - 1; i >= 0; i -= 1) {
    const screen = project(camera, { x: plan[i].x, y: bottomY, z: plan[i].z });
    ctx.lineTo(screen.x, screen.y);
  }
  ctx.closePath();
}

function screenBounds(camera: Camera, plan: PlanPoint[], y: number): ScreenBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of plan) {
    const screen = project(camera, { x: point.x, y, z: point.z });
    minX = Math.min(minX, screen.x);
    maxX = Math.max(maxX, screen.x);
    minY = Math.min(minY, screen.y);
    maxY = Math.max(maxY, screen.y);
  }
  return { minX, maxX, minY, maxY };
}

export interface RoomFrame {
  width: number;
  height: number;
}

/**
 * The floor, and the pool of light on it.
 *
 * The floor IS the background. At this elevation the camera's horizon sits
 * above the top of the frame at every shipped aspect, so no ray leaves the
 * ground -- there is no wall or sky to paint instead, and none can be added
 * without moving the camera. The 3D room reached the same conclusion the hard
 * way and derives its own floor radius from the camera fit for the same
 * reason (`lib/game3d/floor-environment.ts`).
 */
function paintFloor(ctx: CanvasRenderingContext2D, camera: Camera, frame: RoomFrame): void {
  ctx.fillStyle = "#0a0b10";
  ctx.fillRect(0, 0, frame.width, frame.height);

  const table = screenBounds(camera, tableOutline(), FLOOR_Y);
  const centreX = (table.minX + table.maxX) / 2;
  const centreY = (table.minY + table.maxY) / 2;
  const radius = (table.maxX - table.minX) * 0.95;
  if (!(radius > 0)) return;
  const pool = ctx.createRadialGradient(centreX, centreY, radius * 0.1, centreX, centreY, radius);
  pool.addColorStop(0, "#232634");
  pool.addColorStop(0.55, "#171a24");
  pool.addColorStop(1, "#0a0b10");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, frame.width, frame.height);
}

/** The table's own shadow on the floor, spread wider than the pedestal casting it. */
function paintContactShadow(ctx: CanvasRenderingContext2D, camera: Camera): void {
  const plan = tableOutline().map((point) => ({ x: point.x * 0.72, z: point.z * 0.72 }));
  const bounds = screenBounds(camera, plan, FLOOR_Y);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0)) return;
  ctx.save();
  ctx.translate((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
  ctx.scale(1, Math.max(0.0001, height / width));
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, width / 2);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.55)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, width / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The table as a solid: pedestal, slab side wall, rail top, cloth. */
function paintTable(ctx: CanvasRenderingContext2D, camera: Camera): void {
  const outer = tableOutline();

  // Pedestal first; the slab overlaps it, so nothing needs clipping.
  traceSideWall(ctx, camera, pedestalOutline(), SLAB_BOTTOM_Y, FLOOR_Y);
  ctx.fillStyle = "#0d0e12";
  ctx.fill();

  // The slab's side wall -- the table's girth, and the single thing that
  // makes it read as an object standing on a floor rather than a shape
  // painted onto the background.
  traceSideWall(ctx, camera, outer, FELT_TOP_Y + RAIL_LIP_HEIGHT, SLAB_BOTTOM_Y);
  const wallBounds = screenBounds(camera, outer, SLAB_BOTTOM_Y);
  const wall = ctx.createLinearGradient(0, wallBounds.minY, 0, wallBounds.maxY);
  wall.addColorStop(0, "#26262b");
  wall.addColorStop(0.35, "#131317");
  wall.addColorStop(1, "#08080a");
  ctx.fillStyle = wall;
  ctx.fill();

  // Rail top face.
  tracePlan(ctx, camera, outer, FELT_TOP_Y + RAIL_LIP_HEIGHT);
  const railBounds = screenBounds(camera, outer, FELT_TOP_Y + RAIL_LIP_HEIGHT);
  const rail = ctx.createLinearGradient(0, railBounds.minY, 0, railBounds.maxY);
  rail.addColorStop(0, "#1c1c21");
  rail.addColorStop(0.5, "#2a2a30");
  rail.addColorStop(1, "#141417");
  ctx.fillStyle = rail;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.stroke();

  // Cloth.
  const felt = feltOutline();
  tracePlan(ctx, camera, felt, FELT_TOP_Y);
  const feltBounds = screenBounds(camera, felt, FELT_TOP_Y);
  const cloth = ctx.createLinearGradient(0, feltBounds.minY, 0, feltBounds.maxY);
  cloth.addColorStop(0, "#14603a");
  cloth.addColorStop(0.45, "#1d7a49");
  cloth.addColorStop(1, "#0d4529");
  ctx.fillStyle = cloth;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.stroke();
}

/**
 * The whole room, in one call, back to front.
 *
 * Opaque: this clears the frame itself rather than expecting the caller to,
 * because the floor gradient is the background and a transparent clear would
 * show whatever the DOM has behind the canvas -- which is the classic table's
 * own room photograph.
 */
export function paintRoom(ctx: CanvasRenderingContext2D, camera: Camera, frame: RoomFrame): void {
  paintFloor(ctx, camera, frame);
  paintContactShadow(ctx, camera);
  paintTable(ctx, camera);
}
