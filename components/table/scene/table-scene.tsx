"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { PublicSeat } from "@/lib/game/types";
import { avatarFigure } from "@/lib/cosmetics/catalog";
import { isBotAway } from "@/lib/game/seat-presence";
import { rendererSize, solveRoomLift, solveRoomScale } from "@/lib/scene/fit";
import { MAX_PIXEL_RATIO } from "@/lib/scene/scene-config";
import {
  afterFrame,
  clampDelta,
  isAwake,
  markDirty,
  SLEEPING,
  type SchedulerState,
} from "@/lib/scene/render-scheduler";
import { AvatarLayer, type AvatarSeatView } from "./avatars";
import { ChipLayer } from "./chips";
import {
  buildCamera,
  buildRoom,
  measureDomRing,
  projectedFeltCentreY,
  projectedFeltWidth,
  projectedRingBox,
  projectSeatRing,
  projectSeatToViewport,
} from "./room";

/**
 * The WebGL room, mounted behind the DOM table.
 *
 * Everything with a shape lives in here; everything with words in it stays in
 * the DOM on top. That split is not a compromise, it is the point -- a
 * player's name, their stack, the pot and every button have to be selectable,
 * translatable, screen-reader-addressable and pixel-crisp at any zoom, and a
 * texture is none of those things. What WebGL is for is the part the DOM was
 * only ever faking: a real camera, a real light, and depth that comes from
 * geometry rather than from a stack of z-indexes.
 *
 * MOUNTING. The canvas fills `.table-area` and sits at the bottom of its
 * stacking order (`app/styles/22-scene.css`), so every existing DOM layer --
 * seats, cards, the feed, the action bar -- draws over it with no z-index
 * changes anywhere. It is `pointer-events: none` and `aria-hidden`, so it
 * cannot intercept a tap meant for a button or add a single node to the
 * accessibility tree.
 *
 * FAILING SOFT. If a WebGL context cannot be created -- an old device, a
 * blocked GPU, too many live contexts in one tab -- this mounts nothing and
 * the table is exactly the DOM table it was before. The pot's value is always
 * legible in `.pot-display` regardless of whether a single chip ever renders,
 * which is what makes that an acceptable degradation rather than a silent
 * loss of information.
 */

export interface TableSceneProps {
  /** Seats in ring order: index 0 is the near edge, the local player. */
  seats: PublicSeat[];
  pot: number;
  bigBlind: number;
  /** The hand is over and the pot is on its way to the winners. */
  paying: boolean;
  /**
   * The winning seats, as ring slots, each with the amount it actually won
   * -- the funnel flies each winner's own payout as chips, so a split pot
   * pays each share as the money it is.
   */
  winners: Array<{ slot: number; amount: number }>;
  /** Changes once per hand, so the funnel fires exactly once. */
  handNumber: number;
  /**
   * Bets to fly in, as detected by the parent, each carrying the amount the
   * seat actually committed -- the spray is that number as chips. Consumed
   * by id.
   */
  betFlights: Array<{ id: string; slot: number; amount: number }>;
  /**
   * Layer C, behind a flag while the DOM seats are still primary.
   * See `lib/scene/flags.ts`.
   */
  avatarsEnabled: boolean;
  /**
   * True once a context exists and the room has been built, false if one
   * could not be created or has been torn down.
   *
   * The caller needs this, not just for telemetry: the DOM felt and rail stop
   * painting themselves only when the room is genuinely there to replace
   * them (`.scene-lit` in `app/styles/22-scene.css`). Assuming success would
   * leave a device without WebGL looking at an unpainted table.
   */
  onReady?: (ready: boolean) => void;
  /**
   * Where the room has actually put each seat, as a percentage of
   * `.poker-table-wrap`, whenever Layer C is drawing the players.
   *
   * This is the room taking over as the layout authority, and it is the only
   * way the sandwich can be made to register. The DOM ring in
   * `lib/game/table-geometry.ts` is a hand-tuned ellipse -- a *drawing* of a
   * tilted camera, with the foreshortening baked into two constants. The room
   * has an actual camera, and a real perspective projection pulls the far
   * seats inward and spreads the near ones in a way no fixed ellipse can
   * express: measured at 1440x900, after fitting the two rings to the same
   * width and centre, the side seats still disagreed by 98px. That is not a
   * fit that needs tightening, it is two different shapes.
   *
   * So when the sprites are drawing the players, the nameplates, cards and
   * turn fuses follow the sprites. When they are not, nothing calls this and
   * the CSS ellipse remains in charge exactly as before.
   */
  onSeatProjection?: (seats: Array<{ x: number; y: number; depth: number }>) => void;
}

/**
 * How much of the canvas the projected seat ring is allowed to span when the
 * sprites are drawing the players.
 *
 * Short of 1 so the outermost seats keep their nameplates on screen: a seat
 * is a box roughly `--seat-width` across, and a ring fitted edge-to-edge puts
 * half of that box past the edge of the canvas.
 */
const RING_FRAME_FRACTION = 0.86;

/** The e2e seam. See `ChipLayer.debugChipPositions`. */
declare global {
  interface Window {
    __stackchipsScene?: {
      /** Chips in flight, projected into viewport CSS pixels. */
      chips: () => Array<{ x: number; y: number }>;
      pileSize: () => number;
      /** Where the scene thinks a ring slot is, in viewport CSS pixels. */
      seat: (slot: number) => { x: number; y: number };
      roomScale: () => number;
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
  paying,
  winners,
  handNumber,
  betFlights,
  avatarsEnabled,
  onReady,
  onSeatProjection,
}: TableSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Held in a ref so the mount effect can stay mount-only: a parent that
  // passes an inline callback would otherwise rebuild the WebGL context on
  // every one of its renders.
  const onReadyRef = useRef(onReady);
  // Kept fresh in an effect rather than assigned during render. `useRef`'s
  // initial value already covers the mount, and this effect is declared
  // before the mount effect below so it has always run by the time the scene
  // reports in.
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  // Same reasoning as onReadyRef: kept out of the mount effect's deps so a
  // parent passing an inline callback cannot rebuild the WebGL context.
  const onSeatProjectionRef = useRef(onSeatProjection);
  useEffect(() => { onSeatProjectionRef.current = onSeatProjection; }, [onSeatProjection]);
  /**
   * Restarts a loop that has already stopped.
   *
   * `markDirty` alone cannot: once the last frame has been requested there is
   * nobody left reading the flag, so every prop effect below has to be able
   * to kick the loop back into life as well as mark it dirty.
   */
  const pumpRef = useRef<(() => void) | null>(null);
  /**
   * Re-solve the room fit.
   *
   * Needed as its own handle because the fit is measured against the *DOM*
   * seat ring, and the room is built before React has drawn a single seat --
   * the mount-time solve therefore always takes the seatless fallback path.
   * Without a way to run it again the room kept that first approximation
   * forever: measured at 1440x900 the ring came out 184px narrow at the side
   * seats, which is a whole chair.
   */
  const fitRef = useRef<(() => void) | null>(null);
  /**
   * Everything the render loop touches, in one ref.
   *
   * Not state, deliberately: none of it should ever cause a React render.
   * This component renders exactly once and then the loop owns the canvas --
   * putting a camera or a scheduler tick into `useState` would re-render the
   * table tree at the frame rate, which is the same mistake the 250ms
   * `clockNow` interval made before `use-fuse.ts` replaced it.
   */
  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    room: ReturnType<typeof buildRoom>;
    avatars: AvatarLayer;
    chips: ChipLayer;
    scheduler: SchedulerState;
    roomScale: number;
    roomLift: number;
    viewport: { width: number; height: number };
    lastFrameMs: number;
    frames: number;
    reducedMotion: boolean;
    seatCount: number;
    avatarsEnabled: boolean;
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

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        // Transparent clear colour, so the table area's own CSS background
        // still shows through wherever the room does not cover it.
        alpha: true,
        // Left off deliberately, despite this being an on-demand loop. What
        // survives between frames is the *composited* image, which is what
        // the user sees; `preserveDrawingBuffer` only governs whether the
        // backing buffer is still readable by `readPixels`/`toDataURL`
        // afterwards. Turning it on to "keep the picture" would cost a
        // full-size buffer copy per frame and keep nothing extra on screen.
        preserveDrawingBuffer: false,
        // This scene is soft gradients and a dozen small meshes. Asking for
        // the discrete GPU on a laptop would spin a fan for no more frames.
        powerPreference: "low-power",
      });
    } catch {
      // No context -- an old device, a blocked GPU, or too many live contexts
      // in one tab. Leave the DOM table exactly as it was: `.scene-lit` is
      // never applied, so the painted felt and rail keep doing their job.
      onReadyRef.current?.(false);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES rather than linear: the spotlight runs at intensity 5 over a dark
    // room, which clips to white on the felt under a linear mapping. This is
    // what keeps the bright pool reading as bright cloth rather than a hole.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const box = host.getBoundingClientRect();
    const size = rendererSize(box, window.devicePixelRatio, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(size.pixelRatio);
    renderer.setSize(size.width, size.height, false);

    const seatCount = Math.max(1, seats.length);
    const camera = buildCamera(size.aspect);
    const room = buildRoom(seatCount);

    const markChanged = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;
      engine.scheduler = markDirty(engine.scheduler, performance.now());
    };

    const avatars = new AvatarLayer(room.group, seatCount, markChanged);
    const chips = new ChipLayer(room.group, markChanged);

    engineRef.current = {
      renderer,
      camera,
      room,
      avatars,
      chips,
      scheduler: markDirty(SLEEPING, performance.now()),
      roomScale: 1,
      roomLift: 0,
      viewport: { width: size.width, height: size.height },
      lastFrameMs: performance.now(),
      frames: 0,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      seatCount,
      avatarsEnabled,
      handledFlights: new Set(),
      funnelledHand: null,
      lastFunnelSlots: [],
      disposed: false,
    };

    /**
     * Fit the room to the DOM table's measured box.
     *
     * The camera is fixed by the composition, so the room is scaled to it
     * instead -- the same transformation as dollying, without touching the
     * projection everything else depends on. See `lib/scene/fit.ts`.
     */
    const fit = () => {
      const engine = engineRef.current;
      if (!engine || engine.disposed) return;
      const hostBox = host.getBoundingClientRect();
      if (hostBox.width < 1 || hostBox.height < 1) return;
      const next = rendererSize(hostBox, window.devicePixelRatio, MAX_PIXEL_RATIO);
      engine.renderer.setPixelRatio(next.pixelRatio);
      engine.renderer.setSize(next.width, next.height, false);
      engine.camera.aspect = next.aspect;
      engine.camera.updateProjectionMatrix();
      engine.viewport = { width: next.width, height: next.height };

      /**
       * Fit the *table* to the table's plate, and let the seats follow.
       *
       * This fits the felt, not the seat ring, and the distinction is worth
       * stating because it was tried the other way first. Fitting the ring to
       * the DOM's ellipse does make the two agree -- it took the worst seat
       * from 184px out to 5 -- but it agrees by shrinking the room: the DOM
       * ring sits only ~1.10 felt-radii out while a perspective projection of
       * a ring at 1.19 spreads the near seats much further, so the solve
       * drove the scale down to 0.64 and left a small green pool inside an
       * enormous dark table.
       *
       * The room is the authority now, so it does not need to. When Layer C
       * is on, the seat positions this publishes below move the DOM plates
       * onto the sprites; when it is off, the CSS ellipse is unchanged and
       * the felt simply has to sit inside it, which is what fitting to the
       * plate achieves.
       *
       * Two solves, because a fixed camera leaves exactly two degrees of
       * freedom: scale sets how wide the table is, lift sets where it sits.
       * The lift is needed because the camera deliberately aims past the
       * middle of the table (`CAMERA.target.z`), so an unlifted room sits low
       * in its own frame.
       */
      const root = host.parentElement ?? host;
      const canvasBox = engine.renderer.domElement.getBoundingClientRect();
      const viewport = { width: canvasBox.width, height: canvasBox.height };
      const wrapEl = root.querySelector<HTMLElement>(".poker-table-wrap");
      const wrapBox = wrapEl?.getBoundingClientRect();

      const targetWidth = wrapBox && wrapBox.width > 1 ? wrapBox.width : hostBox.width * 0.82;
      const feltScale = solveRoomScale(
        (scale) => projectedFeltWidth(engine.camera, viewport.width, scale),
        targetWidth,
      );

      /**
       * With the sprites drawing, the *ring* has to fit the frame as well as
       * the felt, and it is a much wider thing than the felt is.
       *
       * Under a real perspective camera the near seat sits closest to the
       * lens and spreads furthest -- the projected ring is over three times
       * the felt's width, not the 1.19 its world radius suggests. Sizing on
       * the felt alone therefore pushed the near player off the bottom of the
       * frame and the side seats off both edges, which is what the first
       * avatars-on render showed.
       *
       * So the scale becomes whichever constraint binds. With Layer C off
       * there is no ring to fit and this is exactly the felt solve, unchanged.
       */
      engine.roomScale = feltScale;
      if (engine.avatarsEnabled) {
        const ringScale = solveRoomScale(
          (scale) => projectedRingBox(
            engine.camera, engine.seatCount, scale, engine.roomLift, viewport,
          ).width,
          viewport.width * RING_FRAME_FRACTION,
        );
        engine.roomScale = Math.min(feltScale, ringScale);
      }
      if (wrapBox && wrapBox.height > 1) {
        // Solved after the scale, since scaling moves the table vertically
        // too. One pass each: the lift does not measurably change the
        // projected width at these magnitudes, so the two are independent
        // rather than needing to be iterated to a fixed point.
        engine.roomLift = solveRoomLift(
          (lift) => projectedFeltCentreY(engine.camera, engine.roomScale, lift, viewport) + canvasBox.top,
          wrapBox.top + wrapBox.height / 2,
        );
      }

      const domRing = measureDomRing(root);
      if (domRing) engine.seatCount = Math.max(1, domRing.count);

      engine.room.group.scale.setScalar(engine.roomScale);
      engine.room.group.position.y = engine.roomLift;

      // Hand the seat ring back only when the sprites are drawing the
      // players. Otherwise the CSS ellipse stays in charge and nothing here
      // should be moving a nameplate.
      if (engine.avatarsEnabled && wrapBox && onSeatProjectionRef.current) {
        if (wrapBox.width > 1 && wrapBox.height > 1) {
          onSeatProjectionRef.current(projectSeatRing(
            engine.camera,
            engine.seatCount,
            engine.roomScale,
            engine.roomLift,
            canvasBox,
            wrapBox,
          ));
        }
      }
      markChanged();
    };
    fit();

    const observer = new ResizeObserver(fit);
    observer.observe(host);
    window.addEventListener("orientationchange", fit);

    /**
     * A lost context is recoverable and a common event on mobile when a tab
     * is backgrounded under memory pressure. Without the preventDefault the
     * browser will not fire `webglcontextrestored` and the canvas stays black
     * forever.
     */
    const onContextLost = (event: Event) => {
      event.preventDefault();
      const engine = engineRef.current;
      if (engine) engine.scheduler = SLEEPING;
    };
    const onContextRestored = () => {
      fit();
      markChanged();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

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
      // A backgrounded tab hands back a delta of minutes on its first frame.
      // Uncapped, that single delta closes every chip's remaining distance at
      // once and the pot teleports.
      const delta = clampDelta(now - engine.lastFrameMs);
      engine.lastFrameMs = now;

      const chipsMoved = engine.chips.update(delta, engine.reducedMotion);
      const avatarsMoved = engine.avatars.update(delta);
      engine.renderer.render(engine.room.scene, engine.camera);
      engine.frames += 1;

      engine.scheduler = afterFrame(engine.scheduler, now, chipsMoved || avatarsMoved);
      // Re-arm only while awake. This is the whole battery saving: an idle
      // table stops requesting frames entirely rather than re-rendering an
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
    fitRef.current = fit;
    pump();
    onReadyRef.current?.(true);

    /**
     * The test seam.
     *
     * A DOM chip could be measured with `getBoundingClientRect`; a mesh
     * cannot, so without this `tests/e2e/chip-flights.spec.ts` -- which
     * exists because the pot once landed fifty pixels short of every winner
     * and nothing failed -- would quietly stop asserting anything at all.
     *
     * Shipped in production rather than dev-gated on purpose: it exposes
     * projected chip coordinates and a frame counter, all of which are
     * already on screen, and a seam that only exists in development is a seam
     * that is never exercised against the build players actually run.
     */
    {
      window.__stackchipsScene = {
        chips: () => {
          const engine = engineRef.current;
          if (!engine) return [];
          const point = new THREE.Vector3();
          return engine.chips.debugChipPositions().map((position) => {
            point.set(position.x, position.y, position.z)
              .multiplyScalar(engine.roomScale);
            point.y += engine.roomLift;
            point.project(engine.camera);
            const rect = engine.renderer.domElement.getBoundingClientRect();
            return {
              x: rect.left + ((point.x + 1) / 2) * rect.width,
              y: rect.top + ((1 - point.y) / 2) * rect.height,
            };
          });
        },
        pileSize: () => engineRef.current?.chips.debugPileSize() ?? 0,
        seat: (slot: number) => {
          const engine = engineRef.current;
          if (!engine) return { x: 0, y: 0 };
          const rect = engine.renderer.domElement.getBoundingClientRect();
          const projected = projectSeatToViewport(
            engine.camera,
            slot,
            engine.seatCount,
            engine.roomScale,
            engine.roomLift,
            { width: rect.width, height: rect.height },
          );
          return { x: rect.left + projected.x, y: rect.top + projected.y };
        },
        roomScale: () => engineRef.current?.roomScale ?? 0,
        roomLift: () => engineRef.current?.roomLift ?? 0,
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
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      if (frameHandle) cancelAnimationFrame(frameHandle);
      delete window.__stackchipsScene;
      if (engine) {
        engine.disposed = true;
        engine.avatars.dispose();
        engine.chips.dispose();
        engine.room.dispose();
        // Frees the GPU context rather than waiting for it to be collected.
        // A tab is limited to a handful of live contexts, and a table that
        // was opened and left five times would exhaust them.
        engine.renderer.dispose();
        engine.renderer.forceContextLoss();
        engine.renderer.domElement.remove();
      }
      engineRef.current = null;
      pumpRef.current = null;
    };
    // Mount-only. Every prop below is applied through its own effect against
    // the live engine rather than by tearing down and rebuilding a WebGL
    // context, which is the single most expensive thing this component could
    // possibly do on a prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ *
   * Layer C -- the players.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const views: AvatarSeatView[] = avatarsEnabled
      ? seats.map((seat, slot) => ({
        id: seat.id,
        slot,
        artworkUrl: seat.avatarCosmetic ? avatarFigure(seat.avatarCosmetic) : null,
        photoUrl: seat.avatarUrl ?? null,
        initials: seat.initials,
        accent: seat.accent,
        // Folded, sat out and away all read the same way here: still in the
        // chair, out of the light. That is what a dimmed sprite says, and it
        // is the same thing `.seat-muted`/`.seat-away` say in the DOM.
        dimmed: seat.status === "folded" || seat.status === "out" || isBotAway(seat),
        active: seat.isCurrent,
        occupied: true,
      }))
      : [];
    // Re-solve before syncing: the seat ring the fit is measured against is
    // drawn by React, so this effect is the first moment there is a real one
    // to measure. It is also the only thing that runs when the *number* of
    // seats changes, which changes the ring's shape.
    engine.avatarsEnabled = avatarsEnabled;
    fitRef.current?.();
    engine.avatars.sync(views, Math.max(1, seats.length));
    pumpRef.current?.();
  }, [seats, avatarsEnabled]);

  /* ------------------------------------------------------------------ *
   * The pot, as a pile.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.chips.syncPile(pot, bigBlind, paying);
    pumpRef.current?.();
  }, [pot, bigBlind, paying]);

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
     * still be on its way into the middle when it starts leaving.
     *
     * The slide is asymptotic and takes roughly 1.2s to close a seat-to-pot
     * gap, so a hand that ends on a call -- which is most of them -- has that
     * caller's chips barely a third of the way in when the payout fires. Left
     * alone they finish crawling into a centre the pile has already vacated
     * (`syncPile` empties it on `paying`, so the same chips are not shown
     * twice), while twelve more fly out of it in the other direction. On
     * screen that reads as chips going both ways at once.
     *
     * Before `spawnFunnel`, not after: the payout's own chips are equally
     * `keepOnArrival: false`, so clearing second would sweep up the very
     * spray this is about to launch.
     */
    engine.chips.clearFlights();
    engine.chips.spawnFunnel(winners, engine.seatCount, bigBlind);
    pumpRef.current?.();
  }, [paying, winners, handNumber, bigBlind]);

  /* ------------------------------------------------------------------ *
   * A new hand: nothing from the last one should still be in the air.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.handledFlights.clear();
    engine.chips.clearFlights();
    pumpRef.current?.();
  }, [handNumber]);

  return <div className="table-scene" ref={hostRef} aria-hidden="true" />;
}
