"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  BARN_FLIPPED,
  BARN_FOOTPRINT,
  FACTORY_FOOTPRINT,
  MIDNIGHT_MERCHANT_SPOT,
  RAY_HOUSE_FLIPPED,
  RAY_HOUSE_FOOTPRINT,
  RAY_HOUSE_VISUAL_NUDGE,
  type WorldPoint,
} from "@/lib/stackacres/world";
import { YARD_DELTA } from "@/lib/stackacres/yard";
import { MONK_POST } from "@/lib/stackacres/monk";
import { travelerSpot } from "@/lib/stackacres/story/placement";
import { YARD_PROPS, type PropPlacement } from "@/lib/stackacres/props";

/** The one dev-only door onto the live scene, opened by
 *  components/arcade/stackacres/stackacres-world.tsx and read here the same
 *  way `screenPointFor` already is elsewhere. Narrow function types, not the
 *  scene itself -- see that file's own comment on why. */
interface StackAcresDevHandle {
  screenPointFor: (worldX: number, worldY: number) => WorldPoint;
  worldPointFor: (clientX: number, clientY: number) => WorldPoint;
  setBarnDevPosition: (worldX: number, worldY: number) => void;
  setBarnDevFlipped: (flipped: boolean) => void;
  setRayHouseDevPosition: (worldX: number, worldY: number) => void;
  setRayHouseDevFlipped: (flipped: boolean) => void;
  setFactoryDevPosition: (worldX: number, worldY: number) => void;
  setFactoryDevScale: (scale: number) => void;
  setBarbFenceDevPieces: (pieces: readonly PropPlacement[]) => void;
  clearBarbFenceDevPieces: () => void;
  hasMerchantDevTarget: () => boolean;
  setMerchantDevPosition: (worldX: number, worldY: number) => void;
  setMonkDevPosition: (worldX: number, worldY: number) => void;
  hasTravelerDevTarget: (id: string) => boolean;
  setTravelerDevPosition: (id: string, worldX: number, worldY: number) => void;
  showDevPlacementGrid: (worldX: number, worldY: number) => void;
  hideDevPlacementGrid: () => void;
}

function devHandle(): StackAcresDevHandle | null {
  return (window as unknown as { __stackacres?: StackAcresDevHandle }).__stackacres ?? null;
}

/** Every kind the barbed-wire fence placer can drop -- the pack's four
 *  shipped plates plus the corner (art-props.ts's own header on why it's
 *  runtime-flipped rather than four baked rotations). A real subset of
 *  `PropKind`, not the whole union, so a piece's own kind can index a label
 *  table without every other prop kind demanding an entry too. */
type BarbKind = "barbEndWest" | "barbEndEast" | "barbStraight1" | "barbStraight2" | "barbCorner";

/** One barbed-wire fence piece as the placer's own state tracks it: a kind,
 *  a world point (its feet, dragged independently -- no shared layout with
 *  any other piece), and its own flip toggles. `id` is a stable React key,
 *  not anything the scene or props.ts care about. */
interface PlacedBarbPiece {
  id: number;
  kind: BarbKind;
  point: WorldPoint;
  flipX: boolean;
  flipY: boolean;
}

/** A structure's feet anchor, the point `yardPoint`/the painter's
 *  bottom-centre origin both agree on: footprint centre-x, footprint
 *  bottom-y. Matches the relationship `BARN_AT`/`BARN_FOOTPRINT` and
 *  `paintRayHouse`'s own `cx`/`feetY` locals already encode in source. */
function footprintFeet(footprint: { x: number; y: number; width: number; height: number }): WorldPoint {
  return { x: footprint.x + footprint.width / 2, y: footprint.y + footprint.height };
}

/** Every kind the barbed-wire fence placer can drop -- the pack's four
 *  shipped plates plus the corner (art-props.ts's own header on why it's
 *  runtime-flipped rather than four baked rotations). */
const BARB_KINDS: readonly BarbKind[] = ["barbEndWest", "barbEndEast", "barbStraight1", "barbStraight2", "barbCorner"];

/** The shipped run's own four pieces, read back off `YARD_PROPS` rather
 *  than retyped as four literals -- the placer's own starting point, one
 *  independently draggable marker per piece from here on. */
function shippedBarbPieces(): PlacedBarbPiece[] {
  return YARD_PROPS.filter((prop): prop is PropPlacement & { kind: BarbKind } =>
    (BARB_KINDS as readonly string[]).includes(prop.kind),
  ).map((prop, index) => ({
    id: index,
    kind: prop.kind,
    point: { x: prop.x + YARD_DELTA.x, y: prop.y + YARD_DELTA.y },
    flipX: Boolean(prop.flipX),
    flipY: Boolean(prop.flipY),
  }));
}

const SHIPPED = {
  barnFeet: footprintFeet(BARN_FOOTPRINT),
  houseFeet: footprintFeet(RAY_HOUSE_FOOTPRINT),
  nudge: RAY_HOUSE_VISUAL_NUDGE,
  barnFlipped: BARN_FLIPPED,
  houseFlipped: RAY_HOUSE_FLIPPED,
  merchantPoint: MIDNIGHT_MERCHANT_SPOT,
  monkPoint: MONK_POST,
  rayPoint: (() => {
    const spot = travelerSpot("ray");
    return { x: spot.x, y: spot.y };
  })(),
  factoryFeet: footprintFeet(FACTORY_FOOTPRINT),
};

type StructureKey = "barn" | "house";

/** Round to a whole yard unit -- every shipped literal this panel outputs
 *  (BARN_AT, the footprints) is already an integer, so a dragged position
 *  should read the same way rather than pasting in a stray fraction of a
 *  pixel. */
function snap(n: number): number {
  return Math.round(n);
}

function toYardLocal(worldPoint: WorldPoint): WorldPoint {
  return { x: worldPoint.x - YARD_DELTA.x, y: worldPoint.y - YARD_DELTA.y };
}

/**
 * Yard Plotter's in-game twin: drag the barn and Ray's house on the real,
 * running farm and copy the exact source constants back out.
 *
 * STRIPPED FROM PRODUCTION, TWICE OVER, the same posture Chrono-DeLorean Mode
 * takes (see that panel's own header) -- this component checks
 * `NODE_ENV`/`NEXT_PUBLIC_STACKACRES_PLACEMENT_ENABLED` itself and renders
 * `null` before doing anything else, and the mount site in
 * app/(lobby)/games/stackacres/page.tsx gates on the same two variables
 * server-side, so a production RSC payload never contains this component's
 * output or an import of its module.
 *
 * Dragging moves the live `Phaser.GameObjects.Image` for each structure
 * (`setBarnDevPosition`/`setRayHouseDevPosition` on the scene) -- purely
 * visual. `BARN_FOOTPRINT`/`RAY_HOUSE_FOOTPRINT` (the actual hit-test boxes
 * pathing and wild-growth exclusion key off) do not move until the numbers
 * this panel prints are pasted into lib/stackacres/world.ts and
 * stackacres-scene.ts by hand.
 */
export function StackAcresPlacementPanel() {
  const enabled =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_STACKACRES_PLACEMENT_ENABLED === "1";

  const [minimized, setMinimized] = useState(true);
  const [ready, setReady] = useState(false);
  const [barnFeet, setBarnFeet] = useState<WorldPoint>(SHIPPED.barnFeet);
  const [houseFeet, setHouseFeet] = useState<WorldPoint>(SHIPPED.houseFeet);
  const [nudge, setNudge] = useState(SHIPPED.nudge);
  const [barnFlipped, setBarnFlipped] = useState(SHIPPED.barnFlipped);
  const [houseFlipped, setHouseFlipped] = useState(SHIPPED.houseFlipped);
  const [factoryScale, setFactoryScale] = useState(1);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const barnRef = useRef<HTMLDivElement | null>(null);
  const houseRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ key: StructureKey; pointerId: number; grabOffset: WorldPoint } | null>(null);

  // Waits for stackacres-world.tsx to have mounted the scene and opened its
  // dev door -- this panel can render before that effect runs.
  useEffect(() => {
    if (!enabled || minimized) return;
    const timer = window.setInterval(() => setReady(devHandle() !== null), 200);
    return () => {
      window.clearInterval(timer);
      // Minimizing mid-drag (or unmounting) shouldn't leave the reference
      // grid lit up on a farm nobody's looking at through this panel anymore.
      devHandle()?.hideDevPlacementGrid();
    };
  }, [enabled, minimized]);

  // A stray pointer release the marker under it never saw (the pointer
  // left the marker, or its own capture was lost some other way) used to
  // leave `showDevPlacementGrid`'s translucent reference tiles lit up
  // wherever that drag last drew them -- reading as a patch of "blurry"
  // blue ground until the panel was minimized. `hideDevPlacementGrid` is a
  // plain clear(), safe to call on every pointer release anywhere on the
  // page, so this is a blanket safety net rather than hardening each
  // placer's own `endDrag` one at a time.
  useEffect(() => {
    if (!enabled) return;
    const clear = () => devHandle()?.hideDevPlacementGrid();
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, [enabled]);

  // Keeps the two markers glued to their world points while the camera pans
  // or zooms, not just while a drag is in flight. A 10fps tick is plenty for
  // tracking a camera move and far cheaper than a render-loop rAF.
  useEffect(() => {
    if (!enabled || minimized || !ready) return;
    const tick = () => {
      const handle = devHandle();
      if (!handle) return;
      const barnScreen = handle.screenPointFor(barnFeet.x, barnFeet.y);
      const houseScreen = handle.screenPointFor(houseFeet.x, houseFeet.y + nudge);
      if (barnRef.current) {
        barnRef.current.style.left = `${barnScreen.x}px`;
        barnRef.current.style.top = `${barnScreen.y}px`;
      }
      if (houseRef.current) {
        houseRef.current.style.left = `${houseScreen.x}px`;
        houseRef.current.style.top = `${houseScreen.y}px`;
      }
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [enabled, minimized, ready, barnFeet, houseFeet, nudge]);

  const applyBarn = useCallback((feet: WorldPoint) => {
    setBarnFeet(feet);
    devHandle()?.setBarnDevPosition(feet.x, feet.y);
  }, []);

  const hasMerchantTarget = useCallback(() => devHandle()?.hasMerchantDevTarget() ?? false, []);
  const applyMerchant = useCallback((point: WorldPoint) => {
    devHandle()?.setMerchantDevPosition(point.x, point.y);
  }, []);

  const hasMonkTarget = useCallback(() => devHandle() !== null, []);
  const applyMonk = useCallback((point: WorldPoint) => {
    devHandle()?.setMonkDevPosition(point.x, point.y);
  }, []);

  const hasRayTarget = useCallback(() => devHandle()?.hasTravelerDevTarget("ray") ?? false, []);
  const applyRay = useCallback((point: WorldPoint) => {
    devHandle()?.setTravelerDevPosition("ray", point.x, point.y);
  }, []);

  const hasFactoryTarget = useCallback(() => devHandle() !== null, []);
  const applyFactory = useCallback((point: WorldPoint) => {
    devHandle()?.setFactoryDevPosition(point.x, point.y);
  }, []);

  // Factory resize: separate from `applyFactory`'s own position push since
  // this is a plain slider, not a drag -- pushed once on mount (once ready)
  // and again on every slider move.
  useEffect(() => {
    if (!ready) return;
    devHandle()?.setFactoryDevScale(factoryScale);
  }, [ready, factoryScale]);

  const applyHouse = useCallback(
    (feet: WorldPoint, nudgeValue: number) => {
      setHouseFeet(feet);
      devHandle()?.setRayHouseDevPosition(feet.x, feet.y + nudgeValue);
    },
    [],
  );

  const startDrag = useCallback(
    (key: StructureKey) => (event: ReactPointerEvent<HTMLDivElement>) => {
      const handle = devHandle();
      if (!handle) return;
      event.stopPropagation();
      const pointerWorld = handle.worldPointFor(event.clientX, event.clientY);
      const current = key === "barn" ? barnFeet : houseFeet;
      dragRef.current = {
        key,
        pointerId: event.pointerId,
        grabOffset: { x: pointerWorld.x - current.x, y: pointerWorld.y - current.y },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      // The same tile-grid reference `drawSoilLiftGrid` lights up while a
      // soil bed is lifted -- purely visual here, since a yard building can
      // sit anywhere, but it's the whole reason this panel drags like the
      // rest of the farm instead of floating a dot over a blank field.
      handle.showDevPlacementGrid(current.x, current.y);
    },
    [barnFeet, houseFeet],
  );

  const onDragMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const handle = devHandle();
      if (!drag || !handle || drag.pointerId !== event.pointerId) return;
      const pointerWorld = handle.worldPointFor(event.clientX, event.clientY);
      const feet = {
        x: snap(pointerWorld.x - drag.grabOffset.x),
        y: snap(pointerWorld.y - drag.grabOffset.y),
      };
      if (drag.key === "barn") applyBarn(feet);
      else applyHouse(feet, nudge);
    },
    [applyBarn, applyHouse, nudge],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    devHandle()?.hideDevPlacementGrid();
  }, []);

  const toggleBarnFlip = useCallback(() => {
    setBarnFlipped((value) => {
      const next = !value;
      devHandle()?.setBarnDevFlipped(next);
      return next;
    });
  }, []);

  const toggleHouseFlip = useCallback(() => {
    setHouseFlipped((value) => {
      const next = !value;
      devHandle()?.setRayHouseDevFlipped(next);
      return next;
    });
  }, []);

  const setNudgeValue = useCallback(
    (value: number) => {
      setNudge(value);
      devHandle()?.setRayHouseDevPosition(houseFeet.x, houseFeet.y + value);
    },
    [houseFeet],
  );

  const reset = useCallback(() => {
    applyBarn(SHIPPED.barnFeet);
    setBarnFlipped(SHIPPED.barnFlipped);
    devHandle()?.setBarnDevFlipped(SHIPPED.barnFlipped);
    setHouseFlipped(SHIPPED.houseFlipped);
    devHandle()?.setRayHouseDevFlipped(SHIPPED.houseFlipped);
    setNudge(SHIPPED.nudge);
    applyHouse(SHIPPED.houseFeet, SHIPPED.nudge);
  }, [applyBarn, applyHouse]);

  const barnLocal = toYardLocal(barnFeet);
  const houseLocal = toYardLocal(houseFeet);
  const barnFootprintCode =
    `const BARN_AT = yardPoint(${barnLocal.x}, ${barnLocal.y});\n` +
    `const BARN_X = BARN_AT.x;\n` +
    `const BARN_Y = BARN_AT.y;\n\n` +
    `export const BARN_FOOTPRINT: WorldRect =\n` +
    `  yardRect(${barnLocal.x - BARN_FOOTPRINT.width / 2}, ${barnLocal.y - BARN_FOOTPRINT.height}, ` +
    `${BARN_FOOTPRINT.width}, ${BARN_FOOTPRINT.height});\n\n` +
    `const BARN_FLIPPED = ${barnFlipped};`;
  const houseFootprintCode =
    `export const RAY_HOUSE_FOOTPRINT: WorldRect =\n` +
    `  yardRect(${houseLocal.x - RAY_HOUSE_FOOTPRINT.width / 2}, ${houseLocal.y - RAY_HOUSE_FOOTPRINT.height}, ` +
    `${RAY_HOUSE_FOOTPRINT.width}, ${RAY_HOUSE_FOOTPRINT.height});\n\n` +
    `const RAY_HOUSE_VISUAL_NUDGE = ${nudge};\n` +
    `const RAY_HOUSE_FLIPPED = ${houseFlipped};`;

  const copy = useCallback((key: string, text: string) => {
    const done = () => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {});
    }
  }, []);

  if (!enabled) return null;

  return (
    <>
      <div style={panelStyle(minimized)}>
        <button type="button" onClick={() => setMinimized((value) => !value)} style={headerStyle}>
          {"⌂"} Yard Placement {minimized ? "▸" : "▾"}
        </button>

        {!minimized && (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {!ready && <div style={{ opacity: 0.7 }}>Waiting for the scene to mount…</div>}

            <label style={rowStyle}>
              <input type="checkbox" checked={barnFlipped} onChange={toggleBarnFlip} />
              Barn flipped
            </label>

            <label style={rowStyle}>
              <input type="checkbox" checked={houseFlipped} onChange={toggleHouseFlip} />
              House flipped
            </label>

            <label style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
              <span>House sprite nudge ({nudge})</span>
              <input
                type="range"
                min={-80}
                max={40}
                value={nudge}
                onChange={(event) => setNudgeValue(Number(event.target.value))}
              />
            </label>

            <button type="button" onClick={reset} style={presetButtonStyle}>
              reset to shipped positions
            </button>

            <CodeBlock label="barn" code={barnFootprintCode} copied={copiedKey === "barn"} onCopy={() => copy("barn", barnFootprintCode)} />
            <CodeBlock label="ray's house" code={houseFootprintCode} copied={copiedKey === "house"} onCopy={() => copy("house", houseFootprintCode)} />

            <div style={{ opacity: 0.55, fontSize: 10.5, lineHeight: 1.4 }}>
              Drag the two markers on the field. Coordinates are yard-local, matching
              lib/stackacres/world.ts and stackacres-scene.ts literals exactly. At
              least the silo is positioned as BARN_X + 40 -- grep for BARN_X/BARN_AT
              after moving the barn.
            </div>

            <CharacterPlacer
              id="merchant"
              label="Midnight Merchant"
              color="#8a6fd8"
              initial={SHIPPED.merchantPoint}
              ready={ready}
              hasTarget={hasMerchantTarget}
              applyLive={applyMerchant}
              buildCode={(p) => `export const MIDNIGHT_MERCHANT_SPOT: WorldPoint = yardPoint(${p.x}, ${p.y});`}
              absentNote="Not currently spawned -- he's a present/absent toggle (night-only), not always on the lot."
            />

            <CharacterPlacer
              id="monk"
              label="Pixel Pilgrim"
              color="#6fa8d8"
              initial={SHIPPED.monkPoint}
              ready={ready}
              hasTarget={hasMonkTarget}
              applyLive={applyMonk}
              buildCode={(p) => `export const MONK_POST: WorldPoint = yardPoint(${p.x}, ${p.y});`}
            />

            <CharacterPlacer
              id="ray"
              label="Ray (traveler)"
              color="#7fd88a"
              initial={SHIPPED.rayPoint}
              ready={ready}
              hasTarget={hasRayTarget}
              applyLive={applyRay}
              buildCode={(p) =>
                `// "ray" is computed by raySpot() in\n` +
                `// lib/stackacres/story/placement.ts, not a hand-typed literal.\n` +
                `// Target yard-local point for reference:\n` +
                `// { x: ${p.x}, y: ${p.y} }\n` +
                `// To lock this exactly, give this traveler a manual override in\n` +
                `// raySpot() instead of leaving it computed.`
              }
            />

            <label style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
              <span>Factory size ({factoryScale.toFixed(2)}×)</span>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.05}
                value={factoryScale}
                onChange={(event) => setFactoryScale(Number(event.target.value))}
              />
            </label>

            <CharacterPlacer
              id="factory"
              label="Factory"
              color="#c98a3f"
              initial={SHIPPED.factoryFeet}
              ready={ready}
              hasTarget={hasFactoryTarget}
              applyLive={applyFactory}
              buildCode={(p) => {
                const w = FACTORY_FOOTPRINT.width * factoryScale;
                const h = FACTORY_FOOTPRINT.height * factoryScale;
                return (
                  `const FACTORY_SCALE = ${factoryScale.toFixed(2)};\n\n` +
                  `export const FACTORY_FOOTPRINT: WorldRect =\n` +
                  `  yardRect(${p.x - w / 2}, ${p.y - h}, ${w}, ${h});`
                );
              }}
            />

            <BarbFencePlacer ready={ready} />
          </div>
        )}
      </div>

      {!minimized && ready && (
        <>
          <div
            ref={barnRef}
            onPointerDown={startDrag("barn")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={markerStyle("#e07a5b", 110)}
            title="Drag the barn"
          >
            BARN
          </div>
          <div
            ref={houseRef}
            onPointerDown={startDrag("house")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={markerStyle("#e2b25e", 110)}
            title="Drag Ray's house"
          >
            HOUSE
          </div>
        </>
      )}
    </>
  );
}

/**
 * One draggable character marker plus its own code readout, for anything
 * simpler than the barn/house: a single world point, no footprint or flip.
 * Reuses the same big-grab-handle-and-reference-grid feel, just self-
 * contained so adding another character doesn't mean copy-pasting the
 * barn/house's own drag plumbing a third and fourth time.
 */
function CharacterPlacer({
  id,
  label,
  color,
  initial,
  ready,
  hasTarget,
  applyLive,
  buildCode,
  absentNote,
}: {
  id: string;
  label: string;
  color: string;
  initial: WorldPoint;
  ready: boolean;
  hasTarget: () => boolean;
  applyLive: (point: WorldPoint) => void;
  buildCode: (yardLocal: WorldPoint) => string;
  absentNote?: string;
}) {
  const [point, setPoint] = useState<WorldPoint>(initial);
  const [present, setPresent] = useState(false);
  const [copied, setCopied] = useState(false);
  const markerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; grabOffset: WorldPoint } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const tick = () => setPresent(hasTarget());
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [ready, hasTarget]);

  useEffect(() => {
    if (!ready || !present) return;
    const tick = () => {
      const handle = devHandle();
      if (!handle || !markerRef.current) return;
      const screen = handle.screenPointFor(point.x, point.y);
      markerRef.current.style.left = `${screen.x}px`;
      markerRef.current.style.top = `${screen.y}px`;
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [ready, present, point]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const handle = devHandle();
      if (!handle) return;
      event.stopPropagation();
      const pointerWorld = handle.worldPointFor(event.clientX, event.clientY);
      dragRef.current = {
        pointerId: event.pointerId,
        grabOffset: { x: pointerWorld.x - point.x, y: pointerWorld.y - point.y },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      handle.showDevPlacementGrid(point.x, point.y);
    },
    [point],
  );

  const onDragMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const handle = devHandle();
      if (!drag || !handle || drag.pointerId !== event.pointerId) return;
      const pointerWorld = handle.worldPointFor(event.clientX, event.clientY);
      const next = { x: snap(pointerWorld.x - drag.grabOffset.x), y: snap(pointerWorld.y - drag.grabOffset.y) };
      setPoint(next);
      applyLive(next);
    },
    [applyLive],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    devHandle()?.hideDevPlacementGrid();
  }, []);

  const code = buildCode(toYardLocal(point));
  const copy = useCallback(() => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        })
        .catch(() => {});
    }
  }, [code]);

  return (
    <div style={{ borderTop: "1px solid #33452b", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      {!present ? (
        <div style={{ opacity: 0.6, fontSize: 10.5 }}>{absentNote ?? "Not currently on the map."}</div>
      ) : (
        <>
          <CodeBlock label={id} code={code} copied={copied} onCopy={copy} />
          {ready && (
            <div
              ref={markerRef}
              onPointerDown={startDrag}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={markerStyle(color, 70)}
              title={`Drag ${label}`}
            >
              {label}
            </div>
          )}
        </>
      )}
    </div>
  );
}

let nextBarbPieceId = 1000;

/** One piece's own printed line, yard-local like every other buildCode
 *  here -- `flipX`/`flipY` only show up when true, so a piece nobody flipped
 *  prints exactly as plain as the shipped run's own lines always were. */
function barbPieceLine(piece: PlacedBarbPiece): string {
  const p = toYardLocal(piece.point);
  const flips = [piece.flipX && "flipX: true", piece.flipY && "flipY: true"].filter(Boolean).join(", ");
  return `  { kind: "${piece.kind}", ...yardPoint(${p.x}, ${p.y})${flips ? `, ${flips}` : ""} },`;
}

/** A short label for the kind picker -- the raw PropKind string works fine
 *  too, this just reads faster in a cramped dropdown. */
const BARB_KIND_LABEL: Readonly<Record<BarbKind, string>> = {
  barbEndWest: "end (west)",
  barbEndEast: "end (east)",
  barbStraight1: "straight 1",
  barbStraight2: "straight 2",
  barbCorner: "corner",
};

/**
 * The barbed-wire fence's own placer: every piece is its own independent
 * draggable marker with its own kind and flip toggles -- no shared layout,
 * no forced turn direction. Kayo's own call after the leg-editor version
 * this replaced: "let me place and design my own." Add a piece, drag it
 * wherever, flip it until it reads right, remove it if it doesn't belong --
 * the same trust `stockDevPlacementGrid` already gives the barn/house/
 * factory, just N times over instead of once.
 *
 * Live preview goes through the scene's own sprite pool
 * (`setBarbFenceDevPieces`) -- every piece in `pieces`, recomputed and
 * pushed whenever any of them move, get added, removed, or flipped.
 */
function BarbFencePlacer({ ready }: { ready: boolean }) {
  const [pieces, setPieces] = useState<PlacedBarbPiece[]>(() => shippedBarbPieces());
  const [addKind, setAddKind] = useState<BarbKind>("barbStraight1");
  const [present, setPresent] = useState(false);
  const [copied, setCopied] = useState(false);
  const markerRefs = useRef(new Map<number, HTMLDivElement>());
  const dragRef = useRef<{ id: number; pointerId: number; grabOffset: WorldPoint } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const tick = () => setPresent(devHandle() !== null);
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [ready]);

  // Keeps every marker glued to its own world point while the camera pans
  // or zooms -- one tick over the whole list, the same 10fps budget every
  // other placer's own tracking effect uses.
  useEffect(() => {
    if (!ready || !present) return;
    const tick = () => {
      const handle = devHandle();
      if (!handle) return;
      for (const piece of pieces) {
        const el = markerRefs.current.get(piece.id);
        if (!el) continue;
        const screen = handle.screenPointFor(piece.point.x, piece.point.y);
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
      }
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [ready, present, pieces]);

  useEffect(() => {
    if (!ready || !present) return;
    devHandle()?.setBarbFenceDevPieces(
      pieces.map((piece) => ({ kind: piece.kind, x: piece.point.x, y: piece.point.y, flipX: piece.flipX, flipY: piece.flipY })),
    );
  }, [ready, present, pieces]);

  // Unmounts whenever the panel minimizes (it lives inside the same
  // `{!minimized && ...}` block every other placer does) -- clearing the
  // preview and showing the shipped run again is this effect's only job,
  // the same symmetry `hideDevPlacementGrid` keeps elsewhere.
  useEffect(() => {
    return () => devHandle()?.clearBarbFenceDevPieces();
  }, []);

  const startDrag = useCallback(
    (id: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
      const handle = devHandle();
      if (!handle) return;
      event.stopPropagation();
      const piece = pieces.find((p) => p.id === id);
      if (!piece) return;
      const pointerWorld = handle.worldPointFor(event.clientX, event.clientY);
      dragRef.current = {
        id,
        pointerId: event.pointerId,
        grabOffset: { x: pointerWorld.x - piece.point.x, y: pointerWorld.y - piece.point.y },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      handle.showDevPlacementGrid(piece.point.x, piece.point.y);
    },
    [pieces],
  );

  const onDragMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const handle = devHandle();
    if (!drag || !handle || drag.pointerId !== event.pointerId) return;
    const pointerWorld = handle.worldPointFor(event.clientX, event.clientY);
    const next = { x: snap(pointerWorld.x - drag.grabOffset.x), y: snap(pointerWorld.y - drag.grabOffset.y) };
    setPieces((prev) => prev.map((piece) => (piece.id === drag.id ? { ...piece, point: next } : piece)));
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    devHandle()?.hideDevPlacementGrid();
  }, []);

  const addPiece = useCallback(() => {
    setPieces((prev) => {
      // Drops the new piece a short offset from the last one (or a plain
      // yard spot if this is the first) -- somewhere on screen to grab,
      // never on top of an existing marker.
      const last = prev[prev.length - 1];
      const point = last ? { x: last.point.x + 20, y: last.point.y + 8 } : { x: -720 + 110, y: -175 + 424 };
      return [...prev, { id: nextBarbPieceId++, kind: addKind, point, flipX: false, flipY: false }];
    });
  }, [addKind]);

  const removePiece = useCallback((id: number) => {
    setPieces((prev) => prev.filter((piece) => piece.id !== id));
  }, []);

  const setPieceKind = useCallback((id: number, kind: BarbKind) => {
    setPieces((prev) => prev.map((piece) => (piece.id === id ? { ...piece, kind } : piece)));
  }, []);

  const toggleFlip = useCallback((id: number, axis: "flipX" | "flipY") => {
    setPieces((prev) => prev.map((piece) => (piece.id === id ? { ...piece, [axis]: !piece[axis] } : piece)));
  }, []);

  const code =
    pieces.length === 0
      ? "// No pieces -- add at least one below."
      : `// Replace the shipped barbEnd*/barbStraight*/barbCorner entries in\n` +
        `// props.ts's YARD_PROPS with (PropPlacement's own flipX/flipY are new --\n` +
        `// see its header):\n` +
        pieces.map(barbPieceLine).join("\n");

  const copy = useCallback(() => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        })
        .catch(() => {});
    }
  }, [code]);

  return (
    <div style={{ borderTop: "1px solid #33452b", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontWeight: 700 }}>Barbed-wire fence</div>
      {!present ? (
        <div style={{ opacity: 0.6, fontSize: 10.5 }}>Not currently on the map.</div>
      ) : (
        <>
          {pieces.map((piece) => (
            <div key={piece.id} style={{ ...rowStyle, flexWrap: "wrap" }}>
              <select
                value={piece.kind}
                onChange={(event) => setPieceKind(piece.id, event.target.value as BarbKind)}
                style={{ ...presetButtonStyle, padding: "3px 4px" }}
              >
                {BARB_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {BARB_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10.5 }}>
                <input type="checkbox" checked={piece.flipX} onChange={() => toggleFlip(piece.id, "flipX")} />
                flipX
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10.5 }}>
                <input type="checkbox" checked={piece.flipY} onChange={() => toggleFlip(piece.id, "flipY")} />
                flipY
              </label>
              <button type="button" onClick={() => removePiece(piece.id)} style={presetButtonStyle}>
                remove
              </button>
            </div>
          ))}

          <div style={rowStyle}>
            <select value={addKind} onChange={(event) => setAddKind(event.target.value as BarbKind)} style={{ ...presetButtonStyle, padding: "3px 4px" }}>
              {BARB_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {BARB_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
            <button type="button" onClick={addPiece} style={presetButtonStyle}>
              add piece
            </button>
          </div>

          <div style={{ opacity: 0.55, fontSize: 10.5, lineHeight: 1.4 }}>
            Every piece drags and flips on its own -- nothing here lays itself out
            automatically. Drag a marker below, or add another piece above.
          </div>

          <CodeBlock label="barbFence" code={code} copied={copied} onCopy={copy} />

          {ready &&
            pieces.map((piece) => (
              <div
                key={piece.id}
                ref={(el) => {
                  if (el) markerRefs.current.set(piece.id, el);
                  else markerRefs.current.delete(piece.id);
                }}
                onPointerDown={startDrag(piece.id)}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={markerStyle("#8a8f96", 50)}
                title={`Drag ${BARB_KIND_LABEL[piece.kind]}`}
              >
                {BARB_KIND_LABEL[piece.kind]}
              </div>
            ))}
        </>
      )}
    </div>
  );
}

function CodeBlock({
  label,
  code,
  copied,
  onCopy,
}: {
  label: string;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <div style={{ opacity: 0.6, fontSize: 10.5, marginBottom: 2 }}>{label}</div>
      <pre style={codeStyle}>{code}</pre>
      <button type="button" onClick={onCopy} style={{ ...presetButtonStyle, position: "absolute", top: 16, right: 4 }}>
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function panelStyle(minimized: boolean): CSSProperties {
  return {
    position: "fixed",
    bottom: 12,
    left: 12,
    zIndex: 2147483000,
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    color: "#e9efe4",
    background: "rgba(16, 22, 15, 0.94)",
    border: "1px solid #4f6a45",
    borderRadius: 10,
    boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
    width: minimized ? 180 : 320,
    maxHeight: "70vh",
    overflowY: "auto",
  };
}

const headerStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "6px 10px",
  background: "#2c4224",
  color: "#fff",
  border: "none",
  cursor: "pointer",
  fontWeight: 700,
  letterSpacing: "0.02em",
  position: "sticky",
  top: 0,
};

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 6 };

const presetButtonStyle: CSSProperties = {
  background: "#233a1d",
  color: "#e9efe4",
  border: "1px solid #4f6a45",
  borderRadius: 6,
  padding: "3px 7px",
  cursor: "pointer",
  fontSize: 11,
};

const codeStyle: CSSProperties = {
  margin: 0,
  padding: "6px 8px",
  background: "#0d130b",
  border: "1px solid #33452b",
  borderRadius: 6,
  fontSize: 10.5,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/**
 * A generous grab handle, not a pixel-precise hitbox: sized well past the
 * target's own on-screen art (translate anchors its bottom edge at the feet
 * point, same as the sprite itself) so it sits on top of and catches every
 * click that would otherwise reach the barn/house/character underneath and
 * trigger its normal tap (open the store, start dialogue, etc). That's
 * deliberate -- while this panel is open, dragging takes over the normal
 * tap, and the panel is meant to be minimized again once you're done
 * placing things. Buildings use a bigger diameter than characters.
 */
function markerStyle(color: string, diameter: number): CSSProperties {
  return {
    position: "fixed",
    zIndex: 2147483000,
    transform: "translate(-50%, -100%)",
    width: diameter,
    height: diameter,
    borderRadius: "50%",
    background: `${color}55`,
    border: `3px dashed ${color}`,
    boxShadow: "0 0 0 2px rgba(16, 22, 15, 0.6)",
    cursor: "grab",
    touchAction: "none",
    padding: 4,
    fontSize: diameter >= 100 ? 12 : 9.5,
    lineHeight: 1.15,
    fontFamily: "ui-monospace, monospace",
    color: "#10160f",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    textShadow: "0 1px 0 rgba(255,255,255,0.4)",
  };
}
