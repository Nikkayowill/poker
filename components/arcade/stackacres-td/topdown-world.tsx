"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { StackAcresWeather } from "@/lib/stackacres/weather";
import type { Point } from "@/lib/stackacres-td/movement";
import type { StackAcresSceneUnit } from "../stackacres/world-contract";
import type { StackAcresWorldProps } from "../stackacres/world-contract";
import { StackAcresJoystick } from "./joystick";
import type { TopdownScene } from "./scene";

/**
 * The StackAcres map: the farm shell (stackacres-farm.tsx) renders it and talks
 * to it through ../stackacres/world-contract.ts.
 *
 * What it does not draw yet, and so ignores from the contract: the scythe (`tool`, `cutter`), the farmhand, irrigation pipes,
 * wildlife and fences, drones and the delivery truck, the greenhouse interior,
 * moving a bed group by hold-and-drag, and every district other than the
 * Homestead and the Crop Fields. Those api methods are no-ops below, each
 * named, so the gap is visible rather than silent.
 *
 * Pixel art at a whole-number zoom: the canvas is the host at full device
 * resolution, and the camera zooms by the largest whole number that still
 * shows 13 tiles across and 8 down. Rendering at device resolution rather
 * than one canvas pixel per art pixel is what lets the farmer and the camera
 * glide a device pixel at a time; at art resolution every step was a 4px jump
 * and the farmer shook against the ground (see scene.ts's `placeCamera`).
 */

export const MIN_TILES_ACROSS = 13;
export const MIN_TILES_DOWN = 8;

/** Device pixels per art pixel: the largest whole number that still shows 13 tiles across and 8 down. */
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
  const { units, celebrate, sectors, cropFieldsUnlocked, soilTiles, api } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<TopdownScene | null>(null);

  // The scene calls back into whatever the shell currently is, not whatever it was at boot.
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const sceneUnits = useMemo(() => toSceneUnits(units), [units]);
  const latest = useRef({ sceneUnits, sectors, cropFieldsUnlocked, soilTiles });
  useEffect(() => {
    latest.current = { sceneUnits, sectors, cropFieldsUnlocked, soilTiles };
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
          onUnitTap: (unitId, at) => p().onUnitTap(unitId, at),
          onGroundTap: (zone, at, world) => p().onGroundTap(zone, at, world),
          onBarnTap: () => p().onBarnTap(),
          onSignpostTap: () => p().onSignpostTap(),
          onWorkshopTap: () => p().onWorkshopTap(),
          onWellTap: (at) => p().onWellTap(at),
          onDockTap: (at) => p().onDockTap(at),
          onGreenhouseTap: () => p().onGreenhouseTap(),
          onMerchantTap: () => p().onMerchantTap(),
          onMonkTap: (at) => p().onMonkTap(at),
          onRayTap: (at) => p().onRayTap(at),
          onTravelerTap: (traveler, at) => p().onTravelerTap(traveler, at),
          onSecretZoneTap: (zoneId, at) => p().onSecretZoneTap(zoneId, at),
          onLockedSectorTap: (zone, at) => p().onLockedSectorTap(zone, at),
          onCropFieldsLockedTap: (at) => p().onCropFieldsLockedTap(at),
          onViewMoved: () => p().onViewMoved(),
        },
        host,
      );
      const size = () => {
        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
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
      sceneRef.current = scene;
      scene.setZoom(first.zoom);
      const now = latest.current;
      scene.setUnits(now.sceneUnits);
      scene.setSectors(now.sectors);
      scene.setCropFieldsUnlocked(now.cropFieldsUnlocked);
      scene.setSoil(now.soilTiles);

      const fit = () => {
        if (!instance.isBooted) return;
        const next = size();
        scene.setZoom(next.zoom);
        if (instance.scale.width === next.width && instance.scale.height === next.height) return;
        instance.scale.resize(next.width, next.height);
      };
      instance.events.once("ready", fit);
      observer = new ResizeObserver(fit);
      observer.observe(host);
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      sceneRef.current = null;
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
      setMerchant: (present) => sceneRef.current?.setMerchant(present),
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
      // The camera follows the farmer, so there is nothing to zoom or recenter.
      zoomBy: () => undefined,
      recenter: () => undefined,
      // Not drawn in the top-down preview yet (see this file's header).
      farmerAction: (action) => sceneRef.current?.farmerAction(action),
      emote: (who, kind) => sceneRef.current?.emote(who, kind),
      registerFrenzyTap: () => undefined,
      playMonkPrayer: () => undefined,
      enterGreenhouse: () => undefined,
      exitGreenhouse: () => undefined,
      setWildlifeTimeOfDay: () => undefined,
      getAudibleWeather: () => StackAcresWeather.CLEAR,
      setFenceTier: () => undefined,
      setLivestockHealth: () => undefined,
      setDroneHangar: () => undefined,
      setTruckPresent: () => undefined,
      holdDroneForage: () => undefined,
      setBarnHeldOpen: () => undefined,
      setRayHouseHeldOpen: () => undefined,
      setTravelerRayHeldOpen: () => undefined,
      setGreenhouseHeldOpen: () => undefined,
    }),
    [],
  );

  const onStick = useCallback((push: Point | null) => sceneRef.current?.setStick(push), []);

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
    if (celebrate) sceneRef.current?.celebrate([celebrate.unitId]);
  }, [celebrate]);

  return (
    <>
      <div ref={hostRef} className="sa-world sa-world-topdown" aria-hidden="true" />
      <StackAcresJoystick onStick={onStick} />
    </>
  );
}
