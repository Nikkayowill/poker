"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import type { Point } from "@/lib/stackacres-td/movement";
// Type-only, so neither Phaser nor the gauge scene lands in this file's
// bundle: both are loaded at runtime by the effect below.
import type * as PhaserNS from "phaser";
import type { FishingGaugeScene } from "../stackacres/fishing-gauge-scene";
import type { HuntScopeScene } from "./hunt-scope-scene";
import type { StackAcresSceneUnit } from "../stackacres/world-contract";
import type { StackAcresWorldProps } from "../stackacres/world-contract";
import { StackAcresJoystick } from "./joystick";
import { StackAcresUseKey } from "./use-key";
import type { TopdownScene } from "./scene";

/**
 * The StackAcres map: the farm shell (stackacres-farm.tsx) renders it and talks
 * to it through ../stackacres/world-contract.ts.
 *
 * The ground is worked with the belt: a tool is held, the farmer walks to a
 * square, and `onUseSquare` hands it to the shell on arrival. The Use key beside
 * the thumb stick does the same for the square under his feet, and held down it
 * strokes a whole row.
 *
 * What it does not draw yet, and so ignores from the contract: the scythe
 * (`tool`, `cutter`), the farmhand, irrigation pipes, wildlife and fences,
 * drones, and moving a bed group by hold-and-drag. Those api methods are
 * no-ops below, each named, so the gap is visible rather than silent. None of
 * them has a belt slot either: a key that silently does nothing is what the
 * belt exists to stop, so the scythe and the pipe stay off it until this file
 * draws them. Every area IS drawn now (scene.ts's own list).
 *
 * Pixel art at a whole-number zoom: the canvas is the host at full device
 * resolution, and the camera zooms by the largest whole number that still
 * shows 16 tiles across and 10 down. Rendering at device resolution rather
 * than one canvas pixel per art pixel is what lets the farmer and the camera
 * glide a device pixel at a time; at art resolution every step was a 4px jump
 * and the farmer shook against the ground (see scene.ts's `placeCamera`).
 */

export const MIN_TILES_ACROSS = 16;
export const MIN_TILES_DOWN = 10;

/** Device pixels per CSS pixel, capped so a 3x screen does not bake a canvas
 *  nobody can afford. Read in one place so every layer drawn on this canvas
 *  (the map, and the fishing gauge over it) scales by the same number. */
function canvasDpr(): number {
  return Math.max(1, Math.min(3, window.devicePixelRatio || 1));
}

/** Device pixels per art pixel: the largest whole number that still shows 16 tiles across and 10 down. */
export function pickZoom(hostWidth: number, hostHeight: number, dpr: number): number {
  const across = Math.floor((hostWidth * dpr) / (MIN_TILES_ACROSS * 16));
  const down = Math.floor((hostHeight * dpr) / (MIN_TILES_DOWN * 16));
  return Math.max(1, Math.min(across, down));
}

function toSceneUnits(units: StackAcresUnitSnapshot[]): StackAcresSceneUnit[] {
  return units.map((unit) => ({
    id: unit.id,
    stock: unit.stock,
    state: unit.state,
    progress: unit.progress,
    permanent: unit.permanent,
    soilSlot: unit.soilSlot,
    housedIn: unit.housedIn,
    seed: unit.seed,
  }));
}

export function StackAcresTopdownWorld(props: StackAcresWorldProps) {
  const { units, celebrate, sectors, cropFieldsUnlocked, soilTiles, woodNodes, stoneNodes, api } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<TopdownScene | null>(null);
  /** The live game, held so a layer can be added over the map after boot --
   *  currently just the fishing gauge (see `startFishingGauge`). */
  const gameRef = useRef<PhaserNS.Game | null>(null);
  /** The gauge scene while a fishing fight is up, else null. */
  const gaugeRef = useRef<FishingGaugeScene | null>(null);
  /** The scope scene while a stalk is up, else null. */
  const scopeRef = useRef<HuntScopeScene | null>(null);
  /** The world has the farmer (a cast), so the stick and the Use key stand
   *  down -- the scene refuses both anyway, and two lit controls that do
   *  nothing read as the game having frozen. React state rather than a ref
   *  because this one has to repaint.
   *
   *  A STALK does not set this: the scope is driven with the Use key (it is
   *  what takes the shot, see `startHuntScope`), so hiding the controls there
   *  would take away the button the player needs. */
  const [castLocked, setCastLocked] = useState(false);

  // The scene calls back into whatever the shell currently is, not whatever it was at boot.
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const sceneUnits = useMemo(() => toSceneUnits(units), [units]);
  const latest = useRef({ sceneUnits, sectors, cropFieldsUnlocked, soilTiles, woodNodes, stoneNodes });
  useEffect(() => {
    latest.current = { sceneUnits, sectors, cropFieldsUnlocked, soilTiles, woodNodes, stoneNodes };
  });

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let game: { destroy: (removeCanvas: boolean) => void } | null = null;
    const host = hostRef.current;
    if (!host) return;

    void (async () => {
      const [Phaser, { TopdownScene: SceneClass }] = await Promise.all([import("phaser"), import("./scene")]);
      if (cancelled) return;
      const p = () => propsRef.current;
      const scene = new SceneClass(
        {
          onReady: () => {
            // e2e specs drive the scene through this, and ChronoDevPanel steps `game`'s clocks.
            // Set on ready, so its presence means the map is up.
            if (process.env.NODE_ENV !== "production" && game) {
              (window as unknown as { __stackacres?: unknown }).__stackacres = { scene: sceneRef.current, game };
            }
            p().onReady();
          },
          onUseSquare: (square) => p().onUseSquare(square),
          onGroundTap: (zone, at, world) => p().onGroundTap(zone, at, world),
          onBarnTap: () => p().onBarnTap(),
          onSignpostTap: () => p().onSignpostTap(),
          onWorkshopTap: () => p().onWorkshopTap(),
          onWellTap: (at) => p().onWellTap(at),
          onDockTap: (at) => p().onDockTap(at),
          onThicketTap: (at) => p().onThicketTap(at),
          onTreeTap: (nodeId, at) => p().onTreeTap(nodeId, at),
          onStoneTap: (nodeId, at) => p().onStoneTap(nodeId, at),
          onGreenhouseTap: () => p().onGreenhouseTap(),
          onMonkTap: (at) => p().onMonkTap(at),
          onRayTap: (at) => p().onRayTap(at),
          onHouseTap: (at) => p().onHouseTap(at),
          onTravelerTap: (traveler, at) => p().onTravelerTap(traveler, at),
          onSecretZoneTap: (zoneId, at) => p().onSecretZoneTap(zoneId, at),
          onLockedSectorTap: (zone, at) => p().onLockedSectorTap(zone, at),
          onCropFieldsLockedTap: (at) => p().onCropFieldsLockedTap(at),
          onViewMoved: () => p().onViewMoved(),
          onPlaceEntered: (name) => p().onPlaceEntered(name),
          onInputLocked: setCastLocked,
        },
        host,
      );
      const size = () => {
        const dpr = canvasDpr();
        const zoom = pickZoom(host.clientWidth, host.clientHeight, dpr);
        return {
          width: Math.max(16, Math.floor(host.clientWidth * dpr)),
          height: Math.max(16, Math.floor(host.clientHeight * dpr)),
          zoom,
        };
      };
      const first = size();
      const instance = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        pixelArt: true,
        // The scene snaps to device pixels itself; Phaser's rounding floors in art pixels.
        roundPixels: false,
        backgroundColor: "#140c1c",
        // The scene reads pointer events off the host itself.
        input: { mouse: false, touch: false, keyboard: false },
        scale: { mode: Phaser.Scale.NONE, width: first.width, height: first.height },
        audio: { noAudio: true },
        scene,
      });
      game = instance;
      gameRef.current = instance;
      sceneRef.current = scene;
      scene.setZoom(first.zoom);
      const now = latest.current;
      scene.setUnits(now.sceneUnits);
      scene.setSectors(now.sectors);
      scene.setCropFieldsUnlocked(now.cropFieldsUnlocked);
      scene.setSoil(now.soilTiles);
      scene.setWoodNodes(now.woodNodes);
      scene.setStoneNodes(now.stoneNodes);

      const fit = () => {
        if (!instance.isBooted) return;
        const next = size();
        // Resized first, so the scene works out its zoom (a room's depends on the canvas) from the new size.
        if (instance.scale.width !== next.width || instance.scale.height !== next.height) instance.scale.resize(next.width, next.height);
        scene.setZoom(next.zoom);
      };
      instance.events.once("ready", fit);
      observer = new ResizeObserver(fit);
      observer.observe(host);
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      sceneRef.current = null;
      // Destroying the game tears the gauge down with it (its own shutdown
      // handler unbinds the host listeners), so there is nothing to close
      // here -- only the handle to drop, before the game it points into goes.
      gaugeRef.current = null;
      scopeRef.current = null;
      gameRef.current = null;
      game?.destroy(true);
      if (process.env.NODE_ENV !== "production") {
        delete (window as unknown as { __stackacres?: unknown }).__stackacres;
      }
    };
  }, []);

  useImperativeHandle(
    api,
    () => ({
      popUnit: (unitId) => sceneRef.current?.popUnit(unitId),
      celebrateCascade: (unitIds) => sceneRef.current?.celebrate(unitIds),
      celebrateCrit: (unitId) => sceneRef.current?.celebrate([unitId]),
      floatAt: (at, text, tone) => sceneRef.current?.floatAt(at, text, tone),
      setStoryCues: (cues) => sceneRef.current?.setStoryCues(cues),
      setTravelerUnlocks: (unlocked) => sceneRef.current?.setTravelerUnlocks(unlocked),
      soilTiles: () => sceneRef.current?.soilTiles() ?? [],
      setSoil: (tiles) => sceneRef.current?.setSoil(tiles),
      placeSoilAt: (x, y, tier) => sceneRef.current?.placeSoilAt(x, y, tier) ?? false,
      removeSoilAt: (x, y) => sceneRef.current?.removeSoilAt(x, y) ?? false,
      previewSoilAt: (world) => sceneRef.current?.previewSoilAt(world),
      tapAt: (clientX, clientY) => sceneRef.current?.tapAt(clientX, clientY),
      focusZone: (zone) => sceneRef.current?.focusZone(zone),
      currentPlace: () => sceneRef.current?.currentPlace() ?? "farmstead",
      fieldPointFor: (x, y) => sceneRef.current?.fieldPointFor(x, y) ?? null,
      // A drag pans and a pinch zooms (scene.ts's free-camera section); these are the same moves without a gesture.
      zoomBy: (factor) => sceneRef.current?.zoomBy(factor),
      recenter: () => sceneRef.current?.recenter(),
      farmerAction: (action) => sceneRef.current?.farmerAction(action),
      emote: (who, kind) => sceneRef.current?.emote(who, kind),
      // Not drawn yet (see this file's header).
      endFishingCast: (outcome) => sceneRef.current?.endFishingCast(outcome),
      startFishingGauge: (request) => {
        const game = gameRef.current;
        const host = hostRef.current;
        // No map booted (the player left, or Phaser is still loading): the
        // fight cannot happen, so hand the shell its close straight back
        // rather than leaving a cast it thinks is still running.
        if (!game || !host) {
          request.onClosed?.();
          return;
        }
        // Imported here, not at the top: the gauge scene imports Phaser, and
        // this file keeps Phaser out of the page bundle by loading it only
        // when the map boots (see the boot effect above).
        void (async () => {
          const { launchFishingGauge } = await import("../stackacres/fishing-gauge-scene");
          // Booted away while the chunk was in the air.
          if (gameRef.current !== game) {
            request.onClosed?.();
            return;
          }
          gaugeRef.current = launchFishingGauge(
            game,
            {
              species: request.species,
              title: request.title,
              landedHint: request.landedHint,
              host,
              dpr: canvasDpr(),
            },
            {
              onLanded: () => request.onLanded?.(),
              onEscaped: () => request.onEscaped?.(),
              onClosed: () => {
                gaugeRef.current = null;
                request.onClosed?.();
              },
            },
          );
        })();
      },
      startHuntScope: (request) => {
        const game = gameRef.current;
        const host = hostRef.current;
        // No map booted (the player left, or Phaser is still loading): the
        // stalk cannot happen, so hand the shell its close straight back
        // rather than leaving one it thinks is still running.
        if (!game || !host) {
          request.onClosed?.();
          return;
        }
        // Imported here, not at the top, for the same reason the gauge is:
        // the scope scene imports Phaser, and this file keeps Phaser out of
        // the page bundle by loading it only when the map boots.
        void (async () => {
          const { launchHuntScope } = await import("./hunt-scope-scene");
          // Booted away while the chunk was in the air.
          if (gameRef.current !== game) {
            request.onClosed?.();
            return;
          }
          scopeRef.current = launchHuntScope(
            game,
            {
              species: request.species,
              weapon: request.weapon,
              baggedHint: request.baggedHint,
              dpr: canvasDpr(),
              // The stalk plays on the open map now, so the scene reads the
              // farmer's live position and a screen projection straight off
              // TopdownScene every frame rather than owning either itself.
              getPlayerWorld: () => sceneRef.current?.farmerPoint() ?? { x: 0, y: 0 },
              worldToScreen: (point) => sceneRef.current?.screenPoint(point) ?? { x: 0, y: 0 },
            },
            {
              onBagged: () => request.onBagged?.(),
              onLost: () => request.onLost?.(),
              onClosed: () => {
                scopeRef.current = null;
                request.onClosed?.();
              },
            },
          );
        })();
      },
    }),
    [],
  );

  const onStick = useCallback((push: Point | null) => sceneRef.current?.setStick(push), []);
  const onUseHeld = useCallback((down: boolean) => {
    // While a stalk is up the Use key attempts a catch instead of working
    // the square underneath -- the farmer is still walking the open map
    // (the joystick keeps driving him), but a press means "take it" rather
    // than "water/harvest/plant here". Only the press acts; the release is
    // the stroke gesture's, which the stalk has no use for.
    const scope = scopeRef.current;
    if (scope) {
      if (down) scope.attemptCatch();
      return;
    }
    sceneRef.current?.setUseHeld(down);
  }, []);

  useLayoutEffect(() => {
    sceneRef.current?.setUnits(sceneUnits);
  }, [sceneUnits]);

  useLayoutEffect(() => {
    sceneRef.current?.setSectors(sectors);
  }, [sectors]);

  useLayoutEffect(() => {
    sceneRef.current?.setCropFieldsUnlocked(cropFieldsUnlocked);
  }, [cropFieldsUnlocked]);

  useLayoutEffect(() => {
    sceneRef.current?.setSoil(soilTiles);
  }, [soilTiles]);

  useLayoutEffect(() => {
    sceneRef.current?.setWoodNodes(woodNodes);
  }, [woodNodes]);

  useLayoutEffect(() => {
    sceneRef.current?.setStoneNodes(stoneNodes);
  }, [stoneNodes]);

  useLayoutEffect(() => {
    if (celebrate) sceneRef.current?.celebrate([celebrate.unitId]);
  }, [celebrate]);

  return (
    <>
      <div ref={hostRef} className="sa-world sa-world-topdown" aria-hidden="true" />
      <StackAcresJoystick onStick={onStick} hidden={castLocked} />
      <StackAcresUseKey onHeld={onUseHeld} label={props.useKeyLabel} hidden={castLocked} />
    </>
  );
}
