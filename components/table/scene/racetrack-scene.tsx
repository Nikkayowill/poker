"use client";

import { useEffect, useRef } from "react";
import type { PublicSeat } from "@/lib/game/types";
import type { BetAnimationStyle } from "@/lib/scene/bet-style";
import type { BetFlight } from "@/lib/scene/chips/bet-flight";
import { ChipScene } from "@/lib/scene/chips/chip-scene";
import { solveChipWorldRadius } from "@/lib/scene/chips/chip-spec";
import { METRES_PER_WORLD_UNIT, racetrackChipSpace, type ChipSpace } from "@/lib/scene/chip-space";
import { CHIP_RADIUS, MAX_PIXEL_RATIO } from "@/lib/scene/scene-config";
import { perspectiveProjection, scaledProjection, type SceneProjection } from "@/lib/scene/scene-projection";
import {
  DEALER_HEAD_Y,
  FELT_TOP_Y,
  SEAT_SETBACK,
  TABLE_OUTER,
  communityCardsAnchor,
  dealerAnchor,
  dealerHead,
  dealerShoulderRoom,
  feltOutline,
  fitCamera,
  potAnchor,
  seatAnchor,
  seatHead,
  seatShoulderRoom,
  seatTrayAnchor,
  type Camera,
} from "@/lib/scene/table-anchors";
import type { StackchipsSceneSeam } from "@/lib/scene/seam-contract";
import {
  afterFrame,
  clampDelta,
  isAwake,
  markDirty,
  SLEEPING,
  type SchedulerState,
} from "@/lib/scene/render-scheduler";
import { paintChip, paintChipShadow } from "./chip-painter";
import { paintRoom } from "./paint-room";

/**
 * The racetrack room: the table drawn from a real perspective camera.
 *
 * THE DIFFERENCE FROM `table-scene.tsx` IS WHICH LAYER IS IN CHARGE, and it
 * is worth stating plainly because the two files otherwise look alike.
 *
 * In the classic room the DOM is the authority: `.poker-rail` carries the
 * table as CSS background art, the seats ring a hand-tuned CSS ellipse
 * (`lib/game/table-geometry.ts`), and the canvas measures that rail and fits
 * its chips inside the ring the DOM already drew. Here it is the other way
 * round. The camera is solved from the frame, this canvas paints the table
 * from it, and the DOM follows -- seats, board and pot are positioned from
 * the anchors this component projects and hands up through `onLayout`. The
 * CSS ellipse plays no part.
 *
 * That inversion is forced rather than preferred: a perspective ring and a
 * CSS ellipse are not the same kind of curve, so unlike the classic room's
 * two ellipses they cannot be made to agree by tuning. One of them has to be
 * derived from the other, and only one of them knows where the camera is.
 */

/**
 * How much of the frame's bottom the local player's own furniture covers.
 *
 * The near rail is MEANT to run off the bottom edge and under this -- a near
 * rail that stops short reads as a small table across the room rather than
 * one you are sitting at -- so this is not a keep-out box for the table. It
 * only holds the far rail and the opponents' heads up out of the strip, which
 * is what `fitCamera` spends it on.
 *
 * Small, and smaller than the review render's 0.2, because that render framed
 * a whole viewport while this canvas fills `.table-area` only -- the action
 * bar is a sibling below it (`.action-layer`, 06-table.css) and is already
 * outside this box. Reserving the bar's height again here would count it
 * twice and push the crowd up by a strip that is not there. What is left
 * inside `.table-area` is the local player's own seat furniture along the
 * bottom, which is what this covers.
 */
const HUD_FRACTION = 0.12;

/**
 * How far the seat ring reaches in Z, for normalising a seat's nearness.
 *
 * The seats sit on the table's outline pushed out by `SEAT_SETBACK`, so this
 * is that ring's own half-width -- derived rather than typed, so a change to
 * either term cannot leave a seat reporting a nearness outside 0..1.
 */
const SEAT_RING_HALF_WIDTH = TABLE_OUTER.halfWidth + SEAT_SETBACK;

/** Where the DOM should put everything that is not painted here. */
export interface RacetrackLayout {
  /** Canvas-local CSS pixels, and the size the canvas was measured at. */
  width: number;
  height: number;
  seats: Array<{
    slot: number;
    /** The seat's crown, canvas-local CSS pixels. */
    x: number;
    y: number;
    /**
     * Where this seat's hands belong -- the chip tray on the rail, canvas-local
     * CSS pixels. Same anchor `lib/scene/seat-art.ts` sizes a character's art
     * from: the pixel gap between this and the crown above is the exact height
     * that puts that seat's hands on its own rail, at any camera distance.
     */
    hands: { x: number; y: number };
    /**
     * How wide a figure at this seat may be drawn, in CSS pixels, before it
     * touches its neighbour. Projected from the seat's own world budget, so a
     * nearer chair correctly gets more room than a further one.
     */
    shoulderPx: number;
    /** 0 at the far rail, 1 nearest the viewer -- the DOM's own convention. */
    near: number;
    /**
     * Direction from this seat toward the middle of the table, in screen
     * space, for everything that hangs off a seat and belongs between the
     * player and the pot.
     *
     * Box-normalised (the larger component is exactly 1), not Euclidean, and
     * for the reason `lib/game/table-geometry.ts` gives at length: a seat is
     * a rectangle, so scaling a Euclidean unit vector by half the box lands
     * on its inscribed ellipse and a seat on a diagonal puts its bet chip in
     * the corner, on top of its own nameplate.
     */
    toward: { x: number; y: number };
  }>;
  board: { x: number; y: number };
  pot: { x: number; y: number };
  /**
   * The dealer's place at far centre. She is not one of the six seats -- a
   * real oval table has a dealer cutout there and no chair -- so she is
   * reported separately and carries no nameplate.
   */
  dealer: { x: number; y: number; shoulderPx: number };
}

export interface RacetrackSceneProps {
  seats: PublicSeat[];
  pot: number;
  bigBlind: number;
  streetBets: Array<{ slot: number; amount: number }>;
  street: string;
  paying: boolean;
  winners: Array<{ slot: number; amount: number }>;
  handNumber: number;
  betFlights: BetFlight[];
  betStyle: BetAnimationStyle;
  onReady?: (ready: boolean) => void;
  /** Fires on mount and on every re-fit. See `RacetrackLayout`. */
  onLayout?: (layout: RacetrackLayout) => void;
}

export function RacetrackScene({
  seats,
  pot,
  bigBlind,
  streetBets,
  street,
  paying,
  winners,
  handNumber,
  betFlights,
  betStyle,
  onReady,
  onLayout,
}: RacetrackSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Held in refs so the mount effect stays mount-only: a parent passing an
  // inline callback would otherwise rebuild the canvas on every render.
  const onReadyRef = useRef(onReady);
  const onLayoutRef = useRef(onLayout);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onLayoutRef.current = onLayout; }, [onLayout]);

  const pumpRef = useRef<(() => void) | null>(null);
  /** Re-publish the DOM anchors. Needed outside a resize: the headcount
   *  changing re-spaces the whole far arc (see `seatAnglesDeg`). */
  const publishLayoutRef = useRef<(() => void) | null>(null);
  const engineRef = useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    chips: ChipScene;
    /** The drawn chip radius this fit solved for, in world units. */
    chipRadius: number;
    space: ChipSpace;
    scheduler: SchedulerState;
    camera: Camera;
    /** Metres to pixels, for the room. */
    room: SceneProjection;
    /** Chip world units to pixels -- the room's projection, scaled. */
    chipView: SceneProjection;
    size: { width: number; height: number };
    lastFrameMs: number;
    frames: number;
    reducedMotion: boolean;
    seatCount: number;
    handledFlights: Set<string>;
    funnelledHand: number | null;
    lastFunnelSlots: number[];
    disposed: boolean;
  } | null>(null);

  /* ------------------------------------------------------------------ *
   * Mount. Runs once; the loop takes over from here.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // No 2D context. The caller keeps `.scene-lit` off, so the DOM felt
      // and rail paint themselves and the table is the classic one.
      onReadyRef.current?.(false);
      return;
    }
    host.appendChild(canvas);

    const markChanged = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;
      engine.scheduler = markDirty(engine.scheduler, performance.now());
    };

    const space = racetrackChipSpace();
    const chips = new ChipScene(markChanged);
    // Once, at mount, and never again: unlike the classic room's ellipse this
    // table is a fixed physical object, so nothing about a resize moves an
    // anchor. Only the camera adapts.
    chips.setSpace(space);

    const startCamera = fitCamera({ width: 1, height: 1, hudFraction: HUD_FRACTION });
    engineRef.current = {
      canvas,
      ctx,
      chips,
      space,
      scheduler: markDirty(SLEEPING, performance.now()),
      camera: startCamera,
      room: perspectiveProjection(startCamera),
      chipView: scaledProjection(perspectiveProjection(startCamera), METRES_PER_WORLD_UNIT),
      chipRadius: CHIP_RADIUS,
      size: { width: 0, height: 0 },
      lastFrameMs: performance.now(),
      frames: 0,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      seatCount: Math.max(1, seats.length),
      handledFlights: new Set(),
      funnelledHand: null,
      lastFunnelSlots: [],
      disposed: false,
    };

    /**
     * Re-solve the camera for the canvas's measured box, and tell the DOM
     * where everything landed.
     *
     * No DOM measurement beyond the host's own box, which is the whole point
     * of this renderer: the classic room reads `.poker-rail` because the CSS
     * owns the table there. Here the frame is the only input.
     */
    const fit = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;
      const hostBox = host.getBoundingClientRect();
      if (hostBox.width < 1 || hostBox.height < 1) return;
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      engine.canvas.width = Math.round(hostBox.width * ratio);
      engine.canvas.height = Math.round(hostBox.height * ratio);
      engine.size = { width: hostBox.width, height: hostBox.height };

      engine.camera = fitCamera({
        width: hostBox.width,
        height: hostBox.height,
        hudFraction: HUD_FRACTION,
      });
      engine.room = perspectiveProjection(engine.camera);
      engine.chipView = scaledProjection(engine.room, METRES_PER_WORLD_UNIT);
      // Solved at the pot, which is the depth the mound actually sits at. A
      // chip nearer the camera than that draws larger and one at the far rail
      // smaller, which is the perspective doing its job -- what this pins is
      // the scale everything is *laid out* against, so the mound's columns and
      // the chips filling them agree about how big a chip is.
      engine.chipRadius = solveChipWorldRadius(
        CHIP_RADIUS,
        engine.chipView.scaleAt(engine.space.pot()),
      );
      engine.chips.setChipRadius(engine.chipRadius);
      publishLayout();
      markChanged();
      // Not just `markChanged`. A resize is the one event that can arrive
      // while the loop is stopped, and `markChanged` only sets a flag -- with
      // no frame pending there is nobody left to read it. The classic room
      // gets away with the same omission because its canvas holds only chips,
      // so a resize with none in flight changes nothing on screen; here the
      // canvas holds the whole table and would keep showing it at the old
      // size until the next bet.
      pumpRef.current?.();
    };

    /**
     * Hand the DOM the projected anchors.
     *
     * Seats are reported at every slot the TABLE has, not every slot the hand
     * has, and the hero's own chair is included even though no figure is ever
     * drawn there -- the caller decides what to mount, and a layout that
     * silently omitted a slot would be indistinguishable from a seat the
     * caller forgot to position.
     */
    const publishLayout = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;
      const count = engine.seatCount;
      const seatLayout: RacetrackLayout["seats"] = [];
      for (let slot = 0; slot < count; slot += 1) {
        const head = seatHead(slot, count);
        const crown = engine.room.project(head);
        const floor = seatAnchor(slot, count);
        // Measured across the seat at head height, so the width shortens with
        // distance exactly as the figure drawn in it should.
        const room = seatShoulderRoom(slot, count);
        const left = engine.room.project({ x: floor.x - room / 2, y: head.y, z: floor.z });
        const right = engine.room.project({ x: floor.x + room / 2, y: head.y, z: floor.z });
        const hands = engine.room.project(seatTrayAnchor(slot, count));
        seatLayout.push({
          slot,
          x: crown.x,
          y: crown.y,
          hands: { x: hands.x, y: hands.y },
          shoulderPx: Math.abs(right.x - left.x),
          // World Z runs toward the camera and the seat ring spans the table's
          // own half-width, so this maps the far rail to 0 and the near one
          // to 1 -- the same 0..1 the DOM ellipse reports.
          near: (floor.z / SEAT_RING_HALF_WIDTH + 1) / 2,
          // Overwritten below, once the pot's own screen position is known.
          toward: { x: 0, y: -1 },
        });
      }
      const dealerFloor = dealerAnchor();
      const dealerCrown = engine.room.project(dealerHead());
      const dealerRoom = dealerShoulderRoom(count);
      const dealerLeft = engine.room.project({ x: dealerFloor.x - dealerRoom / 2, y: DEALER_HEAD_Y, z: dealerFloor.z });
      const dealerRight = engine.room.project({ x: dealerFloor.x + dealerRoom / 2, y: DEALER_HEAD_Y, z: dealerFloor.z });

      const board = engine.room.project(communityCardsAnchor());
      const potSpot = engine.room.project(potAnchor());
      // Toward the pot as it actually appears, not as the plan says: under
      // perspective a seat's inward direction on screen is not the direction
      // from its plan position to the felt's centre.
      for (const seat of seatLayout) {
        const inwardX = potSpot.x - seat.x;
        const inwardY = potSpot.y - seat.y;
        const dominant = Math.max(Math.abs(inwardX), Math.abs(inwardY)) || 1;
        seat.toward = { x: inwardX / dominant, y: inwardY / dominant };
      }
      onLayoutRef.current?.({
        width: engine.size.width,
        height: engine.size.height,
        seats: seatLayout,
        board: { x: board.x, y: board.y },
        pot: { x: potSpot.x, y: potSpot.y },
        dealer: {
          x: dealerCrown.x,
          y: dealerCrown.y,
          shoulderPx: Math.abs(dealerRight.x - dealerLeft.x),
        },
      });
    };

    publishLayoutRef.current = publishLayout;
    fit();

    const observer = new ResizeObserver(fit);
    observer.observe(host);
    window.addEventListener("orientationchange", fit);

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => {
      const engine = engineRef.current;
      if (engine) engine.reducedMotion = motionQuery.matches;
    };
    motionQuery.addEventListener("change", onMotionChange);

    /* ---------------------------------------------------------------- *
     * The loop. Wakes on a change, sleeps when the felt is still.
     *
     * It sleeps even though this canvas holds the entire room rather than
     * only the chips, and that is worth stating because the opposite is the
     * natural assumption: a canvas keeps its pixels when nobody draws to it,
     * so a stopped loop leaves the table on screen exactly as it was. What
     * a stopped loop cannot do is notice that something needs redrawing --
     * hence `pump` on every event that changes the picture, `fit` included.
     *
     * The one thing NOT to copy from here: the room is repainted in full on
     * every frame, where the classic room clears to transparent and paints
     * only chips. That is the price of owning the table, and it is paid
     * only while something is actually moving.
     * ---------------------------------------------------------------- */
    let frameHandle = 0;
    const tick = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;

      const now = performance.now();
      // A backgrounded tab hands back a delta of minutes on its first frame.
      // Uncapped, that single delta closes every chip's remaining distance at
      // once and the pot teleports.
      const delta = clampDelta(now - engine.lastFrameMs);
      engine.lastFrameMs = now;

      const moved = engine.chips.update(delta, engine.reducedMotion);

      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      engine.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintRoom(engine.ctx, engine.camera, engine.size);
      // Painter's algorithm: far chips first, and within one column the lower
      // chips first, so a stack occludes itself correctly.
      const drawList = engine.chips.drawList()
        .sort((a, b) => a.position.z - b.position.z || a.stackIndex - b.stackIndex);
      // Two passes: every shadow down before any chip, or the near chips'
      // shadows land across the far chips' faces. See `chip-painter.ts`.
      for (const chip of drawList) {
        paintChipShadow(engine.ctx, engine.chipView, engine.space, chip, engine.chipRadius);
      }
      for (const chip of drawList) {
        paintChip(engine.ctx, engine.chipView, engine.space, chip, engine.chipRadius);
      }
      engine.frames += 1;

      engine.scheduler = engine.chips.isIdle()
        ? SLEEPING
        : afterFrame(engine.scheduler, now, moved);
      frameHandle = isAwake(engine.scheduler) ? requestAnimationFrame(tick) : 0;
    };

    const pump = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;
      if (frameHandle === 0) {
        engine.lastFrameMs = performance.now();
        frameHandle = requestAnimationFrame(tick);
      }
    };
    pumpRef.current = pump;
    pump();
    onReadyRef.current?.(true);

    /* The e2e seam -- see `StackchipsSceneSeam`. Both rooms answer the same
       questions in viewport CSS pixels, so a spec runs against whichever is
       mounted. `roomScale` is measured at the felt plane and is NOT a
       constant here: this is a perspective camera, and the interface's own
       header says so. */
    {
      const toViewport = (point: { x: number; y: number }) => {
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + point.x, y: rect.top + point.y };
      };
      const seam: StackchipsSceneSeam = {
        chips: () => {
          const engine = engineRef.current;
          if (!engine) return [];
          return engine.chips.debugChipPositions()
            .map((position) => toViewport(engine.chipView.project(position)));
        },
        pileSize: () => engineRef.current?.chips.debugPileSize() ?? 0,
        seat: (slot: number) => {
          const engine = engineRef.current;
          if (!engine) return { x: 0, y: 0 };
          return toViewport(engine.room.project(seatHead(slot, engine.seatCount)));
        },
        betSpot: (slot: number) => {
          const engine = engineRef.current;
          if (!engine) return { x: 0, y: 0 };
          return toViewport(engine.chipView.project(engine.space.betSpot(slot, engine.seatCount)));
        },
        roomScale: () => {
          const engine = engineRef.current;
          if (!engine) return 0;
          // Per world unit at the felt's centre, to match the orthographic
          // room's units. Only meaningful there; see the header.
          return engine.chipView.scaleAt({ x: 0, y: engine.space.feltY, z: 0 });
        },
        roomFelt: () => {
          const engine = engineRef.current;
          if (!engine) return { width: 0, height: 0 };
          return feltScreenSize(engine.room);
        },
        roomLift: () => engineRef.current?.room.project({ x: 0, y: 0, z: 0 }).y ?? 0,
        lastFunnel: () => engineRef.current?.lastFunnelSlots ?? [],
        awake: () => isAwake(engineRef.current?.scheduler ?? SLEEPING),
        framesRendered: () => engineRef.current?.frames ?? 0,
      };
      window.__stackchipsScene = seam;
    }

    return () => {
      const engine = engineRef.current;
      onReadyRef.current?.(false);
      observer.disconnect();
      window.removeEventListener("orientationchange", fit);
      motionQuery.removeEventListener("change", onMotionChange);
      if (frameHandle) cancelAnimationFrame(frameHandle);
      publishLayoutRef.current = null;
      delete window.__stackchipsScene;
      if (engine) engine.disposed = true;
      canvas.remove();
      engineRef.current = null;
      pumpRef.current = null;
    };
    // Mount-only. Every prop below is applied through its own effect against
    // the live engine rather than by tearing the canvas down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ *
   * Seat count follows the table. Unlike the classic room this also moves
   * every seat -- the crowd is clustered on the far arc and re-spaced for
   * the headcount (see `seatAnglesDeg`) -- so the DOM has to be told.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const count = Math.max(1, seats.length);
    if (count === engine.seatCount) return;
    engine.seatCount = count;
    publishLayoutRef.current?.();
    pumpRef.current?.();
  }, [seats]);

  useEffect(() => {
    engineRef.current?.chips.setBetStyle(betStyle);
  }, [betStyle]);

  /* ------------------------------------------------------------------ *
   * The street turning over: sweep the standing bets in before anything
   * else about the new street renders. Keyed on the street *within* a
   * hand -- a new hand starting on preflop is not a sweep, it is a clear.
   * ------------------------------------------------------------------ */
  const streetRef = useRef<{ handNumber: number; street: string } | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const previous = streetRef.current;
    streetRef.current = { handNumber, street };
    if (!previous) return;
    if (previous.handNumber !== handNumber) {
      // Handled here rather than in its own effect so it runs BEFORE the sync
      // effect below on the same commit -- a trailing effect would clear the
      // new hand's just-synced blinds.
      engine.handledFlights.clear();
      engine.chips.clearFlights();
      engine.chips.clearBets();
      pumpRef.current?.();
    } else if (previous.street !== street) {
      engine.chips.sweepBets();
      pumpRef.current?.();
    }
  }, [street, handNumber]);

  /* ------------------------------------------------------------------ *
   * The pot, as a pile -- minus what is still standing in front of the
   * bettors, so the felt's chips always sum to the pot the HUD states.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const standing = streetBets.reduce((sum, bet) => sum + bet.amount, 0);
    engine.chips.syncPile(Math.max(0, pot - standing), bigBlind, paying);
    // Deliberately no `clearBets()` on the paying branch. The chips standing
    // in front of the callers are part of the pot that was just won, and
    // `payOut` sends them to the winner from where they stand; deleting them
    // here is what used to make a caller's bet blink out of existence the
    // moment the hand ended.
    if (!paying) engine.chips.syncBets(streetBets, engine.seatCount, bigBlind);
    pumpRef.current?.();
  }, [pot, bigBlind, paying, streetBets]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const flight of betFlights) {
      // Consumed by id: the parent keeps a flight in its list for the duration
      // of the animation, so this effect sees each one on several renders and
      // must spawn it exactly once.
      if (engine.handledFlights.has(flight.id)) continue;
      engine.handledFlights.add(flight.id);
      engine.chips.spawnBet(flight.slot, engine.seatCount, flight.amount, bigBlind, flight.kind);
    }
    pumpRef.current?.();
  }, [betFlights, bigBlind]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!paying || winners.length === 0) return;
    if (engine.funnelledHand === handNumber) return;
    engine.funnelledHand = handNumber;
    engine.lastFunnelSlots = winners.map((winner) => winner.slot);
    // The bets are already the pot by the time it is won, so nothing may still
    // be on its way in when it starts leaving. Cleared before `spawnFunnel`,
    // not after: clearing second would sweep up the very spray this launches.
    engine.chips.clearFlights();
    engine.chips.payOut(winners, engine.seatCount, bigBlind);
    pumpRef.current?.();
  }, [paying, winners, handNumber, bigBlind]);

  return <div className="table-scene table-scene-racetrack" ref={hostRef} aria-hidden="true" />;
}

/**
 * The cloth's on-screen extent, for the e2e seam.
 *
 * Measured off the projected outline rather than computed, because under
 * perspective the felt's screen box is not a function of any one radius: the
 * near edge is closer to the lens than the far one, so it spreads wider, and
 * the widest point of the drawn shape is not the widest point of the plan.
 */
function feltScreenSize(room: SceneProjection): { width: number; height: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of feltOutline()) {
    const screen = room.project({ x: point.x, y: FELT_TOP_Y, z: point.z });
    minX = Math.min(minX, screen.x);
    maxX = Math.max(maxX, screen.x);
    minY = Math.min(minY, screen.y);
    maxY = Math.max(maxY, screen.y);
  }
  return { width: maxX - minX, height: maxY - minY };
}
