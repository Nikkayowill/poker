"use client";

/**
 * Debug render of the 2.5D table: floor, table body, rail, felt, and a
 * marker at every anchor `lib/scene/table-anchors.ts` defines.
 *
 * A seated player is drawn as a stick and a head dot by default, which is
 * enough to judge whether the crowd sits where it should without pretending
 * to be art. Pass `seatArt` (a character id from `seat-art.generated.ts`) to
 * swap those placeholders for the real cutouts instead, at every seat that
 * character has a plate for. That's the other half of this tool's job:
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
  seatTrayAnchor,
  tableOutline,
  type Camera,
  type Frame,
  type Vec3,
} from "@/lib/scene/table-anchors";
import { MAX_PIXEL_RATIO } from "@/lib/scene/scene-config";
import { DESKTOP_BREAKPOINT_PX, pickSeatArtForSlot, seatArtCharacter, seatArtSlotFor } from "@/lib/scene/seat-art";

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
 * The band between the same outline at two heights: a solid's side wall.
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
  // sits above the top of the frame at this elevation, so the floor is the
  // background; there is no wall to light instead.
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

  // Pedestal first; the slab overlaps it, so no clipping needed.
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
 * Under 1 so neighbours never touch; real art should leave a gap too. */
const FIGURE_WIDTH_RATIO = 0.72;

/**
 * A seated player as a blank body block and a head disc.
 *
 * This has to stay featureless, not character art, but it occupies the
 * real volume a figure will. A thin stick makes any arrangement look like
 * heads floating over an empty table, so there'd be no way to judge
 * whether the crowd sits at the right height or whether six of them even
 * fit.
 *
 * `head` is the crown, so the disc hangs below it rather than being
 * centred on it (see SEATED_HEAD_Y).
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

/** Cross-request cache so a resize (a second `TableAnchorsDebug` on the same
 *  page, or a re-fit) never re-fetches a plate it already has. Keyed on the
 *  URL, which is the only identity a plate has. Every caller waiting on a
 *  still-loading plate registers its own listener: a lone `onload` would
 *  only wake the component that happened to start the fetch, and this page
 *  always has at least two (desktop and mobile) sharing one plate. */
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
  head: Vec3,
  hands: Vec3,
  aspect: number,
  mirror: boolean,
  slot: { scale: number; crown: number; offsetX: number; offsetY: number },
): boolean {
  const crown = project(camera, head);
  const grip = project(camera, hands);
  if (crown.depth <= 0 || grip.depth <= 0) return false;
  // The pixel gap between this seat's own crown and its own tray anchor,
  // different for every seat, which is the whole point. At scale 1 the
  // art's hands land exactly on `grip`; see SEAT_ART_SLOT's own note for
  // why this replaced a single ratio applied to every seat alike.
  const fit = grip.y - crown.y;
  if (fit <= 0) return false;
  const height = (fit / (1 - slot.crown)) * slot.scale;
  const width = height * aspect;
  // Anchored at the hands (grip), not the crown; see seatArtBox's own note
  // in lib/scene/seat-art.ts, which this has to match exactly. Growing the
  // box from a fixed head anchor pushed a scaled-up seat's hands down past
  // `grip` by fit * (scale - 1). Growing it from a fixed hands anchor keeps
  // every character's hands on the felt at any scale.
  const bottom = grip.y + slot.offsetY;
  const top = bottom - height;
  const boxLeft = crown.x - width / 2;

  ctx.save();
  if (mirror) {
    ctx.translate(crown.x, 0);
    ctx.scale(-1, 1);
    ctx.translate(-crown.x, 0);
  }
  // offsetX is screen-space (positive = rightward as drawn on screen); the
  // mirror above negates X displacement from the crown, so it has to be
  // un-negated here to keep that promise for a mirrored seat too.
  ctx.drawImage(image, boxLeft + (mirror ? -slot.offsetX : slot.offsetX), top, width, height);
  ctx.restore();
  return true;
}

export interface TableAnchorsDebugProps {
  frame: Frame;
  label?: string;
  /** A character id from `seat-art.generated.ts`: draws its cutouts at
   *  every seat it has a plate for instead of the placeholder markers.
   *  Sizing/position come from `seatArtSlotFor` in `lib/scene/seat-art.ts`;
   *  edit `SEAT_ART_SLOT` (shared) or `SEAT_ART_OVERRIDES` (per seat) there
   *  and save, this page hot-reloads. */
  seatArt?: string;
}

export function TableAnchorsDebug({ frame, label, seatArt }: TableAnchorsDebugProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Bumped whenever a plate this frame is waiting on finishes loading, so
  // the draw effect below re-runs and paints it in. Images decode
  // asynchronously, so the first pass through the seats will usually miss.
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

    const character = seatArt ? seatArtCharacter(seatArt) : null;

    const seated = [];
    for (let slot = 0; slot < SEAT_COUNT; slot += 1) {
      if (slot === HERO_SLOT) continue;
      seated.push({
        slot,
        floor: seatAnchor(slot),
        head: seatHead(slot),
        shoulders: seatShoulderRoom(slot) * FIGURE_WIDTH_RATIO,
        color: MARKER_COLOR.seat,
        label: `seat${slot}`,
      });
    }
    seated.push({
      slot: null,
      floor: dealerAnchor(),
      head: dealerHead(),
      shoulders: seatShoulderRoom(3) * FIGURE_WIDTH_RATIO,
      color: MARKER_COLOR.dealer,
      label: "DEALER",
    });
    seated.sort((a, b) => a.floor.z - b.floor.z);

    // This canvas's own frame decides desktop vs. mobile overrides, not
    // the browser window, which both frames share on this page. See
    // `getActiveOverrides` in seat-art.ts for why that distinction matters.
    const isDesktop = frame.width >= DESKTOP_BREAKPOINT_PX;

    // Resolved once per person so both passes below agree on who's drawing
    // as art vs. as a placeholder marker.
    const plans = seated.map((person) => {
      if (character && person.slot !== null) {
        const offset = seatAngleDeg(person.slot) - DEALER_ANGLE_DEG;
        const pick = pickSeatArtForSlot(character, person.slot, offset, isDesktop);
        const image = loadSeatArt(pick.src, () => setArtVersion((v) => v + 1));
        if (image) return { person, slot: person.slot, art: { image, pick } };
      }
      return { person, slot: person.slot, art: null };
    });

    // Placeholder markers before the table. These read as "sunk behind"
    // the rail, since the table paints over their chests, which is what
    // makes a bare stick-and-disc marker look seated at the table rather
    // than floating in front of it (there's no art here to show hands on
    // the felt with, so nothing is lost by occluding them).
    for (const { person, art } of plans) {
      if (!art) drawSeatedMarker(ctx, camera, person.floor, person.head, person.shoulders, person.color, person.label);
    }

    drawTable(ctx, camera);

    // Character art after the table, the same treatment the dealer's own
    // art gets in the real game: drawn over the cloth, not behind the
    // rail, because the whole composition is a pair of hands (and cards)
    // resting on the felt. Occluding that the way the placeholder markers
    // are occluded would clip away exactly the part the pose exists to
    // show. Same furthest-first order as the marker pass, so a nearer
    // neighbour still overlaps a further one among the art itself.
    for (const { person, slot, art } of plans) {
      if (art && slot !== null) {
        drawSeatArt(
          ctx, camera, art.image, person.head, seatTrayAnchor(slot), art.pick.aspect, art.pick.mirror,
          seatArtSlotFor(slot, isDesktop),
        );
      }
    }

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
