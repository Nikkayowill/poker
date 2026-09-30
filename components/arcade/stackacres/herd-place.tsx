"use client";

import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import type { Action } from "@/lib/stackacres/farm-actions";
import { STACKACRES_CATALOGUE } from "@/lib/stackacres/catalogue";
import { herdKey, isHerdStock, isPlaced, unplacedHerd, type HerdUnit } from "@/lib/stackacres/herd";
import type { Tile } from "@/lib/stackacres/empire-buildings";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";
import type { ContractActionResult } from "./TownContractsModal";

/**
 * Setting the herd down on the Homestead (lib/stackacres/herd.ts).
 *
 * A sheep or cow you have bought but not set down waits to be placed: the bar
 * opens by itself, and each tap on open grass puts the next one there. With
 * nothing waiting, the Herd key opens the same bar to move what stands: a tap on
 * an animal lifts it, and the next tap sets it back down.
 *
 * Every placement shows at once (the farm's own optimistic answer) and a refusal
 * puts it back and says why on the bar. No Gold moves here.
 */

type Mode = "closed" | "open";

export interface HerdPlaceProps {
  /** The farmer is out on the Homestead. Everything here is off anywhere else. */
  active: boolean;
  units: readonly (HerdUnit & { id: string })[];
  act: (action: Action) => Promise<ContractActionResult>;
}

export interface HerdPlace {
  /** The map takes taps as squares to place on instead of walking there. */
  buildMode: boolean;
  onBuildTap: (tile: Tile) => void;
  controls: React.ReactNode;
}

function noun(unit: HerdUnit, plural: boolean): string {
  const label = isHerdStock(unit.stock) ? STACKACRES_CATALOGUE[unit.stock].label : "animal";
  return plural ? `${label}s` : label;
}

export function useHerdPlace({ active, units, act }: HerdPlaceProps): HerdPlace {
  const [mode, setMode] = useState<Mode>("closed");
  /** The one just lifted, so the next tap sets down that animal and not another. */
  const [carrying, setCarrying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const herd = useMemo(() => units.filter((unit) => isHerdStock(unit.stock)), [units]);
  const waiting = useMemo(() => unplacedHerd(herd), [herd]);

  // A new animal waiting opens the bar; leaving the Homestead closes it.
  const [wasWaiting, setWasWaiting] = useState(waiting.length);
  if (waiting.length !== wasWaiting) {
    setWasWaiting(waiting.length);
    if (waiting.length > wasWaiting && active) setMode("open");
  }
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setMode("closed");
    else if (waiting.length > 0) setMode("open");
  }

  const open = active && mode === "open" && herd.length > 0;

  const squares = useMemo(() => {
    const map = new Map<string, string>();
    for (const unit of herd) if (isPlaced(unit)) map.set(herdKey(unit.mapTx as number, unit.mapTy as number), unit.id);
    return map;
  }, [herd]);

  const onBuildTap = useCallback(
    (tile: Tile) => {
      if (!open) return;
      setNotice(null);
      const standing = squares.get(herdKey(tile.tx, tile.ty));
      const nextId = carrying ?? waiting[0]?.id ?? null;
      // A tap on an animal lifts it, unless one is already in hand to put down.
      if (standing && (nextId === null || standing === nextId)) {
        setCarrying(standing);
        void act({ action: "pick-up-animal", unitId: standing }).then((result) => {
          if (!result.ok) {
            setCarrying(null);
            setNotice(result.message);
          }
        });
        return;
      }
      if (!nextId) return;
      setCarrying(null);
      void act({ action: "place-animal", unitId: nextId, tx: tile.tx, ty: tile.ty }).then((result) => {
        if (!result.ok) {
          setCarrying(nextId);
          setNotice(result.message);
        }
      });
    },
    [open, squares, carrying, waiting, act],
  );

  const inHand = carrying ? herd.find((unit) => unit.id === carrying) : undefined;
  const next = inHand ?? waiting[0];

  let controls: React.ReactNode = null;
  if (active && herd.length > 0) {
    controls = open ? (
      <div className="sa-build-bar" role="toolbar" aria-label="Herd">
        <p className={clsx("sa-build-say", notice && "is-problem")}>
          {notice ??
            (next
              ? `Tap open grass to set down your ${noun(next, false).toLowerCase()}.${waiting.length > 1 ? ` ${waiting.length} waiting.` : ""}`
              : "Tap an animal to pick it up and move it.")}
        </p>
        <div className="sa-build-keys">
          <button
            type="button"
            className="sa-sheet-close"
            onClick={() => {
              setMode("closed");
              setCarrying(null);
              setNotice(null);
            }}
          >
            Done
          </button>
        </div>
      </div>
    ) : (
      <button type="button" className="sa-build-open" onClick={() => setMode("open")}>
        <StackAcresPixelIcon name="build" />
        <span>{waiting.length > 0 ? `Place (${waiting.length})` : "Herd"}</span>
      </button>
    );
  }

  return { buildMode: open, onBuildTap, controls };
}
