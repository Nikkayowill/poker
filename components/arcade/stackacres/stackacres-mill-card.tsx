"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import { machineItemLabel } from "@/lib/stackacres/machine-items";
import { MACHINE_CATALOGUE, isMachineDone, machineProgress } from "@/lib/stackacres/machines";
import type { MachineView } from "@/lib/stackacres/optimistic-actions";
import { RECIPE_CATALOGUE, batchesAvailable, type RecipeId } from "@/lib/stackacres/recipes";
import { whoBuysLine } from "@/lib/stackacres/town-buyers";

/**
 * The Feed Grinder (the `mill` kind) on its own, for a tap on the windmill: wheat in, flour out, without the whole Workshop sheet.
 * Flour is sold in town (lib/stackacres/town-buyers.ts). The Workshop is one button away for everything else.
 */

const FLOUR: RecipeId = "flour";

function countdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

export function StackAcresMillCard({
  mill,
  inventory,
  isPending,
  onMill,
  onCollect,
  onOpenWorkshop,
  onClose,
}: {
  mill: MachineView;
  inventory: StackAcresInventory;
  isPending: (intent: string) => boolean;
  onMill: (batches: number) => void;
  onCollect: () => void;
  onOpenWorkshop: () => void;
  onClose: () => void;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const def = RECIPE_CATALOGUE[FLOUR];
  const perBatch = def.inputs[0].quantity;
  const wheat = inventoryQuantity(inventory, "wheat");
  const flour = inventoryQuantity(inventory, "flour");
  const batches = batchesAvailable(FLOUR, (item) => inventoryQuantity(inventory, item));
  const nowDate = new Date(now);
  const done = isMachineDone(mill, nowDate);
  const running = mill.status === "working" && !done;
  const progress = machineProgress(mill, nowDate);

  return (
    <div className="sa-store-scrim" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="sa-store-card" role="dialog" aria-modal="true" aria-label={`The ${MACHINE_CATALOGUE.mill.label}`}>
        <header className="sa-store-head">
          <h2>The {MACHINE_CATALOGUE.mill.label}</h2>
          <button ref={closeButtonRef} type="button" className="sa-store-close" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="sa-store-panel">
          <p className="sa-sheet-note">
            {perBatch} Wheat makes 1 Flour, {Math.round(def.processingMs / 1000)}s a batch. You have{" "}
            {machineItemLabel("wheat", wheat)}.
          </p>

          {done && mill.recipeId ? (
            <button type="button" className="sa-cta" disabled={isPending("work")} onClick={onCollect}>
              Collect {machineItemLabel(RECIPE_CATALOGUE[mill.recipeId].output.item, mill.unitsProcessing)}
            </button>
          ) : running && mill.readyAt ? (
            <>
              <p className="sa-stock-yield">Grinding · {countdown(Date.parse(mill.readyAt) - now)}</p>
              <span className="sa-contract-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${progress ?? 0})` }} />
              </span>
            </>
          ) : batches > 0 ? (
            <button type="button" className="sa-cta" disabled={isPending(`process:${FLOUR}`)} onClick={() => onMill(batches)}>
              Grind {machineItemLabel("flour", def.output.quantity * batches)}
            </button>
          ) : (
            <p className="sa-stock-terms">
              Needs {perBatch} Wheat. Grow it on the beds by the house.
            </p>
          )}

          {flour > 0 && (
            <p className="sa-stock-terms">
              You have {machineItemLabel("flour", flour)}. {whoBuysLine("flour")}
            </p>
          )}

          <button type="button" className="sa-cta" onClick={onOpenWorkshop}>
            Open the Workshop
          </button>
        </div>
      </section>
    </div>
  );
}
