/**
 * The racetrack room: the table's own body, rail and cloth, from the live
 * camera, plus its contact shadow on a floor this file no longer paints.
 *
 * The classic 2D table is a photograph: `.poker-rail`'s CSS background art,
 * cut at one fixed perspective (`public/pokertable/`). That works precisely
 * because nothing about it moves. This room's table is drawn from
 * `lib/scene/table-anchors.ts` through whatever camera `fitCamera` solved for
 * the frame it was handed, so it is the same table at every aspect instead of
 * one image stretched to several.
 *
 * What's deliberately not here: no betting line, no felt logo, no wood
 * grain, no rail stitching. The composition was signed off with a plain
 * gradient cloth, and detailing it is a separate decision left open rather
 * than one to slip in alongside the wiring. A table that arrives in the game
 * looking different from the render that was approved is a table nobody
 * actually approved.
 *
 * The palette is the render's own, not the brand chrome palette:
 * `CLAUDE.md`'s styling contract scopes that to everything except the table,
 * and says the felt and its gold are out of scope for chrome work.
 *
 * Draw order is the depth model. There is no z-buffer here and none is
 * wanted: the scene is a handful of nested convex shells seen from a fixed
 * elevation, so painting floor, then pedestal, then slab, then rail, then
 * cloth is both correct and cheaper than sorting anything. The one ordering
 * that is not obvious, people before the table so the rail paints over their
 * chests, is the caller's business: in the live room the players are DOM
 * cut-outs layered above this canvas rather than paint.
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
 * The band between one outline at two heights: a solid's side wall.
 *
 * Needs no face culling, and the reason is a property of this camera rather
 * than luck: lowering a point always moves it down the screen from any
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
 * The floor, or rather, the absence of one.
 *
 * The floor is the background, but that background is not this canvas's to
 * paint any more: `.game-shell` already carries the app's own lounge photo
 * and its warm floor-pool glow (05-game-header.css), the same backdrop the
 * classic table sits on, and `.table-scene` is `background: transparent`
 * specifically so it shows through (99-scene.css). Painting a second, flatly
 * neutral floor here just occluded that photo with a slab that read as
 * generic grey next to the rest of the app's branding. Clearing, not filling,
 * is what lets it through.
 *
 * At this elevation the camera's horizon sits above the top of the frame at
 * every shipped aspect, so no ray leaves the ground; there is no wall or sky
 * this canvas could paint instead even if it wanted to. The 3D room reached
 * the same conclusion the hard way (`lib/game3d/floor-environment.ts`).
 */
function paintFloor(ctx: CanvasRenderingContext2D, frame: RoomFrame): void {
  ctx.clearRect(0, 0, frame.width, frame.height);
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

  // The slab's side wall: the table's girth, and the single thing that
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
 * Transparent: this clears the frame itself rather than expecting the caller
 * to, so a resized or re-fit table never leaves a stale frame behind. The
 * clear is to nothing on purpose, so the DOM's own room photograph shows
 * through underneath the table this paints.
 */
export function paintRoom(ctx: CanvasRenderingContext2D, camera: Camera, frame: RoomFrame): void {
  paintFloor(ctx, frame);
  paintContactShadow(ctx, camera);
  paintTable(ctx, camera);
}
