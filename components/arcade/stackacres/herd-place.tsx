"use client";

import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import type { Action } from "@/lib/stackacres/farm-actions";
import { herdKey, isHerdStock, isPlaced, unplacedHerd, type HerdUnit } from "@/lib/stackacres/herd";
import { GUARD_DOG_CAP, GUARD_DOG_GOLD, GUARD_DOG_RANGE, type GuardDog } from "@/lib/stackacres/guard-dog";
import type { Tile } from "@/lib/stackacres/empire-buildings";
import type { ContractActionResult } from "./TownContractsModal";

/**
 * Setting the herd down on the Homestead (lib/stackacres/herd.ts), and the dog
 * that watches it (lib/stackacres/guard-dog.ts).
 *
 * A sheep or cow you have bought but not set down waits to be placed: the bar
 * opens by itself, and each tap on open grass puts the next one there. With
 * nothing waiting, "Move animals" in the Animals sheet opens the same bar to move
 * what stands: a tap on an animal lifts it, and the next tap sets it back down. A
 * tap on a dog lifts the dog the same way. There is no standing key on the map.
 *
 * The Dog key on the bar buys a dog: the next tap on open grass is where it
 * goes, and that tap is what spends the Gold. Nothing is spent until the square
 * is chosen, and a refused square spends nothing.
 *
 * Every placement shows at once (the farm's own optimistic answer) and a refusal
 * puts it back and says why on the bar. No Gold moves here but the dog's price.
 */

type Mode = "closed" | "open";

export interface HerdPlaceProps {
  /** The farmer is out on the Homestead. Everything here is off anywhere else. */
  active: boolean;
  units: readonly (HerdUnit & { id: string })[];
  dogs: readonly GuardDog[];
  act: (action: Action) => Promise<ContractActionResult>;
}

export interface HerdPlace {
  /** The map takes taps as squares to place on instead of walking there. */
  buildMode: boolean;
  onBuildTap: (tile: Tile) => void;
  controls: React.ReactNode;
  /** Opens the bar, for the Animals sheet. Null off the Homestead or with no herd to move. */
  open: (() => void) | null;
}

/** Something standing on a square that a tap can lift. */
type Standing = { kind: "animal"; id: string } | { kind: "dog"; id: string };

/** What is in the farmer's hands, waiting for a square. */
type Carrying = Standing | { kind: "new-dog" };

/** The animal, not the catalogue's name for its pen ("Sheep Pen"). */
function noun(unit: HerdUnit): string {
  if (unit.stock === "pig") return "sheep";
  if (unit.stock === "cattle") return "cow";
  if (unit.stock === "hog") return "hog";
  if (unit.stock === "steer") return "steer";
  return "animal";
}

export function useHerdPlace({ active, units, dogs, act }: HerdPlaceProps): HerdPlace {
  const [mode, setMode] = useState<Mode>("closed");
  /** The one just lifted (or the dog about to be bought), so the next tap sets that down and not another. */
  const [carrying, setCarrying] = useState<Carrying | null>(null);
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
    const map = new Map<string, Standing>();
    for (const unit of herd) if (isPlaced(unit)) map.set(herdKey(unit.mapTx as number, unit.mapTy as number), { kind: "animal", id: unit.id });
    for (const dog of dogs) map.set(herdKey(dog.tx, dog.ty), { kind: "dog", id: dog.id });
    return map;
  }, [herd, dogs]);

  const onBuildTap = useCallback(
    (tile: Tile) => {
      if (!open) return;
      setNotice(null);
      const standing = squares.get(herdKey(tile.tx, tile.ty));
      const next: Carrying | null = carrying ?? (waiting[0] ? { kind: "animal", id: waiting[0].id } : null);
      // A tap on an animal or a dog lifts it, unless something is already in hand to put down.
      if (standing && (next === null || (next.kind !== "new-dog" && standing.id === next.id))) {
        setCarrying(standing);
        if (standing.kind === "animal") {
          void act({ action: "pick-up-animal", unitId: standing.id }).then((result) => {
            if (!result.ok) {
              setCarrying(null);
              setNotice(result.message);
            }
          });
        }
        return;
      }
      if (!next) return;
      setCarrying(null);
      const request: Action =
        next.kind === "animal"
          ? { action: "place-animal", unitId: next.id, tx: tile.tx, ty: tile.ty }
          : next.kind === "dog"
            ? { action: "move-dog", id: next.id, tx: tile.tx, ty: tile.ty }
            : { action: "buy-dog", tx: tile.tx, ty: tile.ty };
      void act(request).then((result) => {
        if (!result.ok) {
          setCarrying(next);
          setNotice(result.message);
        }
      });
    },
    [open, squares, carrying, waiting, act],
  );

  const inHand = carrying ?? (waiting[0] ? { kind: "animal" as const, id: waiting[0].id } : null);
  const inHandUnit = inHand?.kind === "animal" ? herd.find((unit) => unit.id === inHand.id) : undefined;
  const canBuyDog = dogs.length < GUARD_DOG_CAP;

  let say: string;
  if (inHand?.kind === "new-dog") say = `Tap open grass to set your dog down. It keeps animals within ${GUARD_DOG_RANGE} squares home at night.`;
  else if (inHand?.kind === "dog") say = "Tap open grass to set your dog down.";
  else if (inHandUnit) say = `Tap open grass to set down your ${noun(inHandUnit)}.${waiting.length > 1 ? ` ${waiting.length} waiting.` : ""}`;
  else say = dogs.length > 0 ? "Tap an animal or your dog to pick it up and move it." : "Tap an animal to pick it up and move it.";

  let controls: React.ReactNode = null;
  if (open) {
    controls = (
      <div className="sa-build-bar" role="toolbar" aria-label="Herd">
        <p className={clsx("sa-build-say", notice && "is-problem")}>{notice ?? say}</p>
        <div className="sa-build-keys">
          {canBuyDog && inHand?.kind !== "new-dog" ? (
            <button
              type="button"
              className="sa-sheet-close"
              onClick={() => {
                setNotice(null);
                setCarrying({ kind: "new-dog" });
              }}
            >
              {`Dog (${GUARD_DOG_GOLD.toLocaleString()} Gold)`}
            </button>
          ) : null}
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
    );
  }

  return { buildMode: open, onBuildTap, controls, open: active && herd.length > 0 ? () => setMode("open") : null };
}
