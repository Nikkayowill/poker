"use client";

import { useEffect, useRef } from "react";
import type { PublicSeat } from "@/lib/game/types";
import type { BetAnimationStyle } from "@/lib/scene/bet-style";
import type { BetFlight } from "@/lib/scene/chips/bet-flight";
import { ChipScene } from "@/lib/scene/chips/chip-scene";
import { solveChipWorldRadius } from "@/lib/scene/chips/chip-spec";
import {
  fitView, project, projectedFeltDepth, projectedFeltWidth, type SceneView,
} from "@/lib/scene/projection";
import { classicChipSpace, type ChipSpace } from "@/lib/scene/chip-space";
import { orthographicProjection } from "@/lib/scene/scene-projection";
import { CHIP_RADIUS, FELT, MAX_PIXEL_RATIO } from "@/lib/scene/scene-config";
import {
  NEAR_SEAT_BET_INSET,
  NEAR_SEAT_BET_INSET_DESKTOP,
  ringPoint,
  seatBetOrigin,
} from "@/lib/scene/seat-ring";
// Type-only, but it is what installs the `Window.__stackchipsScene`
// augmentation for this file. The shape is shared with the R3F room; see
// that module's header for why it is one declaration and not two.
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

/**
 * The chip layer, painted in Canvas 2D over the DOM table.
 *
 * The felt, rail and room are real art now (`public/pokertable/`,
 * `app/styles/06-table.css`/`05-game-header.css`), painted as ordinary CSS
 * the same way every other piece of chrome in this app is. This canvas
 * exists only for the chips, which move every frame and have no DOM
 * equivalent that could keep up. Everything with words in it stays in the
 * DOM on top, exactly as before: a player's name, their stack, the pot and
 * every button have to be selectable, translatable, screen-reader-
 * addressable and pixel-crisp at any zoom, and a painted pixel is none of
 * those things.
 *
 * The canvas fills `.table-area` and sits at the bottom of its stacking
 * order (`app/styles/99-scene.css`), so every existing DOM layer draws over
 * it with no z-index changes anywhere. It is `pointer-events: none` and
 * `aria-hidden`, so it cannot intercept a tap meant for a button or add a
 * single node to the accessibility tree.
 *
 * If a 2D context cannot be created, this mounts nothing and the table is
 * exactly the DOM table it was before: `.scene-lit` is never applied, so
 * the CSS felt and rail keep painting themselves. The pot's value is always
 * legible in `.center-pot-amount` regardless of whether a single chip ever
 * renders.
 */

/**
 * Matches `16-first-person.css`'s own `min-width: 901px`, the breakpoint
 * that hides `.seat-mine .seat-figure` and switches the near seat's bet
 * reach from the figure-avoiding corridor to the ordinary seat inset (see
 * `NEAR_SEAT_BET_INSET_DESKTOP`). Written here rather than imported: this
 * file has no access to the stylesheet, so the pixel value is one decision
 * kept in step by hand, the same way `LANDSCAPE_MAX_HEIGHT_PX`
 * (table-geometry.ts) keeps its own media query in step.
 */
const NEAR_SEAT_DESKTOP_MIN_WIDTH_PX = 901;

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
   * sweep into the middle, the dealer pulling the action in before the
   * next card.
   */
  street: string;
  /** The hand is over and the pot is on its way to the winners. */
  paying: boolean;
  /**
   * The winning seats, as ring slots, each with the amount it actually won.
   * The funnel flies each winner's own payout as chips.
   */
  winners: Array<{ slot: number; amount: number }>;
  /** Changes once per hand, so the funnel fires exactly once. */
  handNumber: number;
  /**
   * Bets to fly in, as detected by the parent, each carrying the amount the
   * seat actually committed; the spray is that number as chips. Consumed
   * by id.
   */
  betFlights: BetFlight[];
  /**
   * How a bet's chips travel, the player's own preference. Applied to
   * future sprays only; a chip already in flight finishes the journey it
   * left on.
   */
  betStyle: BetAnimationStyle;
  /**
   * True once a context exists and the room is painting, false if one could
   * not be created or has been torn down. The caller needs this: the DOM
   * felt and rail stop painting themselves only when the room is genuinely
   * there to replace them (`.scene-lit` in `app/styles/99-scene.css`).
   */
  onReady?: (ready: boolean) => void;
}

/* The e2e seam's shape is `StackchipsSceneSeam`, imported above. See
 * `ChipLayer.debugChipPositions` for what backs `chips()` here. */

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
  betStyle,
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
   * Everything the render loop touches, in one ref. Not state: none of it
   * should ever cause a React render. This component renders exactly once
   * and then the loop owns the canvas.
   */
  const engineRef = useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    chips: ChipScene;
    /** The drawn chip radius this fit solved for, in world units. */
    chipRadius: number;
    scheduler: SchedulerState;
    view: SceneView;
    space: ChipSpace;
    size: { width: number; height: number };
    lastFrameMs: number;
    frames: number;
    reducedMotion: boolean;
    /** Mirrors `NEAR_SEAT_DESKTOP_MIN_WIDTH_PX`; see `onDesktopChange`. */
    nearSeatDesktop: boolean;
    seatCount: number;
    handledFlights: Set<string>;
    paidOutHand: number | null;
    lastPayoutSlots: number[];
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
      // No 2D context: vanishingly rare, but the failure mode must be the
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

    const desktopQuery = window.matchMedia(`(min-width: ${NEAR_SEAT_DESKTOP_MIN_WIDTH_PX}px)`);
    /* The table the chips are on, rebuilt whenever either of the two things
       that shape it moves: the felt's solved plan depth (a resize) and the
       near seat's own reach, which switches at the breakpoint where the local
       player's figure stops being drawn. Built in one place so a change to
       either can never be applied from only one of its two call sites. */
    const buildSpace = (): ChipSpace => classicChipSpace(
      engineRef.current?.view.radiusZ ?? FELT.radiusZ,
      desktopQuery.matches ? NEAR_SEAT_BET_INSET_DESKTOP : NEAR_SEAT_BET_INSET,
    );
    const chips = new ChipScene(markChanged);

    engineRef.current = {
      canvas,
      ctx,
      chips,
      scheduler: markDirty(SLEEPING, performance.now()),
      view: { cx: 0, cy: 0, scale: 1, radiusZ: FELT.radiusZ },
      space: classicChipSpace(),
      chipRadius: CHIP_RADIUS,
      size: { width: 0, height: 0 },
      lastFrameMs: performance.now(),
      frames: 0,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      nearSeatDesktop: desktopQuery.matches,
      seatCount: Math.max(1, seats.length),
      handledFlights: new Set(),
      paidOutHand: null,
      lastPayoutSlots: [],
      disposed: false,
    };

    /**
     * Fit the room to the DOM table's measured box.
     *
     * Closed-form, not a solver: under orthography the projected radii are
     * exactly `radius * scale`, so fitting the painted rail to a measured
     * box is two divisions (`fitView`). The DPI handling sizes the backing
     * store to CSS pixels x devicePixelRatio (capped, since a phone
     * reporting 3 or 4 would shade up to sixteen times the pixels for soft
     * gradients) and folds the ratio into one setTransform, so every draw
     * call works in CSS pixels.
     *
     * `.poker-rail` is the box, not `.poker-table-wrap`. The rail is the
     * table's outer edge and carries the per-breakpoint insets the artwork
     * was cut to, so measuring it is what makes the painted table land where
     * the drawn one did on every plate, including the tall portrait one,
     * where fitting the wrap's width alone painted a horizontal oval across
     * a vertical table. Its measured rect includes the CSS perspective tilt
     * it still carries, which is correct: the board and the pot anchor are
     * laid out inside that same transformed box, so matching what is on
     * screen keeps the cloth under the cards it is behind.
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
      const railBox = root.querySelector<HTMLElement>(".poker-rail")?.getBoundingClientRect();
      const rail = railBox && railBox.width > 1 && railBox.height > 1
        ? {
          left: railBox.left - hostBox.left,
          top: railBox.top - hostBox.top,
          width: railBox.width,
          height: railBox.height,
        }
        // Before React has laid the table out there is no rail to measure;
        // a centred approximation holds for the frame or two until the
        // ResizeObserver re-runs this with a real box.
        : { left: hostBox.width * 0.09, top: hostBox.height * 0.2, width: hostBox.width * 0.82, height: hostBox.height * 0.6 };
      engine.view = fitView(rail);
      // The chips ring the same table the room paints, so they need the plan
      // shape this fit solved for, or a resize moves the felt and leaves
      // every future bet spot on the old ellipse.
      applySpace();
      markChanged();
    };
    /* Applied through one helper by all three callers (mount, resize and
       the near-seat breakpoint), so the layer and the painter can never end
       up looking at two different tables. */
    const applySpace = () => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.space = buildSpace();
      engine.chips.setSpace(engine.space);
      // The chip's drawn size is solved from the fit rather than left to the
      // projection: below about 44 pixels per world unit the honest size puts
      // the side wall under a pixel, and a chip with no wall is a circle. The
      // layout needs the same answer the painter uses, or the mound is spaced
      // for one chip size and drawn at another.
      engine.chipRadius = solveChipWorldRadius(CHIP_RADIUS, engine.view.scale);
      engine.chips.setChipRadius(engine.chipRadius);
    };
    applySpace();
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

    // The near seat's own figure appears/disappears at this same breakpoint
    // (16-first-person.css), so a resize across it has to retarget any bet
    // not already in flight, the same way a felt resize retargets one.
    const onDesktopChange = () => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.nearSeatDesktop = desktopQuery.matches;
      applySpace();
      markChanged();
    };
    desktopQuery.addEventListener("change", onDesktopChange);

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
      // The room is the DOM's job now (see the header comment); this canvas
      // only ever holds chips, so a frame is just last frame's chips cleared
      // away before this frame's are drawn back in below.
      engine.ctx.clearRect(0, 0, engine.size.width, engine.size.height);
      // Painter's algorithm: draw far chips first, and within one column
      // the lower chips first, so a stack occludes itself correctly.
      const chips = engine.chips.drawList()
        .sort((a, b) => a.position.z - b.position.z || a.stackIndex - b.stackIndex);
      const projection = orthographicProjection(engine.view);
      // Two passes. A shadow belongs to the felt, so every one of them has to
      // be down before any chip is: interleaving them lays the near chips'
      // shadows across the far chips' faces, which is the grey smear a mound
      // painted chip-by-chip turns into.
      for (const chip of chips) paintChipShadow(engine.ctx, projection, engine.space, chip, engine.chipRadius);
      for (const chip of chips) paintChip(engine.ctx, projection, engine.space, chip, engine.chipRadius);
      engine.frames += 1;

      // A timed chip reports its terminal snap on this frame. Once the last
      // chip is removed there is no reason to pay even the scheduler linger:
      // park the state machine immediately instead of requesting a tail of
      // sub-pixel frames.
      engine.scheduler = engine.chips.isIdle()
        ? SLEEPING
        : afterFrame(engine.scheduler, now, moved);
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
     * one cannot, so without this `tests/e2e/chip-flights.spec.ts` (which
     * exists because the pot once landed fifty pixels short of every winner
     * and nothing failed) would quietly stop asserting anything at all.
     * Shipped in production rather than dev-gated: it exposes projected chip
     * coordinates and a frame counter, all of which are already on screen.
     */
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
            .map((position) => toViewport(project(engine.view, position)));
        },
        pileSize: () => engineRef.current?.chips.debugPileSize() ?? 0,
        seat: (slot: number) => {
          const engine = engineRef.current;
          if (!engine) return { x: 0, y: 0 };
          return toViewport(project(engine.view, ringPoint(slot, engine.seatCount, 1, FELT.y, engine.view.radiusZ)));
        },
        betSpot: (slot: number) => {
          const engine = engineRef.current;
          if (!engine) return { x: 0, y: 0 };
          const nearSeatInset = engine.nearSeatDesktop ? NEAR_SEAT_BET_INSET_DESKTOP : NEAR_SEAT_BET_INSET;
          return toViewport(
            project(engine.view, seatBetOrigin(slot, engine.seatCount, engine.view.radiusZ, nearSeatInset)),
          );
        },
        roomScale: () => engineRef.current?.view.scale ?? 0,
        roomFelt: () => {
          const engine = engineRef.current;
          if (!engine) return { width: 0, height: 0 };
          return {
            width: projectedFeltWidth(engine.view),
            height: projectedFeltDepth(engine.view),
          };
        },
        roomLift: () => engineRef.current?.view.cy ?? 0,
        lastFunnel: () => engineRef.current?.lastPayoutSlots ?? [],
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
      desktopQuery.removeEventListener("change", onDesktopChange);
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
   * The bet-animation preference. Runs on mount too (effects fire after
   * the mount effect above), so the layer starts on the player's stored
   * choice rather than the default.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    engineRef.current?.chips.setBetStyle(betStyle);
  }, [betStyle]);

  /* ------------------------------------------------------------------ *
   * The street turning over: sweep the standing bets in before anything
   * else about the new street renders. Keyed on the street *within* a
   * hand: a new hand starting on preflop is not a sweep, it is a clear
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
      // runs before the sync effect below on the same commit: a trailing
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
   * The pot, as a pile, minus what is still standing in front of the
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
    // No `clearBets()` on the paying branch: the chips standing in front of
    // the callers are part of the pot that was just won, and `payOut` sends
    // them to the winner from where they stand. Deleting them here would
    // make a caller's bet blink out of existence the moment the hand ended.
    if (!paying) engine.chips.syncBets(streetBets, engine.seatCount, bigBlind);
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
      engine.chips.spawnBet(flight.slot, engine.seatCount, flight.amount, bigBlind, flight.kind);
    }
    pumpRef.current?.();
  }, [betFlights, bigBlind]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!paying || winners.length === 0) return;
    if (engine.paidOutHand === handNumber) return;
    engine.paidOutHand = handNumber;
    engine.lastPayoutSlots = winners.map((winner) => winner.slot);
    /**
     * The bets are already the pot by the time it is won, so nothing may
     * still be on its way into the middle when it starts leaving. The slide
     * is asymptotic and takes roughly 1.2s to close a seat-to-pot gap, so a
     * hand that ends on a call has that caller's chips barely a third of
     * the way in when the payout fires; left alone they crawl into a centre
     * the pile has vacated while the payout flies the other way. Cleared
     * before `payOut`, not after: the payout's own chips are equally
     * transient, and clearing second would sweep up the very spray this is
     * about to launch.
     */
    engine.chips.clearFlights();
    engine.chips.payOut(winners, engine.seatCount, bigBlind);
    pumpRef.current?.();
  }, [paying, winners, handNumber, bigBlind]);

  return <div className="table-scene" ref={hostRef} aria-hidden="true" />;
}
