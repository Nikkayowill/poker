"use client";

/**
 * Debug render of the 2.5D table: floor, table body, rail, felt, and a
 * marker at every anchor `lib/scene/table-anchors.ts` defines.
 *
 * A seated player is drawn as a stick and a head dot by default, which is
 * enough to judge whether the crowd sits where it should without pretending
 * to be art. Pass `seatArt` (a character id from `seat-art.generated.ts`) to
 * swap those placeholders for the real cutouts instead, at every seat that
 * character has a plate for -- that's the other half of this tool's job:
 * judging where the art actually lands before anything ships wired to it.
 */

import { useEffect, useRef, useState } from "react";
import {
  DEALER_ANGLE_DEG,
  FELT_TOP_Y,
  FLOOR_Y,
  HERO_SLOT,
  RAIL_LIP_HEIGHT,
  SEAT_COUNT,
  SLAB_BOTTOM_Y,
  dealerAnchor,
  dealerHead,
  debugMarkers,
  feltOutline,
  fitCamera,
  pedestalOutline,
  project,
  seatAnchor,
  seatAngleDeg,
  seatHead,
  seatShoulderRoom,
  tableOutline,
  type Camera,
  type Frame,
  type Vec3,
} from "@/lib/scene/table-anchors";
import { MAX_PIXEL_RATIO } from "@/lib/scene/scene-config";
import { pickSeatArt, seatArtCharacter } from "@/lib/scene/seat-art";

const MARKER_COLOR = {
  seat: "#6fd6ff",
  dealer: "#ff6f6f",
  felt: "#e8c766",
  button: "#ffffff",
} as const;

type PlanPoint = { x: number; z: number };

/** Traces a plan outline at a given height into a canvas path. */
function tracePlan(ctx: CanvasRenderingContext2D, camera: Camera, plan: PlanPoint[], y: number) {
  ctx.beginPath();
  plan.forEach((point, index) => {
    const screen = project(camera, { x: point.x, y, z: point.z });
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.closePath();
}

/**
 * The band between the same outline at two heights -- a solid's side wall.
 *
 * Works without any face culling because lowering a point always moves it
 * *down* the screen under this camera, so the lower outline never crosses
 * above the upper one. Tracing the top forward and the bottom back gives a
 * simple closed ring that covers the wall and the top face together; the
 * top face is then painted over it.
 */
function traceSideWall(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  plan: PlanPoint[],
  topY: number,
  bottomY: number,
) {
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

function screenBounds(camera: Camera, plan: PlanPoint[], y: number) {
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

function drawFloor(ctx: CanvasRenderingContext2D, camera: Camera, frame: Frame) {
  ctx.fillStyle = "#0a0b10";
  ctx.fillRect(0, 0, frame.width, frame.height);

  // A pool of light on the floor around the table. The camera's horizon
  // sits above the top of the frame at this elevation, so the floor IS the
  // background -- there is no wall to light instead.
  const table = screenBounds(camera, tableOutline(), FLOOR_Y);
  const centreX = (table.minX + table.maxX) / 2;
  const centreY = (table.minY + table.maxY) / 2;
  const radius = (table.maxX - table.minX) * 0.95;
  const pool = ctx.createRadialGradient(centreX, centreY, radius * 0.1, centreX, centreY, radius);
  pool.addColorStop(0, "#232634");
  pool.addColorStop(0.55, "#171a24");
  pool.addColorStop(1, "#0a0b10");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, frame.width, frame.height);
}

function drawContactShadow(ctx: CanvasRenderingContext2D, camera: Camera) {
  // On the floor, spread wider than the pedestal that casts it.
  const plan = tableOutline().map((point) => ({ x: point.x * 0.72, z: point.z * 0.72 }));
  const bounds = screenBounds(camera, plan, FLOOR_Y);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  ctx.save();
  ctx.translate(centreX, centreY);
  ctx.scale(1, Math.max(0.0001, (bounds.maxY - bounds.minY) / (bounds.maxX - bounds.minX)));
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, (bounds.maxX - bounds.minX) / 2);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.55)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, (bounds.maxX - bounds.minX) / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTable(ctx: CanvasRenderingContext2D, camera: Camera) {
  const outer = tableOutline();

  // Pedestal first -- the slab overlaps it, so no clipping needed.
  traceSideWall(ctx, camera, pedestalOutline(), SLAB_BOTTOM_Y, FLOOR_Y);
  ctx.fillStyle = "#0d0e12";
  ctx.fill();

  // The slab's own side wall: the table's girth.
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

  // Felt.
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

/** How much of its available elbow room a placeholder figure takes up.
 * Under 1 so neighbours never touch -- real art should leave a gap too. */
const FIGURE_WIDTH_RATIO = 0.72;

/**
 * A seated player as a blank body block and a head disc.
 *
 * Deliberately featureless -- this is not character art and must not be
 * mistaken for it. But it does occupy the real volume a figure will, and
 * that is the point: a thin stick makes any arrangement look like heads
 * floating over an empty table, so there is no way to judge whether the
 * crowd sits at the right height or whether six of them even fit.
 *
 * `head` is the CROWN, so the disc hangs below it rather than being centred
 * on it -- see SEATED_HEAD_Y.
 */
function drawSeatedMarker(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  floor: Vec3,
  head: Vec3,
  shoulderMetres: number,
  color: string,
  label: string,
) {
  const crown = project(camera, head);
  if (crown.depth <= 0) return;

  // Width measured in world metres and projected, so a nearer figure comes
  // out bigger for free.
  const left = project(camera, { x: floor.x - shoulderMetres / 2, y: head.y, z: floor.z });
  const right = project(camera, { x: floor.x + shoulderMetres / 2, y: head.y, z: floor.z });
  const shoulders = Math.abs(right.x - left.x);
  const headRadius = shoulders * 0.36;
  const headCentreY = crown.y + headRadius;
  const neckY = headCentreY + headRadius * 0.72;

  // Body runs from the neck down to just under the rail's top edge, where
  // the table paints over it.
  const chest = project(camera, { ...floor, y: FELT_TOP_Y - 0.06 });

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 2;

  const bodyHeight = Math.max(2, chest.y - neckY);
  ctx.beginPath();
  ctx.roundRect(
    crown.x - shoulders / 2,
    neckY,
    shoulders,
    bodyHeight,
    [Math.min(shoulders / 2, bodyHeight / 2), Math.min(shoulders / 2, bodyHeight / 2), 0, 0],
  );
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(crown.x, headCentreY, headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(label, crown.x, crown.y - 7);
  ctx.fillStyle = "#f2f4f6";
  ctx.fillText(label, crown.x, crown.y - 7);
}

function drawFeltMarker(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  position: Vec3,
  color: string,
  label: string,
) {
  const screen = project(camera, position);
  if (screen.depth <= 0) return;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#000";
  ctx.stroke();

  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(label, screen.x, screen.y - 12);
  ctx.fillStyle = "#f2f4f6";
  ctx.fillText(label, screen.x, screen.y - 12);
}

function drawHudLine(ctx: CanvasRenderingContext2D, frame: Frame) {
  const hud = frame.hudFraction ?? 0;
  if (hud <= 0) return;
  const y = frame.height * (1 - hud);
  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(frame.width, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText("your HUD sits below this line", 12, y + 16);
  ctx.restore();
}

/**
 * How tall a seat's art is drawn, as a multiple of that seat's own
 * `shoulderPx` budget (the projected gap to its nearest neighbour, the same
 * number `racetrack-scene.tsx` reports to the DOM). Height rather than width
 * because height is what the art is normalised on -- crown to hands, per
 * `prepare-seat-art.py` -- so pinning it is what keeps every character's
 * hands on the same line of cloth. Starting value, meant to be judged and
 * moved from renders of this page rather than reasoned about; see
 * DEALER_SLOT for the sibling constant this mirrors.
 */
const SEAT_ART_HEIGHT_RATIO = 1.35;

/** How far the crown sits above the seat's own head anchor, as a fraction of
 *  the drawn height. Same role as DEALER_SLOT.crown. */
const SEAT_ART_CROWN_FRACTION = 0.06;

/** Cross-request cache so a resize (a second `TableAnchorsDebug` on the same
 *  page, or a re-fit) never re-fetches a plate it already has. Keyed on the
 *  URL, which is the only identity a plate has. Every caller waiting on a
 *  still-loading plate registers its own listener -- a lone `onload` would
 *  only ever wake the component that happened to start the fetch, and this
 *  page always has at least two (desktop and mobile) sharing one plate. */
const seatArtImages = new Map<string, { image: HTMLImageElement; listeners: Set<() => void> }>();

function loadSeatArt(src: string, onReady: () => void): HTMLImageElement | null {
  const existing = seatArtImages.get(src);
  const entry = existing ?? { image: new Image(), listeners: new Set<() => void>() };
  if (!existing) {
    seatArtImages.set(src, entry);
    entry.image.onload = () => {
      for (const listener of entry.listeners) listener();
    };
    entry.image.src = src;
  }
  if (entry.image.complete) return entry.image;
  entry.listeners.add(onReady);
  return null;
}

function drawSeatArt(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  image: HTMLImageElement,
  floor: Vec3,
  head: Vec3,
  shoulderMetres: number,
  aspect: number,
  mirror: boolean,
): boolean {
  const crown = project(camera, head);
  if (crown.depth <= 0) return false;
  const left = project(camera, { x: floor.x - shoulderMetres / 2, y: head.y, z: floor.z });
  const right = project(camera, { x: floor.x + shoulderMetres / 2, y: head.y, z: floor.z });
  const shoulderPx = Math.abs(right.x - left.x);
  const height = shoulderPx * SEAT_ART_HEIGHT_RATIO;
  const width = height * aspect;
  const top = crown.y - height * SEAT_ART_CROWN_FRACTION;
  const boxLeft = crown.x - width / 2;

  ctx.save();
  if (mirror) {
    ctx.translate(crown.x, 0);
    ctx.scale(-1, 1);
    ctx.translate(-crown.x, 0);
  }
  ctx.drawImage(image, boxLeft, top, width, height);
  ctx.restore();
  return true;
}

export interface TableAnchorsDebugProps {
  frame: Frame;
  label?: string;
  /** A character id from `seat-art.generated.ts` -- draws its cutouts at
   *  every seat it has a plate for instead of the placeholder markers. */
  seatArt?: string;
}

export function TableAnchorsDebug({ frame, label, seatArt }: TableAnchorsDebugProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Bumped whenever a plate this frame is waiting on finishes loading, so
  // the draw effect below re-runs and paints it in -- images decode
  // asynchronously and the first pass through the seats will usually miss.
  const [artVersion, setArtVersion] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    canvas.width = frame.width * dpr;
    canvas.height = frame.height * dpr;
    canvas.style.width = `${frame.width}px`;
    canvas.style.height = `${frame.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const camera = fitCamera(frame);

    drawFloor(ctx, camera, frame);
    drawContactShadow(ctx, camera);

    // People BEFORE the table. Everyone is behind the far rail, so the
    // table has to paint over their chests -- that occlusion is most of
    // what makes them read as sitting at it rather than floating behind it.
    // Furthest first, so a nearer neighbour overlaps a further one.
    const character = seatArt ? seatArtCharacter(seatArt) : null;

    const seated = [];
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      if (slot === HERO_SLOT) continue;
      seated.push({
        slot,
        floor: seatAnchor(slot),
        head: seatHead(slot),
        rawShoulders: seatShoulderRoom(slot),
        shoulders: seatShoulderRoom(slot) * FIGURE_WIDTH_RATIO,
        color: MARKER_COLOR.seat,
        label: `seat${slot}`,
      });
    }
    seated.push({
      slot: null,
      floor: dealerAnchor(),
      head: dealerHead(),
      rawShoulders: seatShoulderRoom(3),
      shoulders: seatShoulderRoom(3) * FIGURE_WIDTH_RATIO,
      color: MARKER_COLOR.dealer,
      label: "DEALER",
    });
    seated.sort((a, b) => a.floor.z - b.floor.z);
    for (const person of seated) {
      if (character && person.slot !== null) {
        const offset = seatAngleDeg(person.slot) - DEALER_ANGLE_DEG;
        const pick = pickSeatArt(character, offset);
        const image = loadSeatArt(pick.src, () => setArtVersion((v) => v + 1));
        if (image) {
          drawSeatArt(ctx, camera, image, person.floor, person.head, person.rawShoulders, pick.aspect, pick.mirror);
          continue;
        }
      }
      drawSeatedMarker(ctx, camera, person.floor, person.head, person.shoulders, person.color, person.label);
    }

    drawTable(ctx, camera);

    for (const marker of debugMarkers()) {
      if (marker.kind === "seat" || marker.kind === "dealer") continue;
      drawFeltMarker(ctx, camera, marker.position, MARKER_COLOR[marker.kind], marker.label);
    }

    drawHudLine(ctx, frame);
  }, [frame, seatArt, artVersion]);

  return (
    <div style={{ display: "inline-block" }}>
      {label ? (
        <div style={{ color: "#cfcfcf", font: "13px system-ui, sans-serif", marginBottom: 6 }}>{label}</div>
      ) : null}
      <canvas ref={canvasRef} style={{ borderRadius: 8, boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }} />
    </div>
  );
}
