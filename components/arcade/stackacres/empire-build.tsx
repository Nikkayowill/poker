"use client";

import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import type { Action } from "@/lib/stackacres/farm-actions";
import {
  EMPIRE_BUILDINGS,
  EMPIRE_BUILDING_KINDS,
  EMPIRE_MAP,
  PLACEMENT_MESSAGES,
  buildingTiles,
  isPlaced,
  placementProblem,
  type EmpireBuildingKind,
  type EmpireSnapshot,
  type PlacedEmpireBuilding,
  type Tile,
} from "@/lib/stackacres/empire-buildings";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";
import type { ContractActionResult } from "./TownContractsModal";
import type { BuildGhost } from "./world-contract";

/**
 * Building on the Far Field (lib/stackacres/empire-buildings.ts): the Build button, the tray of
 * buildings, and the bar you place one with.
 *
 * Build puts the map into arranging: a tap on a building picks it up to move. From the tray a building
 * is bought or taken out of storage, and appears in front of the farmer as a see-through picture over
 * green or red squares. Each tap moves it; the tick puts it down and the cross gives up. Buying costs
 * Gold, Wood and Metal. Moving, picking up and putting back down are free.
 *
 * A building put down, moved or picked up shows that way at once and stays so while the server
 * answers; a refusal puts it back.
 */

type Placing =
  | { from: "buy"; kind: EmpireBuildingKind; tx: number; ty: number }
  | { from: "owned"; id: string; kind: EmpireBuildingKind; tx: number; ty: number; stored: boolean };

type Mode = { at: "off" } | { at: "arrange" } | { at: "tray" } | { at: "placing"; placing: Placing };

/** What the screen shows ahead of the server: a building put somewhere, or picked up. */
type Pending = { id: string; kind: EmpireBuildingKind; tx: number; ty: number } | { id: string; pickedUp: true };

const PENDING_NEW = "pending-new";

interface Wallet {
  gold: number;
  unlimitedGold: boolean;
  wood: number;
  metal: number;
}

function shortOf(kind: EmpireBuildingKind, wallet: Wallet): string | null {
  const def = EMPIRE_BUILDINGS[kind];
  if (!wallet.unlimitedGold && wallet.gold < def.gold) return `${(def.gold - wallet.gold).toLocaleString()} more Gold`;
  for (const material of def.materials) {
    const have = material.item === "wood" ? wallet.wood : material.item === "metal" ? wallet.metal : 0;
    if (have < material.quantity) return `${(material.quantity - have).toLocaleString()} more ${material.item === "wood" ? "Wood" : "Metal"}`;
  }
  return null;
}

/** The nearest top-left tile to `want` where `kind` may stand, searching outward, or `want` itself if none. */
function nearestFit(kind: EmpireBuildingKind, want: Tile, placed: readonly PlacedEmpireBuilding[], movingId: string | null): Tile {
  for (let r = 0; r <= Math.max(EMPIRE_MAP.width, EMPIRE_MAP.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = want.tx + dx;
        const ty = want.ty + dy;
        if (placementProblem(kind, tx, ty, placed, movingId) === null) return { tx, ty };
      }
    }
  }
  return want;
}

export interface EmpireBuildProps {
  /** The farmer is on the Far Field. Everything here is off anywhere else. */
  active: boolean;
  empire: EmpireSnapshot;
  gold: number;
  unlimitedGold: boolean;
  act: (action: Action) => Promise<ContractActionResult>;
  farmerTile: () => Tile | null;
}

export interface EmpireBuild {
  /** The buildings to draw, with anything waiting on the server already shown its new way. */
  shown: PlacedEmpireBuilding[];
  buildMode: boolean;
  ghost: BuildGhost | null;
  onBuildTap: (tile: Tile) => void;
  controls: React.ReactNode;
}

export function useEmpireBuild({ active, empire, gold, unlimitedGold, act, farmerTile }: EmpireBuildProps): EmpireBuild {
  const [mode, setMode] = useState<Mode>({ at: "off" });
  const [pending, setPending] = useState<Pending | null>(null);
  /** The last refusal, said on the bar until the next thing is tried. */
  const [notice, setNotice] = useState<string | null>(null);

  // Leaving the Far Field puts the hammer down.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setMode({ at: "off" });
  }

  const wallet: Wallet = { gold, unlimitedGold, wood: empire.wood, metal: empire.metal };

  const withPending = useMemo(() => {
    let buildings = empire.buildings;
    if (pending && "pickedUp" in pending) {
      buildings = buildings.map((b) => (b.id === pending.id ? { ...b, tx: null, ty: null } : b));
    } else if (pending) {
      buildings = buildings.some((b) => b.id === pending.id)
        ? buildings.map((b) => (b.id === pending.id ? { ...b, tx: pending.tx, ty: pending.ty } : b))
        : [...buildings, { id: pending.id, kind: pending.kind, tx: pending.tx, ty: pending.ty }];
    }
    return buildings;
  }, [empire.buildings, pending]);

  const placed = useMemo(() => withPending.filter(isPlaced), [withPending]);
  const stored = useMemo(() => withPending.filter((b) => !isPlaced(b)), [withPending]);

  const placing = mode.at === "placing" ? mode.placing : null;
  // A building being moved stays where it stands, solid, until the move is put down: lifting it would open
  // its squares to the farmer, and a cancel would drop it back on top of him.
  const shown = placed;

  /** What's wrong with the spot, the farmer's square read now (he may have walked since the last tap). */
  const spotProblem = useCallback(
    (at: Placing): string | null => {
      const farmer = farmerTile();
      if (farmer && buildingTiles(at.kind, at.tx, at.ty).some((t) => t.tx === farmer.tx && t.ty === farmer.ty)) {
        return "Step out of the way first.";
      }
      const rule = placementProblem(at.kind, at.tx, at.ty, placed, at.from === "owned" ? at.id : null, farmer ? [farmer] : []);
      return rule ? PLACEMENT_MESSAGES[rule] : null;
    },
    [farmerTile, placed],
  );

  const problem = useMemo(() => (placing ? spotProblem(placing) : null), [placing, spotProblem]);

  const ghostKind = placing?.kind;
  const ghostTx = placing?.tx;
  const ghostTy = placing?.ty;
  const ghost = useMemo<BuildGhost | null>(
    () =>
      ghostKind !== undefined && ghostTx !== undefined && ghostTy !== undefined
        ? { kind: ghostKind, tx: ghostTx, ty: ghostTy, ok: problem === null }
        : null,
    [ghostKind, ghostTx, ghostTy, problem],
  );

  /** Somewhere to start: the plan sitting just above the farmer, or the nearest spot that fits. */
  const startSpot = useCallback(
    (kind: EmpireBuildingKind, movingIdNow: string | null): Tile => {
      const def = EMPIRE_BUILDINGS[kind];
      const farmer = farmerTile() ?? EMPIRE_MAP.spawn;
      return nearestFit(kind, { tx: farmer.tx - def.doorDx, ty: farmer.ty - def.h - 1 }, placed, movingIdNow);
    },
    [farmerTile, placed],
  );

  const onBuildTap = useCallback(
    (tile: Tile) => {
      if (mode.at === "placing") {
        const def = EMPIRE_BUILDINGS[mode.placing.kind];
        setNotice(null);
        setMode({ at: "placing", placing: { ...mode.placing, tx: tile.tx - Math.floor(def.w / 2), ty: tile.ty - Math.floor(def.h / 2) } });
        return;
      }
      if (mode.at !== "arrange") return;
      // Not one still on its way to the server: it has no id to move it by yet.
      const hit = placed.find(
        (b) => b.id !== PENDING_NEW && buildingTiles(b.kind, b.tx, b.ty).some((t) => t.tx === tile.tx && t.ty === tile.ty),
      );
      if (hit) {
        setNotice(null);
        setMode({ at: "placing", placing: { from: "owned", id: hit.id, kind: hit.kind, tx: hit.tx, ty: hit.ty, stored: false } });
      }
    },
    [mode, placed],
  );

  const send = useCallback(
    async (action: Action, guess: Pending) => {
      setPending(guess);
      setNotice(null);
      setMode({ at: "arrange" });
      try {
        const result = await act(action);
        if (!result.ok) setNotice(result.message);
      } finally {
        setPending(null);
      }
    },
    [act],
  );

  const confirm = () => {
    if (!placing) return;
    const now = spotProblem(placing);
    if (now) {
      setNotice(now);
      return;
    }
    if (placing.from === "buy") {
      void send({ action: "buy-building", kind: placing.kind, tx: placing.tx, ty: placing.ty }, { id: PENDING_NEW, kind: placing.kind, tx: placing.tx, ty: placing.ty });
    } else {
      void send({ action: "place-building", id: placing.id, tx: placing.tx, ty: placing.ty }, { id: placing.id, kind: placing.kind, tx: placing.tx, ty: placing.ty });
    }
  };

  const pickUp = () => {
    if (!placing || placing.from !== "owned" || placing.stored) return;
    void send({ action: "pick-up-building", id: placing.id }, { id: placing.id, pickedUp: true });
  };

  const choose = (kind: EmpireBuildingKind) => {
    setNotice(null);
    const inStorage = stored.find((b) => b.kind === kind);
    if (inStorage) {
      const spot = startSpot(kind, inStorage.id);
      setMode({ at: "placing", placing: { from: "owned", id: inStorage.id, kind, ...spot, stored: true } });
      return;
    }
    setMode({ at: "placing", placing: { from: "buy", kind, ...startSpot(kind, null) } });
  };

  let controls: React.ReactNode = null;
  if (active) {
    controls = (
      <>
        {mode.at === "off" && (
          <button type="button" className="sa-build-open" onClick={() => setMode({ at: "arrange" })}>
            <StackAcresPixelIcon name="build" />
            <span>Build</span>
          </button>
        )}
        {mode.at === "arrange" && (
          <div className="sa-build-bar" role="toolbar" aria-label="Building">
            <p className={clsx("sa-build-say", notice && "is-problem")}>
              {notice ?? (placed.length > 0 ? "Tap a building to move it." : "Add your first building.")}
            </p>
            <div className="sa-build-keys">
              <button type="button" className="sa-cta" onClick={() => setMode({ at: "tray" })}>
                Add building
              </button>
              <button type="button" className="sa-sheet-close" onClick={() => setMode({ at: "off" })}>
                Done
              </button>
            </div>
          </div>
        )}
        {mode.at === "tray" && (
          <div className="sa-build-tray-wrap">
            <section className="sa-sheet sa-build-tray" aria-label="Buildings">
              <header className="sa-sheet-head sa-build-tray-head">
                <h2>Buildings</h2>
                <button type="button" className="sa-sheet-close" onClick={() => setMode({ at: "arrange" })}>
                  Close
                </button>
              </header>
              <ul className="sa-build-list">
                {EMPIRE_BUILDING_KINDS.map((kind) => {
                  const def = EMPIRE_BUILDINGS[kind];
                  const inStorage = stored.filter((b) => b.kind === kind).length;
                  const short = inStorage > 0 ? null : shortOf(kind, wallet);
                  return (
                    <li key={kind} className="sa-build-item">
                      {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at its own size, no optimising */}
                      <img className="sa-build-pic" src={`/stackacres-td/common/building-${kind}.png`} alt="" />
                      <div className="sa-build-about">
                        <h3>{def.label}</h3>
                        <p>{def.blurb}</p>
                        {inStorage > 0 ? (
                          <p className="sa-build-stored">{inStorage === 1 ? "One in storage" : `${inStorage} in storage`}: free to put down.</p>
                        ) : (
                          <p className="sa-build-cost">
                            <span className={clsx(!unlimitedGold && gold < def.gold && "is-short")}>
                              <StackAcresPixelIcon name="coin" />
                              {def.gold.toLocaleString()}
                            </span>
                            {def.materials.map((material) => {
                              const have = material.item === "wood" ? wallet.wood : wallet.metal;
                              return (
                                <span key={material.item} className={clsx(have < material.quantity && "is-short")}>
                                  <StackAcresPixelIcon name={material.item === "wood" ? "wood" : "metal"} />
                                  {material.quantity.toLocaleString()}
                                </span>
                              );
                            })}
                          </p>
                        )}
                      </div>
                      <button type="button" className="sa-cta" disabled={short !== null} onClick={() => choose(kind)}>
                        {inStorage > 0 ? "Place" : short ? `Need ${short}` : "Buy"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
        {mode.at === "placing" && (
          <div className="sa-build-bar" role="toolbar" aria-label={`Placing the ${EMPIRE_BUILDINGS[mode.placing.kind].label}`}>
            <p className={clsx("sa-build-say", (notice ?? problem) && "is-problem")}>
              {notice ?? problem ?? (mode.placing.from === "buy" ? `Tap to move it. ✓ builds the ${EMPIRE_BUILDINGS[mode.placing.kind].label} here.` : "Tap to move it. ✓ puts it here.")}
            </p>
            <div className="sa-build-keys">
              <button type="button" className="sa-cta" disabled={problem !== null} onClick={confirm} aria-label="Put it here">
                ✓
              </button>
              {mode.placing.from === "owned" && !mode.placing.stored && (
                <button type="button" className="sa-sheet-close" onClick={pickUp}>
                  Pick up
                </button>
              )}
              <button type="button" className="sa-sheet-close" onClick={() => setMode({ at: "arrange" })} aria-label="Cancel">
                ✕
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return { shown, buildMode: active && mode.at !== "off", ghost: active ? ghost : null, onBuildTap, controls };
}
