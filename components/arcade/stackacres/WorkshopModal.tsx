"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Cog, Coins, Lock } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { VAT_INPUT_ITEM, VAT_INPUT_QUANTITY, type VatContainer } from "@/lib/stackacres/aging";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import {
  machineItemIcon,
  machineItemLabel,
  machineItemSellPrice,
  type MachineItemId,
  type MachineProcessedItem,
} from "@/lib/stackacres/machine-items";
import {
  MACHINE_CATALOGUE,
  MACHINE_KINDS,
  isMachineDone,
  machineProgress,
  type MachineKind,
} from "@/lib/stackacres/machines";
import type { MachineView } from "@/lib/stackacres/optimistic-actions";
import { RECIPE_CATALOGUE, isInstantRecipe, recipesForMachine, type RecipeId } from "@/lib/stackacres/recipes";
import { STACKACRES_WORKSHOP_SHELF_ITEMS, isActiveMachine } from "@/lib/stackacres/scope";
import {
  WHEAT_PLOT_CAP,
  WHEAT_SEED_COST,
  WHEAT_YIELD_QUANTITY,
  isWheatPlotReady,
  wheatPlotProgress,
  type StackAcresWheatPlotSnapshot,
} from "@/lib/stackacres/wheat-plot";
import { machineOfKind, workDue } from "@/lib/stackacres/workshop";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The Workshop: the processing track in one sheet. The wheat field, the four
 * machines, the shelf everything sits on between steps, and the animals whose
 * produce could go here instead of to the harvest's Gold.
 *
 * Every one of these actions has existed on the server since the Mill
 * shipped; this is the first control that can reach any of them. It is a
 * sheet rather than in-world placement on purpose: a machine row has no
 * position (see lib/stackacres/machines.ts, "a machine is a place a recipe
 * can run, and nothing more"), there is no machine art yet, and the town
 * board next door already established that a thing with nowhere on the map
 * to stand opens as a sheet from the signpost.
 *
 * THE IDLE-WORKER PASS. `work` is what brings ripe wheat in and collects a
 * finished Mill run, and nothing on the farm was ever asking for it. This
 * sheet does, in two ways: a key the player can press, and an effect below
 * that fires it once the moment something falls due while the sheet is open
 * -- with a back-off, so a phone clock a second ahead of the server cannot
 * turn "still ripe by my clock" into a request every tick.
 *
 * Optimistic: `sow-wheat`, `place-machine`, `process` and `sell`'s inventory
 * half are all predicted in lib/stackacres/optimistic-actions.ts and rolled
 * back by the farm on a refusal, so a press answers before the round trip.
 * `sell`'s Gold and `work` both wait for the real answer -- a Mill's double
 * output and the Prestige multiplier are both dice/state this sheet cannot
 * honestly guess.
 *
 * Pointer containment: every handler is wrapped in `contain`, same as every
 * other StackAcres sheet. See TownContractsModal's header for why.
 */

export type WorkshopActionResult =
  | {
      readonly ok: true;
      readonly work?: { readonly wheatCollected: number; readonly machinesStarted: number; readonly machinesCollected: number };
      readonly processed?: {
        readonly recipe: RecipeId;
        readonly produced: { readonly item: MachineProcessedItem; readonly quantity: number } | null;
        readonly readyAt: string | null;
      };
      readonly sold?: { readonly item: MachineItemId; readonly quantity: number; readonly gold: number };
    }
  | { readonly ok: false; readonly message: string };

export interface WorkshopModalProps {
  /** The shelf, straight off the last server response (or the optimistic
   *  layer's guess at it, which the farm rolls back on a refusal). */
  inventory: StackAcresInventory;
  wheatPlots: readonly StackAcresWheatPlotSnapshot[];
  machines: readonly MachineView[];
  /** Null until a Fermenting Vat is placed. */
  vat: VatContainer | null;
  goldBalance: number;
  unlimitedGold: boolean;
  /** Whether a given intent is mid-flight -- the farm's own per-intent
   *  pending set, so one key greys on its own action only. */
  isPending: (intent: string) => boolean;
  onSowWheat: () => Promise<WorkshopActionResult>;
  onPlaceMachine: (kind: MachineKind) => Promise<WorkshopActionResult>;
  onProcess: (recipe: RecipeId) => Promise<WorkshopActionResult>;
  onWork: () => Promise<WorkshopActionResult>;
  /** Sells everything currently held of `item` -- the shelf's own "Sell all"
   *  button, one tap per item rather than a quantity stepper. */
  onSell: (item: MachineItemId, quantity: number) => Promise<WorkshopActionResult>;
  /** Opens the vat's own sheet on top of this one. */
  onOpenVat: () => void;
  onClose: () => void;
}

type Note = { readonly tone: "paid" | "refused" | "pending"; readonly text: string };

/** How long after one automatic `work` this sheet waits before it will fire
 *  another on its own. A manual press is never held back by this. */
const AUTO_WORK_BACKOFF_MS = 20 * 1000;

function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function icon(item: MachineItemId): PainterName {
  return machineItemIcon(item) as PainterName;
}

/** What the button says while making one batch of `recipe`. */
const RECIPE_VERB: Record<RecipeId, string> = {
  flour: "Mill",
  cheese: "Make",
  cloth: "Weave",
  cake: "Bake",
};

/** "3 Wheat → 1 Flour · 20s" / "2 Eggs + 1 Milk + 1 Flour → 1 Cake · instant". */
function recipeLine(recipe: RecipeId): string {
  const def = RECIPE_CATALOGUE[recipe];
  const pace = isInstantRecipe(recipe) ? "instant" : `${Math.round(def.processingMs / 1000)}s`;
  const inputs = def.inputs.map((input) => machineItemLabel(input.item, input.quantity)).join(" + ");
  return `${inputs} → ${machineItemLabel(def.output.item, def.output.quantity)} · ${pace}`;
}

function workNote(work: NonNullable<Extract<WorkshopActionResult, { ok: true }>["work"]>): string | null {
  const parts: string[] = [];
  if (work.wheatCollected > 0) {
    parts.push(`brought in ${machineItemLabel("wheat", work.wheatCollected * WHEAT_YIELD_QUANTITY)}`);
  }
  if (work.machinesCollected > 0) parts.push(`collected the Mill`);
  if (work.machinesStarted > 0) parts.push(`started the Mill`);
  if (parts.length === 0) return null;
  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

export function WorkshopModal({
  inventory,
  wheatPlots,
  machines,
  vat,
  goldBalance,
  unlimitedGold,
  isPending,
  onSowWheat,
  onPlaceMachine,
  onProcess,
  onWork,
  onSell,
  onOpenVat,
  onClose,
}: WorkshopModalProps) {
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState<Note | null>(null);
  // Loom/Vat stay off the shelf by default (Pig/wool is out of active scope,
  // and nothing in scope makes the Cheese a Vat ages) -- see
  // lib/stackacres/scope.ts's own header. Already-built machines never hide,
  // whatever their kind: a player who placed one keeps seeing its state.
  const [showMoreMachines, setShowMoreMachines] = useState(false);
  const visibleMachineKinds = MACHINE_KINDS.filter(
    (kind) => showMoreMachines || isActiveMachine(kind) || machineOfKind(machines, kind) !== null,
  );
  const hiddenMachineKindCount = MACHINE_KINDS.length - visibleMachineKinds.length;

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll);

  // Ticks once a second only while there is a clock to draw -- a growing
  // plot, a Mill run, or an aging vat -- same guard the vat's own sheet takes.
  const anythingTimed =
    wheatPlots.length > 0 || machines.some((machine) => machine.status === "working") || vat?.status === "aging";
  useEffect(() => {
    if (!anythingTimed) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anythingTimed]);

  const nowDate = new Date(now);
  const due = workDue(wheatPlots, machines, now);
  const ripeCount = wheatPlots.filter((plot) => isWheatPlotReady(plot, nowDate)).length;
  const affords = (cost: number) => unlimitedGold || goldBalance >= cost;

  /** Runs one of the handed-down promises and answers in this sheet's own
   *  note -- the page's banner sits behind the scrim. */
  const run = useCallback(
    async (request: () => Promise<WorkshopActionResult>, said: (result: Extract<WorkshopActionResult, { ok: true }>) => string | null) => {
      try {
        const result = await request();
        if (!result.ok) {
          setNote({ tone: "refused", text: result.message });
          return;
        }
        const text = said(result);
        setNote(text ? { tone: "paid", text } : null);
      } catch {
        setNote({ tone: "refused", text: "That did not go through." });
      }
    },
    [],
  );

  const handleSow = useCallback(
    () => run(onSowWheat, () => `Sown. Wheat takes a while; the field brings it in for you.`),
    [run, onSowWheat],
  );
  const handlePlace = useCallback(
    (kind: MachineKind) => run(() => onPlaceMachine(kind), () => `${MACHINE_CATALOGUE[kind].label} built.`),
    [run, onPlaceMachine],
  );
  const handleProcess = useCallback(
    (recipe: RecipeId) =>
      run(
        () => onProcess(recipe),
        (result) => {
          const produced = result.processed?.produced;
          if (produced) return `Made ${machineItemLabel(produced.item, produced.quantity)}.`;
          return `${RECIPE_CATALOGUE[recipe].label} is on. Come back for it.`;
        },
      ),
    [run, onProcess],
  );
  const handleWork = useCallback(
    () => run(onWork, (result) => (result.work ? workNote(result.work) ?? "Nothing was ready yet." : null)),
    [run, onWork],
  );
  const handleSell = useCallback(
    (item: MachineItemId, quantity: number) =>
      run(
        () => onSell(item, quantity),
        (result) =>
          result.sold ? `Sold ${machineItemLabel(result.sold.item, result.sold.quantity)} for ${result.sold.gold.toLocaleString()} Gold.` : null,
      ),
    [run, onSell],
  );

  // The automatic pass: once, the moment something falls due, and then not
  // again for AUTO_WORK_BACKOFF_MS however the clocks disagree. The farm's
  // own in-flight set already drops a press that lands while one is out.
  const lastAutoWork = useRef(0);
  useEffect(() => {
    if (!due) return;
    if (now - lastAutoWork.current < AUTO_WORK_BACKOFF_MS) return;
    lastAutoWork.current = now;
    void handleWork();
  }, [due, now, handleWork]);

  return (
    <div
      className="sa-sheet-scrim"
      role="presentation"
      onMouseDown={contain(onBackdropMouseDown)}
      onPointerDown={contain()}
      onPointerUp={contain()}
      onPointerMove={contain()}
      onTouchStart={contain()}
      onTouchMove={contain()}
      onClick={contain()}
      onWheel={contain()}
    >
      <section
        className="sa-sheet sa-workshop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-workshop-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Cog size={13} aria-hidden="true" /> Processing
            </p>
            <h2 id="sa-workshop-title">The Workshop</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="sa-sheet-close" onClick={contain(closeAll)}>
            Done
          </button>
        </header>

        <p className="sa-sheet-note">
          Everything you gather lands here. Sell it as it is, or make it into something worth
          more first. The Mill turns Wheat into Flour, and the Dairy bakes Eggs, Milk and Flour
          into a Cake.
        </p>

        {note && (
          <p className={clsx("sa-contracts-note", `is-${note.tone}`)} role={note.tone === "refused" ? "alert" : "status"}>
            {note.text}
          </p>
        )}

        <p className="sa-group-label">On the shelf</p>
        <ul className="sa-workshop-shelf">
          {STACKACRES_WORKSHOP_SHELF_ITEMS.map((item) => {
            const quantity = inventoryQuantity(inventory, item);
            const sellIntent = `sell:${item}:${quantity}`;
            return (
              <li key={item}>
                <StackAcresIcon name={icon(item)} size={20} />
                <span>{machineItemLabel(item, quantity)}</span>
                {quantity > 0 && (
                  <button
                    type="button"
                    className="sa-cta sa-workshop-sell"
                    disabled={isPending(sellIntent)}
                    onClick={contain(() => void handleSell(item, quantity))}
                  >
                    Sell · {(machineItemSellPrice(item) * quantity).toLocaleString()} Gold
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <p className="sa-group-label">Wheat field</p>
        <ul className="sa-workshop-plots">
          {wheatPlots.map((plot) => {
            const ripe = isWheatPlotReady(plot, nowDate);
            const progress = wheatPlotProgress(plot, nowDate);
            return (
              <li key={plot.id} className={clsx("sa-workshop-plot", { "is-ripe": ripe })}>
                <StackAcresIcon name="ico-wheat" size={22} />
                <span className="sa-contract-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${progress})` }} />
                </span>
                <span className="sa-contract-count">
                  {ripe ? <strong>Ripe</strong> : formatCountdown(Date.parse(plot.readyAt) - now)}
                </span>
              </li>
            );
          })}
          {Array.from({ length: Math.max(0, WHEAT_PLOT_CAP - wheatPlots.length) }).map((_, i) => (
            <li key={`empty-${i}`} className="sa-workshop-plot is-empty">
              Empty bed
            </li>
          ))}
        </ul>
        <div className="sa-workshop-actions">
          <button
            type="button"
            className="sa-cta"
            disabled={isPending("sow-wheat") || wheatPlots.length >= WHEAT_PLOT_CAP || !affords(WHEAT_SEED_COST)}
            onClick={contain(() => void handleSow())}
          >
            {wheatPlots.length >= WHEAT_PLOT_CAP
              ? "Field is full"
              : affords(WHEAT_SEED_COST)
                ? `Sow wheat · ${WHEAT_SEED_COST} Gold`
                : `Wheat seed costs ${WHEAT_SEED_COST} Gold`}
          </button>
          {ripeCount > 0 && (
            <button type="button" className="sa-cta" disabled={isPending("work")} onClick={contain(() => void handleWork())}>
              Bring in {ripeCount === 1 ? "the ripe wheat" : `${ripeCount} ripe beds`}
            </button>
          )}
        </div>

        <p className="sa-group-label">Machines</p>
        <div className="sa-stock-cards sa-workshop-machines">
          {visibleMachineKinds.map((kind) => {
            const def = MACHINE_CATALOGUE[kind];
            const machine = machineOfKind(machines, kind);
            const recipes = recipesForMachine(kind);
            const placeIntent = `place-machine:${kind}`;

            if (!machine) {
              return (
                <article key={kind} className="sa-stock-card sa-workshop-machine is-unbuilt">
                  <h3>{def.label}</h3>
                  {kind === "vat" ? (
                    <p className="sa-stock-terms">
                      Seal {machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)}, let it age, open it for Gold
                    </p>
                  ) : recipes.length > 0 ? (
                    recipes.map((recipe) => (
                      <p className="sa-stock-terms" key={recipe}>
                        {recipeLine(recipe)}
                      </p>
                    ))
                  ) : (
                    <p className="sa-stock-terms">Not built yet</p>
                  )}
                  <button
                    type="button"
                    className="sa-cta"
                    disabled={isPending(placeIntent) || !affords(def.placeCost)}
                    onClick={contain(() => void handlePlace(kind))}
                  >
                    {affords(def.placeCost) ? (
                      <>
                        Build · {def.placeCost.toLocaleString()} Gold
                      </>
                    ) : (
                      <>
                        <Lock size={14} aria-hidden="true" /> {def.placeCost.toLocaleString()} Gold
                      </>
                    )}
                  </button>
                </article>
              );
            }

            if (kind === "vat") {
              const status =
                !vat || vat.status === "empty"
                  ? "Empty"
                  : vat.status === "aging"
                    ? vat.nextTier && vat.msUntilNextTier !== null
                      ? `Aging · ${formatCountdown(Math.max(0, Date.parse(vat.manifest!.sealedAt) + vat.nextTier.durationMs - now))} until ${vat.nextTier.label}`
                      : "Aging"
                    : `${vat.currentTier?.label ?? "Aged"} · ${vat.collectibleGoldValue.toLocaleString()} Gold`;
              return (
                <article
                  key={kind}
                  className={clsx("sa-stock-card sa-workshop-machine", {
                    "is-working": vat?.status === "aging",
                    "is-done": vat?.status === "collectible",
                  })}
                >
                  <h3>{def.label}</h3>
                  <p className="sa-stock-terms">{status}</p>
                  <p className="sa-stock-yield">
                    <span>Holds </span>
                    {machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)}
                    <span> on the shelf: </span>
                    {inventoryQuantity(inventory, VAT_INPUT_ITEM).toLocaleString()}
                  </p>
                  <button type="button" className="sa-cta" onClick={contain(onOpenVat)}>
                    {vat?.status === "collectible" ? (
                      <>
                        <Coins size={16} aria-hidden="true" /> Open the vat
                      </>
                    ) : (
                      "Open the vat"
                    )}
                  </button>
                </article>
              );
            }

            const done = isMachineDone(machine, nowDate);
            const progress = machineProgress(machine, nowDate);
            const running = machine.status === "working" && !done;
            return (
              <article
                key={kind}
                className={clsx("sa-stock-card sa-workshop-machine", { "is-working": running, "is-done": done })}
              >
                <h3>{def.label}</h3>
                {recipes.length > 0 ? (
                  recipes.map((recipe) => (
                    <p className="sa-stock-terms" key={recipe}>
                      {recipeLine(recipe)}
                    </p>
                  ))
                ) : (
                  <p className="sa-stock-terms">Idle</p>
                )}
                {done && machine.recipeId && (
                  <p className="sa-stock-yield">
                    {machineItemLabel(RECIPE_CATALOGUE[machine.recipeId].output.item, machine.unitsProcessing)}
                    <span> ready</span>
                  </p>
                )}
                {running && machine.readyAt && (
                  <>
                    <p className="sa-stock-yield">
                      <span>Running · </span>
                      {formatCountdown(Date.parse(machine.readyAt) - now)}
                    </p>
                    <span className="sa-contract-bar" aria-hidden="true">
                      <span style={{ transform: `scaleX(${progress ?? 0})` }} />
                    </span>
                  </>
                )}
                {done ? (
                  <button type="button" className="sa-cta" disabled={isPending("work")} onClick={contain(() => void handleWork())}>
                    Collect
                  </button>
                ) : running ? (
                  <button type="button" className="sa-cta" disabled>
                    Running
                  </button>
                ) : (
                  // One button per recipe this machine kind runs -- the
                  // Dairy has two (Cheese, Cake), everything else has one.
                  recipes.map((recipe) => {
                    const recipeDef = RECIPE_CATALOGUE[recipe];
                    const enough = recipeDef.inputs.every(
                      (input) => inventoryQuantity(inventory, input.item) >= input.quantity,
                    );
                    const inputsLabel = recipeDef.inputs
                      .map((input) => machineItemLabel(input.item, input.quantity))
                      .join(" + ");
                    return (
                      <button
                        key={recipe}
                        type="button"
                        className="sa-cta"
                        disabled={isPending(`process:${recipe}`) || !enough}
                        onClick={contain(() => void handleProcess(recipe))}
                      >
                        {enough
                          ? `${RECIPE_VERB[recipe]} ${inputsLabel}`
                          : `Needs ${inputsLabel}`}
                      </button>
                    );
                  })
                )}
              </article>
            );
          })}
        </div>
        {hiddenMachineKindCount > 0 && (
          <button
            type="button"
            className="sa-cta sa-workshop-more"
            onClick={contain(() => setShowMoreMachines(true))}
          >
            More machines ({hiddenMachineKindCount})
          </button>
        )}
      </section>
    </div>
  );
}
