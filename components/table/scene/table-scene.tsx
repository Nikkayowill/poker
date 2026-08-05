"use client";

import { useEffect, useRef } from "react";
import type { PublicSeat } from "@/lib/game/types";
import { ChipLayer } from "@/lib/scene/chip-layer";
import { fitView, project, type SceneView } from "@/lib/scene/projection";
import { FELT, MAX_PIXEL_RATIO } from "@/lib/scene/scene-config";
import { ringPoint } from "@/lib/scene/seat-ring";
import {
  afterFrame,
  clampDelta,
  isAwake,
  markDirty,
  SLEEPING,
  type SchedulerState,
} from "@/lib/scene/render-scheduler";
import { carpetTile, paintChip, paintRoom } from "./paint";

/**
 * The 2.5D room, painted in Canvas 2D behind the DOM table.
 *
 * Everything with a shape lives in here; everything with words in it stays
 * in the DOM on top. That split is not a compromise, it is the point — a
 * player's name, their stack, the pot and every button have to be
 * selectable, translatable, screen-reader-addressable and pixel-crisp at
 * any zoom, and a painted pixel is none of those things. The HUD — seats,
 * avatars, cards, feed, action bar, sounds — is exactly the HUD it was
 * before this canvas existed; the canvas only paints the furniture and the
 * chips.
 *
 * MOUNTING. The canvas fills `.table-area` and sits at the bottom of its
 * stacking order (`app/styles/24-scene.css`), so every existing DOM layer
 * draws over it with no z-index changes anywhere. It is
 * `pointer-events: none` and `aria-hidden`, so it cannot intercept a tap
 * meant for a button or add a single node to the accessibility tree.
 *
 * FAILING SOFT. If a 2D context cannot be created, this mounts nothing and
 * the table is exactly the DOM table it was before: `.scene-lit` is never
 * applied, so the CSS felt and rail keep painting themselves. The pot's
 * value is always legible in `.pot-display` regardless of whether a single
 * chip ever renders.
 */

export interface TableSceneProps {
  /** Seats in ring order: index 0 is the near edge, the local player. */
  seats: PublicSeat[];
  pot: number;
  bigBlind: number;
  /**
   * Each seat's committed-this-street amount, by ring slot. These render as
   * standing chip piles in front of the bettors; the centre pile shows the
   * pot minus their sum, so the felt's chips always total the pot the HUD
   * states.
   */
  streetBets: Array<{ slot: number; amount: number }>;
  /**
   * The current street. When it changes within a hand, the standing bets
   * sweep into the middle — the dealer pulling the action in before the
   * next card.
   */
  street: string;
  /** The hand is over and the pot is on its way to the winners. */
  paying: boolean;
  /**
   * The winning seats, as ring slots, each with the amount it actually won
   * — the funnel flies each winner's own payout as chips.
   */
  winners: Array<{ slot: number; amount: number }>;
  /** Changes once per hand, so the funnel fires exactly once. */
  handNumber: number;
  /**
   * Bets to fly in, as detected by the parent, each carrying the amount the
   * seat actually committed — the spray is that number as chips. Consumed
   * by id.
   */
  betFlights: Array<{ id: string; slot: number; amount: number }>;
  /**
   * True once a context exists and the room is painting, false if one could
   * not be created or has been torn down. The caller needs this: the DOM
   * felt and rail stop painting themselves only when the room is genuinely
   * there to replace them (`.scene-lit` in `app/styles/24-scene.css`).
   */
  onReady?: (ready: boolean) => void;
}

/** The e2e seam. See `ChipLayer.debugChipPositions`. */
declare global {
  interface Window {
    __stackchipsScene?: {
      /** Chips in flight, projected into viewport CSS pixels. */
      chips: () => Array<{ x: number; y: number }>;
      pileSize: () => number;
      /** Where the scene thinks a ring slot is, in viewport CSS pixels. */
      seat: (slot: number) => { x: number; y: number };
      /** CSS pixels per world unit — the whole fit, under orthography. */
      roomScale: () => number;
      /** Where world-origin's screen Y landed, canvas-local. */
      roomLift: () => number;
      /** Ring slots the last payout was aimed at. */
      lastFunnel: () => number[];
      awake: () => boolean;
      framesRendered: () => number;
    };
  }
}

export function TableScene({
  seats,
  pot,
  bigBlind,
  streetBets,
  street,
  paying,
  winners,
  handNumber,
  betFlights,
  onReady,
}: TableSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Held in a ref so the mount effect can stay mount-only: a parent passing
  // an inline callback would otherwise rebuild the canvas on every render.
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  /**
   * Restarts a loop that has already stopped. `markDirty` alone cannot:
   * once the last frame has been requested there is nobody left reading the
   * flag, so every prop effect below has to be able to kick the loop back
   * into life as well as mark it dirty.
   */
  const pumpRef = useRef<(() => void) | null>(null);
  /**
   * Everything the render loop touches, in one ref. Not state, deliberately:
   * none of it should ever cause a React render. This component renders
   * exactly once and then the loop owns the canvas.
   */
  const engineRef = useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    carpet: CanvasPattern | null;
    chips: ChipLayer;
    scheduler: SchedulerState;
    view: SceneView;
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
      // No 2D context — vanishingly rare, but the failure mode must be the
      // painted DOM table, not an unpainted one.
      onReadyRef.current?.(false);
      return;
    }
    host.appendChild(canvas);

    const markChanged = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;
      engine.scheduler = markDirty(engine.scheduler, performance.now());
    };

    engineRef.current = {
      canvas,
      ctx,
      carpet: ctx.createPattern(carpetTile(), "repeat"),
      chips: new ChipLayer(markChanged),
      scheduler: markDirty(SLEEPING, performance.now()),
      view: { cx: 0, cy: 0, scale: 1 },
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
     * Fit the room to the DOM table's measured box.
     *
     * Closed-form, not a solver: under orthography the felt's projected
     * width is exactly `2 * radiusX * scale`, so pinning it to
     * `.poker-table-wrap`'s width is one division. The DPI handling sizes
     * the backing store to CSS pixels x devicePixelRatio (capped — a phone
     * reporting 3 or 4 would shade up to sixteen times the pixels for soft
     * gradients) and folds the ratio into one setTransform, so every draw
     * call works in CSS pixels.
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

      const root = host.parentElement ?? host;
      const wrapBox = root.querySelector<HTMLElement>(".poker-table-wrap")?.getBoundingClientRect();
      const wrap = wrapBox && wrapBox.width > 1
        ? {
          left: wrapBox.left - hostBox.left,
          top: wrapBox.top - hostBox.top,
          width: wrapBox.width,
          height: wrapBox.height,
        }
        // Before React has laid the table out there is no wrap to measure;
        // a centred approximation holds for the frame or two until the
        // ResizeObserver re-runs this with a real box.
        : { left: hostBox.width * 0.09, top: hostBox.height * 0.2, width: hostBox.width * 0.82, height: hostBox.height * 0.6 };
      engine.view = fitView(wrap);
      markChanged();
    };
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
     * ---------------------------------------------------------------- */
    let frameHandle = 0;
    const tick = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;

      const now = performance.now();
      // A backgrounded tab hands back a delta of minutes on its first
      // frame. Uncapped, that single delta closes every chip's remaining
      // distance at once and the pot teleports.
      const delta = clampDelta(now - engine.lastFrameMs);
      engine.lastFrameMs = now;

      const moved = engine.chips.update(delta, engine.reducedMotion);

      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      engine.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintRoom(engine.ctx, engine.view, engine.size, engine.carpet);
      // Painter's algorithm: draw far chips first, and within one column
      // the lower chips first, so a stack occludes itself correctly.
      const chips = engine.chips.drawList()
        .sort((a, b) => a.position.z - b.position.z || a.position.y - b.position.y);
      for (const chip of chips) paintChip(engine.ctx, engine.view, chip);
      engine.frames += 1;

      engine.scheduler = afterFrame(engine.scheduler, now, moved);
      // Re-arm only while awake. This is the whole battery saving: an idle
      // table stops requesting frames entirely rather than repainting an
      // unchanged scene sixty times a second.
      frameHandle = isAwake(engine.scheduler) ? requestAnimationFrame(tick) : 0;
    };

    const pump = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;
      if (frameHandle === 0 && isAwake(engine.scheduler)) {
        engine.lastFrameMs = performance.now();
        frameHandle = requestAnimationFrame(tick);
      }
    };
    pumpRef.current = pump;
    pump();
    onReadyRef.current?.(true);

    /**
     * The test seam.
     *
     * A DOM chip could be measured with `getBoundingClientRect`; a painted
     * one cannot, so without this `tests/e2e/chip-flights.spec.ts` — which
     * exists because the pot once landed fifty pixels short of every winner
     * and nothing failed — would quietly stop asserting anything at all.
     * Shipped in production rather than dev-gated on purpose: it exposes
     * projected chip coordinates and a frame counter, all of which are
     * already on screen.
     */
    {
      const toViewport = (point: { x: number; y: number }) => {
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + point.x, y: rect.top + point.y };
      };
      window.__stackchipsScene = {
        chips: () => {
          const engine = engineRef.current;
          if (!engine) return [];
          return engine.chips.debugChipPositions()
            .map((position) => toViewport(project(engine.view, position)));
        },
        pileSize: () => engineRef.current?.chips.debugPileSize() ?? 0,
        seat: (slot: number) => {
          const engine = engineRef.current;
          if (!engine) return { x: 0, y: 0 };
          return toViewport(project(engine.view, ringPoint(slot, engine.seatCount, 1, FELT.y)));
        },
        roomScale: () => engineRef.current?.view.scale ?? 0,
        roomLift: () => engineRef.current?.view.cy ?? 0,
        lastFunnel: () => engineRef.current?.lastFunnelSlots ?? [],
        awake: () => isAwake(engineRef.current?.scheduler ?? SLEEPING),
        framesRendered: () => engineRef.current?.frames ?? 0,
      };
    }

    return () => {
      const engine = engineRef.current;
      onReadyRef.current?.(false);
      observer.disconnect();
      window.removeEventListener("orientationchange", fit);
      motionQuery.removeEventListener("change", onMotionChange);
      if (frameHandle) cancelAnimationFrame(frameHandle);
      delete window.__stackchipsScene;
      if (engine) engine.disposed = true;
      canvas.remove();
      engineRef.current = null;
      pumpRef.current = null;
    };
    // Mount-only. Every prop below is applied through its own effect
    // against the live engine rather than by tearing the canvas down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ *
   * Seat count follows the table.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.seatCount = Math.max(1, seats.length);
  }, [seats]);

  /* ------------------------------------------------------------------ *
   * The street turning over: sweep the standing bets in before anything
   * else about the new street renders. Keyed on the street *within* a
   * hand — a new hand starting on preflop is not a sweep, it is a clear
   * (handled below), and an all-in runout that jumps several streets at
   * once still sweeps exactly once.
   * ------------------------------------------------------------------ */
  const streetRef = useRef<{ handNumber: number; street: string } | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const previous = streetRef.current;
    streetRef.current = { handNumber, street };
    if (!previous) return;
    if (previous.handNumber !== handNumber) {
      // A hand boundary, handled here rather than in its own effect so it
      // runs BEFORE the sync effect below on the same commit — a trailing
      // effect would clear the new hand's just-synced blinds. Nothing from
      // the old hand stays in the air, and no stale standing bet sweeps
      // across the boundary; the new blinds re-sync as their own piles.
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
   * The pot, as a pile — minus what is still standing in front of the
   * bettors, so the felt's chips always sum to the pot the HUD states.
   * The standing bets themselves sync through the same keyed discipline
   * the pile uses. During the payout both are cleared: the pot flying
   * out already contains every bet.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const standing = streetBets.reduce((sum, bet) => sum + bet.amount, 0);
    engine.chips.syncPile(Math.max(0, pot - standing), bigBlind, paying);
    if (paying) {
      engine.chips.clearBets();
    } else {
      engine.chips.syncBets(streetBets, engine.seatCount, bigBlind);
    }
    pumpRef.current?.();
  }, [pot, bigBlind, paying, streetBets]);

  /* ------------------------------------------------------------------ *
   * Bets in, pot out.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const flight of betFlights) {
      // Consumed by id: the parent keeps a flight in its list for the
      // duration of the animation, so this effect sees each one on several
      // renders and must spawn it exactly once.
      if (engine.handledFlights.has(flight.id)) continue;
      engine.handledFlights.add(flight.id);
      engine.chips.spawnBet(flight.slot, engine.seatCount, flight.amount, bigBlind);
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
    /**
     * The bets are already the pot by the time it is won, so nothing may
     * still be on its way into the middle when it starts leaving. The slide
     * is asymptotic and takes roughly 1.2s to close a seat-to-pot gap, so a
     * hand that ends on a call has that caller's chips barely a third of
     * the way in when the payout fires; left alone they crawl into a centre
     * the pile has vacated while the payout flies the other way. Cleared
     * before `spawnFunnel`, not after: the payout's own chips are equally
     * transient, and clearing second would sweep up the very spray this is
     * about to launch.
     */
    engine.chips.clearFlights();
    engine.chips.spawnFunnel(winners, engine.seatCount, bigBlind);
    pumpRef.current?.();
  }, [paying, winners, handNumber, bigBlind]);

  return <div className="table-scene" ref={hostRef} aria-hidden="true" />;
}
