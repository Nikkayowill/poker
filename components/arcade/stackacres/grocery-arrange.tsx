"use client";

import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import type { Action } from "@/lib/stackacres/farm-actions";
import type { GroceryView } from "@/lib/stackacres/grocery";
import { GROCERY_ECONOMY } from "@/lib/stackacres/grocery-economy";
import {
  ARRANGE_MESSAGES,
  GROCERY_ITEMS,
  GROCERY_ITEM_KINDS,
  GROCERY_ROOM_SIZE,
  isPlacedItem,
  itemAt,
  itemFootprint,
  itemSolid,
  layoutCapacity,
  layoutProblem,
  withItem,
  type Cell,
  type GroceryItemKind,
  type GroceryPlacement,
} from "@/lib/stackacres/grocery-layout";
import { GroceryItemPicture } from "./grocery-art";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";
import type { ContractActionResult } from "./TownContractsModal";
import type { GroceryGhost } from "./world-contract";

/**
 * Arranging the city grocery (lib/stackacres/grocery-layout.ts): the Arrange key, the bar you place with, and the
 * tray of fixtures and decor. The same shape as building on the Far Field (empire-build.tsx).
 *
 * Arranging shuts the shop (the scene sends everyone home) so nobody is standing where a shelf is about to go;
 * Done opens it again on the new floor. A tap on anything picks it up to move. From the tray a fixture or piece
 * of decor is bought or taken out of storage, and appears near the farmer as a see-through picture over green
 * or red squares, the squares people use it from paler, and the floor it needs kept open (a lane's way out)
 * marked. Each tap moves it; the tick puts it down, Store puts it away, the cross gives up. Buying costs Gold;
 * moving, storing and putting back are free.
 *
 * A piece put down, moved or stored shows that way at once and stays so while the server answers; a refusal
 * puts it back and is said on the bar.
 */

type Placing =
  | { from: "buy"; kind: GroceryItemKind; tx: number; ty: number }
  | { from: "owned"; id: string; kind: GroceryItemKind; tx: number; ty: number; stored: boolean };

type Mode = { at: "off" } | { at: "arrange" } | { at: "tray"; group: "fixture" | "decor" } | { at: "placing"; placing: Placing };

const PENDING_NEW = "pending-new";

/** What a fixture gives the shop, for the tray. */
function offers(kind: GroceryItemKind): string | null {
  const def = GROCERY_ITEMS[kind];
  if (def.group === "decor") return `Appeal +${def.appeal}`;
  const capacity = layoutCapacity([{ id: "x", kind, tx: 0, ty: 0 }]);
  if (capacity.tills) return "A till for one more cashier";
  if (capacity.counters) return `${capacity.counters} places for produce clerks`;
  if (capacity.shelfSpots) return `${capacity.shelfSpots} squares of shelf to shop from`;
  return null;
}

export interface GroceryArrangeProps {
  /** The farmer is in the grocery and owns it. Everything here is off otherwise. */
  active: boolean;
  grocery: GroceryView | null;
  gold: number;
  unlimitedGold: boolean;
  act: (action: Action) => Promise<ContractActionResult>;
  farmerTile: () => Cell | null;
}

export interface GroceryArrange {
  /** The layout to draw, with anything waiting on the server already shown its new way. */
  layout: readonly GroceryPlacement[] | null;
  buildMode: boolean;
  ghost: GroceryGhost | null;
  onBuildTap: (tile: Cell) => void;
  /** Start arranging, with the tray open. */
  openTray: () => void;
  controls: React.ReactNode;
}

export function useGroceryArrange({ active, grocery, gold, unlimitedGold, act, farmerTile }: GroceryArrangeProps): GroceryArrange {
  const [mode, setMode] = useState<Mode>({ at: "off" });
  const [pending, setPending] = useState<GroceryPlacement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Leaving the shop puts everything down.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setMode({ at: "off" });
  }

  const owned = grocery?.owned ? grocery.layout : null;
  const layout = useMemo(() => (owned && pending ? withItem(owned, pending) : owned), [owned, pending]);
  const stored = useMemo(() => (layout ?? []).filter((item) => !isPlacedItem(item)), [layout]);

  const placing = mode.at === "placing" ? mode.placing : null;

  /** The layout as it would be with `at` put down, and what's wrong with it, the farmer read now. */
  const spotProblem = useCallback(
    (at: Placing): string | null => {
      if (!layout) return null;
      const farmer = farmerTile();
      const def = GROCERY_ITEMS[at.kind];
      const cells = def.flat ? [] : itemSolid(at.kind, at.tx, at.ty);
      if (farmer && cells.some((c) => c.tx === farmer.tx && c.ty === farmer.ty)) return "Step out of the way first.";
      const id = at.from === "owned" ? at.id : PENDING_NEW;
      const rule = layoutProblem(withItem(layout, { id, kind: at.kind, tx: at.tx, ty: at.ty }), farmer ? [farmer] : []);
      return rule ? ARRANGE_MESSAGES[rule] : null;
    },
    [farmerTile, layout],
  );

  const problem = useMemo(() => (placing ? spotProblem(placing) : null), [placing, spotProblem]);

  const ghostKind = placing?.kind;
  const ghostTx = placing?.tx;
  const ghostTy = placing?.ty;
  const ghost = useMemo<GroceryGhost | null>(
    () =>
      ghostKind !== undefined && ghostTx !== undefined && ghostTy !== undefined
        ? { kind: ghostKind, tx: ghostTx, ty: ghostTy, ok: problem === null }
        : null,
    [ghostKind, ghostTx, ghostTy, problem],
  );

  /** Somewhere to start: the nearest spot to the farmer where it fits, searching outward. */
  const startSpot = useCallback(
    (kind: GroceryItemKind, id: string): Cell => {
      const { w, h } = GROCERY_ITEMS[kind];
      const farmer = farmerTile() ?? { tx: 14, ty: 15 };
      const want = { tx: farmer.tx - Math.floor(w / 2), ty: farmer.ty - h - 1 };
      if (!layout) return want;
      for (let r = 0; r <= Math.max(GROCERY_ROOM_SIZE.width, GROCERY_ROOM_SIZE.height); r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const at = { tx: want.tx + dx, ty: want.ty + dy };
            const footprint = itemFootprint(kind, at.tx, at.ty);
            if (footprint.some((c) => c.tx < 1 || c.ty < 1 || c.tx >= GROCERY_ROOM_SIZE.width - 1 || c.ty >= GROCERY_ROOM_SIZE.height - 1)) continue;
            const cells = GROCERY_ITEMS[kind].flat ? [] : itemSolid(kind, at.tx, at.ty);
            if (cells.some((c) => c.tx === farmer.tx && c.ty === farmer.ty)) continue;
            if (layoutProblem(withItem(layout, { id, kind, ...at }), [farmer]) === null) return at;
          }
        }
      }
      return want;
    },
    [farmerTile, layout],
  );

  const onBuildTap = useCallback(
    (tile: Cell) => {
      if (!layout) return;
      if (mode.at === "placing") {
        const { w, h } = GROCERY_ITEMS[mode.placing.kind];
        setNotice(null);
        setMode({ at: "placing", placing: { ...mode.placing, tx: tile.tx - Math.floor(w / 2), ty: tile.ty - Math.floor(h / 2) } });
        return;
      }
      if (mode.at !== "arrange") return;
      const hit = itemAt(layout, tile);
      if (hit && hit.id !== PENDING_NEW) {
        setNotice(null);
        setMode({ at: "placing", placing: { from: "owned", id: hit.id, kind: hit.kind, tx: hit.tx, ty: hit.ty, stored: false } });
      }
    },
    [layout, mode],
  );

  const send = useCallback(
    async (action: Action, guess: GroceryPlacement) => {
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
      void send({ action: "grocery-buy", kind: placing.kind, tx: placing.tx, ty: placing.ty }, { id: PENDING_NEW, kind: placing.kind, tx: placing.tx, ty: placing.ty });
    } else {
      void send({ action: "grocery-place", id: placing.id, tx: placing.tx, ty: placing.ty }, { id: placing.id, kind: placing.kind, tx: placing.tx, ty: placing.ty });
    }
  };

  const putAway = () => {
    if (!placing || placing.from !== "owned" || placing.stored || !layout) return;
    const rule = layoutProblem(withItem(layout, { id: placing.id, kind: placing.kind, tx: null, ty: null }));
    if (rule) {
      setNotice(ARRANGE_MESSAGES[rule]);
      return;
    }
    void send({ action: "grocery-store", id: placing.id }, { id: placing.id, kind: placing.kind, tx: null, ty: null });
  };

  const choose = (kind: GroceryItemKind) => {
    setNotice(null);
    const inStorage = stored.find((item) => item.kind === kind);
    if (inStorage) {
      setMode({ at: "placing", placing: { from: "owned", id: inStorage.id, kind, ...startSpot(kind, inStorage.id), stored: true } });
      return;
    }
    setMode({ at: "placing", placing: { from: "buy", kind, ...startSpot(kind, PENDING_NEW) } });
  };

  const openTray = useCallback(() => {
    setNotice(null);
    setMode({ at: "tray", group: "fixture" });
  }, []);

  let controls: React.ReactNode = null;
  if (active && layout) {
    const appeal = layoutCapacity(layout).appeal;
    const appealBonus = Math.min(GROCERY_ECONOMY.appealMax, appeal / GROCERY_ECONOMY.appealPerPercent / 100);
    controls = (
      <>
        {mode.at === "off" && (
          <button type="button" className="sa-build-open" onClick={() => setMode({ at: "arrange" })}>
            <StackAcresPixelIcon name="build" />
            <span>Arrange</span>
          </button>
        )}
        {mode.at === "arrange" && (
          <div className="sa-build-bar" role="toolbar" aria-label="Arranging the shop">
            <p className={clsx("sa-build-say", notice && "is-problem")}>
              {notice ?? "The shop's shut while you arrange. Tap anything to move it."}
            </p>
            <div className="sa-build-keys">
              <button type="button" className="sa-cta" onClick={openTray}>
                Add
              </button>
              <button type="button" className="sa-sheet-close" onClick={() => setMode({ at: "off" })}>
                Done
              </button>
            </div>
          </div>
        )}
        {mode.at === "tray" && (
          <div className="sa-build-tray-wrap">
            <section className="sa-sheet sa-build-tray sa-grocery-tray" aria-label="Fixtures and decor">
              <header className="sa-sheet-head sa-build-tray-head">
                <div className="sa-grocery-tray-tabs" role="tablist" aria-label="What to add">
                  {(["fixture", "decor"] as const).map((group) => (
                    <button
                      key={group}
                      type="button"
                      role="tab"
                      aria-selected={mode.group === group}
                      className={clsx("sa-grocery-tray-tab", mode.group === group && "is-on")}
                      onClick={() => setMode({ at: "tray", group })}
                    >
                      {group === "fixture" ? "Fixtures" : "Decor"}
                    </button>
                  ))}
                </div>
                <button type="button" className="sa-sheet-close" onClick={() => setMode({ at: "arrange" })}>
                  Close
                </button>
              </header>
              {mode.group === "decor" && (
                <p className="sa-grocery-tray-appeal">
                  Appeal <strong>{appeal}</strong>: {Math.round(appealBonus * 100)}% more shoppers
                  {appealBonus < GROCERY_ECONOMY.appealMax ? ` (up to ${Math.round(GROCERY_ECONOMY.appealMax * 100)}%)` : ", as many as decor can bring"}.
                </p>
              )}
              <ul className="sa-build-list">
                {GROCERY_ITEM_KINDS.filter((kind) => GROCERY_ITEMS[kind].group === mode.group).map((kind) => {
                  const def = GROCERY_ITEMS[kind];
                  const have = layout.filter((item) => item.kind === kind).length;
                  const inStorage = stored.filter((item) => item.kind === kind).length;
                  const full = inStorage === 0 && have >= def.max;
                  const short = inStorage > 0 || unlimitedGold || gold >= def.gold ? 0 : def.gold - gold;
                  const gives = offers(kind);
                  return (
                    <li key={kind} className="sa-build-item sa-grocery-tray-item">
                      <GroceryItemPicture kind={kind} />
                      <div className="sa-build-about">
                        <h3>{def.label}</h3>
                        <p>{def.blurb}</p>
                        {gives && <p className="sa-grocery-gives">{gives}</p>}
                        {inStorage > 0 ? (
                          <p className="sa-build-stored">{inStorage === 1 ? "One in storage" : `${inStorage} in storage`}: free to put down.</p>
                        ) : (
                          <p className="sa-build-cost">
                            <span className={clsx(short > 0 && "is-short")}>
                              <StackAcresPixelIcon name="coin" />
                              {def.gold.toLocaleString()}
                            </span>
                            <span className="sa-grocery-have">
                              {have} of {def.max}
                            </span>
                          </p>
                        )}
                      </div>
                      <button type="button" className="sa-cta" disabled={full || short > 0} onClick={() => choose(kind)}>
                        {inStorage > 0 ? "Place" : full ? "No room" : short > 0 ? `Need ${short.toLocaleString()}` : "Buy"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
        {mode.at === "placing" && (
          <div className="sa-build-bar" role="toolbar" aria-label={`Placing the ${GROCERY_ITEMS[mode.placing.kind].label}`}>
            <p className={clsx("sa-build-say", (notice ?? problem) && "is-problem")}>
              {notice ??
                problem ??
                (mode.placing.from === "buy"
                  ? `Tap to move it. ✓ buys it for ${GROCERY_ITEMS[mode.placing.kind].gold.toLocaleString()} Gold.`
                  : "Tap to move it. ✓ puts it here.")}
            </p>
            <div className="sa-build-keys">
              <button type="button" className="sa-cta" disabled={problem !== null} onClick={confirm} aria-label="Put it here">
                ✓
              </button>
              {mode.placing.from === "owned" && !mode.placing.stored && (
                <button type="button" className="sa-sheet-close" onClick={putAway}>
                  Store
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

  return { layout, buildMode: active && mode.at !== "off", ghost: active ? ghost : null, onBuildTap, openTray, controls };
}
