"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Cog, Coins, Lock } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { ContractPayout } from "./contract-payout";
import { BuildCostLines } from "./build-cost-lines";
import { buildCost, buildShortfall, costSummary } from "@/lib/stackacres/build-cost";
import { VAT_INPUT_ITEM, VAT_INPUT_QUANTITY, type VatContainer } from "@/lib/stackacres/aging";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import {
  machineItemIcon,
  machineItemLabel,
  machineItemNoun,
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
import { seedsOpenedLine } from "@/lib/stackacres/seed-unlocks";
import { RECIPE_CATALOGUE, RECIPE_VERB, isInstantRecipe, recipesForMachine, type RecipeId } from "@/lib/stackacres/recipes";
import { FEED_SILO_DAILY_FEEDS } from "@/lib/stackacres/feed-silo";
import { STACKACRES_WORKSHOP_SHELF_ITEMS, isActiveMachine } from "@/lib/stackacres/scope";
import { WHEAT_YIELD_QUANTITY } from "@/lib/stackacres/wheat-plot";
import { machineOfKind, workDue } from "@/lib/stackacres/workshop";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The Workshop: the processing track in one sheet. The machines, and the
 * shelf everything sits on between steps. Wheat is NOT planted here: it is a
 * crop, sown on the soil beds like any other, and only lands on this shelf
 * once harvested.
 *
 * Every one of these actions has existed on the server since the Mill
 * shipped; this is the first control that can reach any of them. It is a
 * sheet rather than in-world placement on purpose: a machine row has no
 * position (see lib/stackacres/machines.ts, "a machine is a place a recipe
 * can run, and nothing more"), there is no machine art yet, and the town
 * board next door already established that a thing with nowhere on the map
 * to stand opens as a sheet from the signpost.
 *
 * THE IDLE-WORKER PASS. `work` collects a finished Mill run, and nothing on
 * the farm was asking for it. This sheet does, in two ways: a key the player
 * can press, and an effect below that fires it once the moment a run falls
 * due while the sheet is open -- with a back-off, so a phone clock a second
 * ahead of the server cannot turn "still done by my clock" into a request
 * every tick.
 *
 * Optimistic: `place-machine`, `process` and `sell`'s inventory
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
      readonly work?: {
        readonly wheatCollected: number;
        readonly machinesStarted: number;
        readonly machinesCollected: number;
        readonly siloServings: number;
        readonly kitchenCooked?: { readonly item: MachineItemId; readonly quantity: number } | null;
      };
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
  machines: readonly MachineView[];
  /** Null until a Fermenting Vat is placed. */
  vat: VatContainer | null;
  goldBalance: number;
  unlimitedGold: boolean;
  /** Whether a given intent is mid-flight -- the farm's own per-intent
   *  pending set, so one key greys on its own action only. */
  isPending: (intent: string) => boolean;
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

/** What the Feed Silo does, in one line. */
const SILO_LINE = "Feeds hungry animals from your barn while you're away";

/** One plain sentence per machine: what it does and why it is worth building. */
const MACHINE_JOB: Partial<Record<MachineKind, string>> = {
  mill: "Grinds Wheat from your beds into Flour, which sells for more and goes into Cakes. Also grinds Corn into Cattle Feed.",
  dairy: "Turns Milk into Cheese, or Eggs, Milk and Flour into a Cake. Both sell for more than the raw goods.",
  loom: "Weaves Wool into Cloth.",
  vat: `Seal ${machineItemLabel(VAT_INPUT_ITEM, VAT_INPUT_QUANTITY)} inside and let it age. The longer it sits, the more Gold it is worth.`,
  feed_silo: SILO_LINE,
};

/** Where an ingredient comes from, for a player who is short of it. */
const ITEM_SOURCE: Partial<Record<MachineItemId, string>> = {
  wheat: "your beds (Wheat seed is at Ray's)",
  flour: "the Mill",
  milk: "your cows",
  eggs: "your hens",
  wool: "your sheep",
  cheese: "the Dairy",
};

function shortfalls(recipe: RecipeId, inventory: StackAcresInventory) {
  return RECIPE_CATALOGUE[recipe].inputs
    .map((input) => ({ item: input.item, short: input.quantity - inventoryQuantity(inventory, input.item) }))
    .filter((entry) => entry.short > 0);
}

/** "3 Wheat (you have 1) -> 1 Flour, takes 20s". The have-count is what tells
 *  a player why the button below is grey and what to go and get. */
function RecipeLine({ recipe, inventory }: { recipe: RecipeId; inventory: StackAcresInventory }) {
  const def = RECIPE_CATALOGUE[recipe];
  const pace = isInstantRecipe(recipe) ? "instant" : `takes ${Math.round(def.processingMs / 1000)}s`;
  return (
    <p className="sa-workshop-recipe">
      <span className="sa-workshop-recipe-in">
        {def.inputs.map((input, index) => {
          const have = inventoryQuantity(inventory, input.item);
          return (
            <span key={input.item} className={clsx("sa-workshop-recipe-item", { "is-short": have < input.quantity })}>
              {index > 0 && " + "}
              {machineItemLabel(input.item, input.quantity)}
              <em> (have {have})</em>
            </span>
          );
        })}
      </span>
      <span className="sa-workshop-recipe-out">
        <span className="sa-workshop-recipe-arrow" aria-hidden="true">
          →{" "}
        </span>
        {machineItemLabel(def.output.item, def.output.quantity)}
        <em> · {pace}</em>
      </span>
    </p>
  );
}

function workNote(work: NonNullable<Extract<WorkshopActionResult, { ok: true }>["work"]>): string | null {
  const parts: string[] = [];
  if (work.wheatCollected > 0) {
    parts.push(`brought in ${machineItemLabel("wheat", work.wheatCollected * WHEAT_YIELD_QUANTITY)}`);
  }
  if (work.machinesCollected > 0) parts.push(`collected the Mill`);
  if (work.machinesStarted > 0) parts.push(`started the Mill`);
  if (work.siloServings > 0) parts.push(`the Feed Silo fed ${work.siloServings} time${work.siloServings === 1 ? "" : "s"}`);
  if (work.kitchenCooked) {
    parts.push(`the Farm Kitchen made ${machineItemLabel(work.kitchenCooked.item, work.kitchenCooked.quantity)}`);
  }
  if (parts.length === 0) return null;
  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

export function WorkshopModal({
  inventory,
  machines,
  vat,
  goldBalance,
  unlimitedGold,
  isPending,
  onPlaceMachine,
  onProcess,
  onWork,
  onSell,
  onOpenVat,
  onClose,
}: WorkshopModalProps) {
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState<Note | null>(null);
  /** The same bouncy Gold burst a Town Contract pays out with (see
   *  ContractPayout's own header) -- a sale is settled from a sheet the same
   *  way a contract is, so it gets the same "come to where the press was"
   *  answer rather than a plain toast standing in for it. Keyed on the item
   *  AND a nonce, so selling the same item twice in a row is a fresh burst
   *  rather than a live one asked to replay. */
  const [sellPayout, setSellPayout] = useState<{ item: MachineItemId; gold: number; nonce: number } | null>(
    null,
  );
  // Loom/Vat stay off the shelf by default (Pig/wool is out of active scope,
  // and nothing in scope makes the Cheese a Vat ages) -- see
  // lib/stackacres/scope.ts's own header. Already-built machines never hide,
  // whatever their kind: a player who placed one keeps seeing its state.
  const [showMoreMachines, setShowMoreMachines] = useState(false);
  // The kitchen machines live in the player's house, not here (stackacres-house.tsx).
  const workshopKinds = MACHINE_KINDS.filter(
    (kind) => kind !== "oven" && kind !== "stew_pot" && kind !== "counter" && kind !== "cellar" && kind !== "farm_kitchen",
  );
  const visibleMachineKinds = workshopKinds.filter(
    (kind) => showMoreMachines || isActiveMachine(kind) || machineOfKind(machines, kind) !== null,
  );
  const hiddenMachineKindCount = workshopKinds.length - visibleMachineKinds.length;

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll);

  // Ticks once a second only while there is a clock to draw -- a Mill run, or an aging vat -- same guard the vat's own sheet takes.
  const anythingTimed = machines.some((machine) => machine.status === "working") || vat?.status === "aging";
  useEffect(() => {
    if (!anythingTimed) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anythingTimed]);

  const nowDate = new Date(now);
  const due = workDue(machines, now);
  const affords = (cost: number) => unlimitedGold || goldBalance >= cost;
  // Only what the player holds, plus the row that just sold out so its Gold
  // burst has somewhere to play.
  const shelfItems = STACKACRES_WORKSHOP_SHELF_ITEMS.filter(
    (item) => inventoryQuantity(inventory, item) > 0 || sellPayout?.item === item,
  );
  useEffect(() => {
    if (!sellPayout) return;
    const id = window.setTimeout(() => setSellPayout(null), 1800);
    return () => window.clearTimeout(id);
  }, [sellPayout]);

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
        (result) => {
          if (!result.sold) return null;
          setSellPayout({ item: result.sold.item, gold: result.sold.gold, nonce: Date.now() });
          return `Sold ${machineItemLabel(result.sold.item, result.sold.quantity)} for ${result.sold.gold.toLocaleString()} Gold.`;
        },
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
          Turn what your farm grows into things that sell for more. Anything you leave as it is can
          be sold from the shelf.
        </p>

        {note && (
          <p className={clsx("sa-contracts-note", `is-${note.tone}`)} role={note.tone === "refused" ? "alert" : "status"}>
            {note.text}
          </p>
        )}

        <div className="sa-workshop-body">
          <div className="sa-workshop-col">
            <p className="sa-group-label">Your goods</p>
            {shelfItems.length === 0 ? (
              <p className="sa-workshop-empty">
                Nothing yet. Wheat from your beds, and Eggs and Milk from your animals, show up here.
              </p>
            ) : (
              <ul className="sa-workshop-shelf">
                {shelfItems.map((item) => {
                  const quantity = inventoryQuantity(inventory, item);
                  const sellIntent = `sell:${item}:${quantity}`;
                  return (
                    <li key={item}>
                      {sellPayout?.item === item && (
                        <ContractPayout key={sellPayout.nonce} gold={sellPayout.gold} influence={0} />
                      )}
                      <StackAcresIcon name={icon(item)} size={20} />
                      <span className="sa-workshop-shelf-name">{machineItemLabel(item, quantity)}</span>
                      {quantity > 0 && (
                        <button
                          type="button"
                          className="sa-cta sa-workshop-sell"
                          disabled={isPending(sellIntent)}
                          onClick={contain(() => void handleSell(item, quantity))}
                        >
                          Sell {(machineItemSellPrice(item) * quantity).toLocaleString()} Gold
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

          </div>

          <div className="sa-workshop-col">
            <p className="sa-group-label">Machines</p>
            <div className="sa-stock-cards sa-workshop-machines">
              {visibleMachineKinds.map((kind) => {
                const def = MACHINE_CATALOGUE[kind];
                const machine = machineOfKind(machines, kind);
                const recipes = recipesForMachine(kind);
                const placeIntent = `place-machine:${kind}`;
                const job = MACHINE_JOB[kind];

                if (!machine) {
                  const cost = buildCost(kind, unlimitedGold ? Number.POSITIVE_INFINITY : goldBalance, inventory);
                  const short = buildShortfall(cost);
                  return (
                    <article key={kind} className="sa-stock-card sa-workshop-machine is-unbuilt">
                      <h3>{def.label}</h3>
                      {job && <p className="sa-workshop-job">{job}</p>}
                      {kind !== "vat" && kind !== "feed_silo" &&
                        recipes.map((recipe) => <RecipeLine key={recipe} recipe={recipe} inventory={inventory} />)}
                      {seedsOpenedLine(kind) && <p className="sa-stock-wanted">{seedsOpenedLine(kind)}</p>}
                      <BuildCostLines cost={cost} />
                      {short && <p className="sa-build-short">{short}</p>}
                      <button
                        type="button"
                        className="sa-cta"
                        disabled={isPending(placeIntent) || !cost.affordable}
                        onClick={contain(() => void handlePlace(kind))}
                      >
                        {cost.affordable ? (
                          <>Build · {costSummary(cost)}</>
                        ) : (
                          <>
                            <Lock size={14} aria-hidden="true" /> {costSummary(cost)} to build
                          </>
                        )}
                      </button>
                    </article>
                  );
                }

                if (kind === "feed_silo") {
                  const left = machine.autoFeedsLeft ?? FEED_SILO_DAILY_FEEDS;
                  return (
                    <article key={kind} className="sa-stock-card sa-workshop-machine">
                      <h3>{def.label}</h3>
                      <p className="sa-workshop-job">{SILO_LINE}</p>
                      <p className="sa-stock-yield">
                        {left} of {FEED_SILO_DAILY_FEEDS} auto-feeds left today
                      </p>
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
                      {job && <p className="sa-workshop-job">{job}</p>}
                      <p className="sa-stock-yield">{status}</p>
                      <p className="sa-stock-terms">
                        You have {inventoryQuantity(inventory, VAT_INPUT_ITEM).toLocaleString()}{" "}
                        {machineItemNoun(VAT_INPUT_ITEM, inventoryQuantity(inventory, VAT_INPUT_ITEM))}
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
                    {job && <p className="sa-workshop-job">{job}</p>}
                    {!done && !running && recipes.length === 0 && <p className="sa-stock-terms">Idle</p>}
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
                      // One recipe block per thing this machine makes -- the
                      // Dairy has two (Cheese, Cake), everything else has one.
                      recipes.map((recipe) => {
                        const missing = shortfalls(recipe, inventory);
                        const output = RECIPE_CATALOGUE[recipe].output;
                        const sources = [
                          ...new Set(missing.map((entry) => ITEM_SOURCE[entry.item]).filter((v): v is string => !!v)),
                        ];
                        return (
                          <div key={recipe} className="sa-workshop-recipe-block">
                            <RecipeLine recipe={recipe} inventory={inventory} />
                            <button
                              type="button"
                              className="sa-cta"
                              disabled={isPending(`process:${recipe}`) || missing.length > 0}
                              onClick={contain(() => void handleProcess(recipe))}
                            >
                              {missing.length === 0
                                ? `${RECIPE_VERB[recipe]} ${machineItemLabel(output.item, output.quantity)}`
                                : `Need ${missing
                                    .map((entry) => `${entry.short} more ${machineItemNoun(entry.item, entry.short)}`)
                                    .join(" + ")}`}
                            </button>
                            {sources.length > 0 && (
                              <p className="sa-workshop-source">Get it from {sources.join(" and ")}.</p>
                            )}
                          </div>
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
          </div>
        </div>
      </section>
    </div>
  );
}
