"use client";

import { useState } from "react";
import { CELLAR_AGING_TIERS, toVatContainer, type VatContainer } from "@/lib/stackacres/aging";
import { ENERGY_MAX, FOOD_ENERGY, FOOD_ITEMS, type FoodItem } from "@/lib/stackacres/energy";
import { MACHINE_CATALOGUE, type MachineKind } from "@/lib/stackacres/machines";
import { machineItemIcon, machineItemLabel, type MachineItemId } from "@/lib/stackacres/machine-items";
import { RECIPE_CATALOGUE, RECIPE_VERB, recipesForMachine, type RecipeId } from "@/lib/stackacres/recipes";
import type { StackAcresInventory } from "@/lib/stackacres/inventory";
import { missingLine, recipeIngredients } from "@/lib/stackacres/recipe-uses";
import { BuildCostLines } from "./build-cost-lines";
import { buildCost, buildShortfall, costSummary } from "@/lib/stackacres/build-cost";
import { seedsOpenedLine } from "@/lib/stackacres/seed-unlocks";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The house kitchen: one section at a time, picked by the house panel's tabs
 * (./stackacres-house.tsx). Cook builds the Oven, the Stew Pot and the
 * Kitchen Counter and makes what they make; Eat turns food into energy. Food
 * is mainly for eating, so it sells for little more than what went in. The
 * Preserves Cellar takes no new jars; its tab shows only while jars sealed
 * before that are still down there. Every button goes through the farm's own
 * `act`, so each one is optimistic like any other farm tap.
 */

export interface KitchenResult {
  ok: boolean;
  message?: string;
  /** Set when opening the cellar paid out. */
  gold?: number;
}

export type KitchenTab = "cook" | "eat" | "cellar";

/** The cooking machines, in the order the kitchen lists them. */
const KITCHEN_MACHINES = ["oven", "stew_pot", "counter"] as const satisfies readonly MachineKind[];

/** What each kitchen machine is for, before it is built. */
const KITCHEN_PITCH: Record<(typeof KITCHEN_MACHINES)[number], string> = {
  oven: "Bakes bread.",
  stew_pot: "Cooks garden stew and tomato sauce.",
  counter: "Makes salad, salsa and jars of pickles.",
};

const DONE_NOTE: Partial<Record<RecipeId, string>> = {
  bread: "Fresh bread!",
  stew: "A hot pot of stew!",
  salad: "A crisp garden salad!",
  sauce: "A pot of tomato sauce!",
  salsa: "Spicy salsa, ready to eat!",
  stuffed_peppers: "Stuffed peppers, hot from the oven!",
  pickles: "A jar of pickles!",
  sauerkraut: "A jar of sauerkraut!",
  bean_casserole: "A bubbling bean casserole!",
  harvest_feast: "A Harvest Feast! Ray would love one of these.",
};

export interface StackAcresKitchenProps {
  tab: KitchenTab;
  energy: number;
  inventory: StackAcresInventory;
  nowMs: number;
  /** Which machines are placed. */
  built: (kind: MachineKind) => boolean;
  /** Null while the profile is unknown; unlimited Gold passes Infinity. */
  goldBalance: number | null;
  busy: (intent: string) => boolean;
  onBuild: (kind: MachineKind) => Promise<KitchenResult>;
  onMake: (recipe: RecipeId) => Promise<KitchenResult>;
  onEat: (item: FoodItem) => Promise<KitchenResult>;
  /** Jars sealed in the Preserves Cellar before it stopped taking new ones. */
  cellar: VatContainer | null;
  onOpenCellar: () => Promise<KitchenResult>;
}

function icon(item: MachineItemId): PainterName {
  return machineItemIcon(item) as PainterName;
}

/** "3h 10m", "42m", "under a minute". */
function waitLabel(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function StackAcresKitchen({
  tab,
  energy,
  inventory,
  nowMs,
  built,
  goldBalance,
  busy,
  onBuild,
  onMake,
  onEat,
  cellar,
  onOpenCellar,
}: StackAcresKitchenProps) {
  const [note, setNote] = useState<string | null>(null);
  const full = energy >= ENERGY_MAX;

  const run = async (call: () => Promise<KitchenResult>, done: string | ((result: KitchenResult) => string)) => {
    setNote(null);
    const result = await call();
    setNote(
      result.ok
        ? typeof done === "string"
          ? done
          : done(result)
        : (result.message ?? "That didn't work. Try again."),
    );
  };

  const buildCard = (kind: MachineKind, pitch: string) => {
    const def = MACHINE_CATALOGUE[kind];
    const opens = seedsOpenedLine(kind);
    // A null balance means "not loaded yet", which the Gold gate below has
    // always treated as affordable rather than blocking the button.
    const cost = buildCost(kind, goldBalance ?? Number.POSITIVE_INFINITY, inventory);
    const short = buildShortfall(cost);
    return (
      <div className="sa-stock-card sa-kitchen-card is-unbuilt" key={kind}>
        <h3>{def.label}</h3>
        <p className="sa-stock-terms">{pitch}</p>
        {opens && <p className="sa-kitchen-opens">{opens}.</p>}
        <BuildCostLines cost={cost} />
        {short && <p className="sa-build-short">{short}</p>}
        <button
          type="button"
          className="sa-cta"
          disabled={busy(`place-machine:${kind}`) || !cost.affordable}
          onClick={() => void run(() => onBuild(kind), `The ${def.label} is ready!`)}
        >
          Build · {costSummary(cost)}
        </button>
      </div>
    );
  };

  return (
    <div className="sa-kitchen">
      {note && <p className="sa-kitchen-note" role="status">{note}</p>}

      {tab === "cook" && <p className="sa-sheet-note">Cook here, then eat when your energy runs low.</p>}
      {tab === "cook" && (
        <div className="sa-kitchen-grid">
          {KITCHEN_MACHINES.map((kind) =>
            built(kind)
              ? recipesForMachine(kind).map((recipe) => (
                  <KitchenRecipe
                    key={recipe}
                    recipe={recipe}
                    inventory={inventory}
                    busy={busy}
                    onMake={() =>
                      void run(
                        () => onMake(recipe),
                        DONE_NOTE[recipe] ?? `Made ${machineItemLabel(RECIPE_CATALOGUE[recipe].output.item, 1)}!`,
                      )
                    }
                  />
                ))
              : buildCard(kind, KITCHEN_PITCH[kind]),
          )}
        </div>
      )}

      {tab === "eat" && (
        <>
          <div className="sa-kitchen-energy" aria-label={`Energy ${energy} of ${ENERGY_MAX}`}>
            <span>
              Energy <strong>{energy}</strong> / {ENERGY_MAX}
              {full ? " (full)" : ""}
            </span>
            <span className="sa-kitchen-energy-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((energy / ENERGY_MAX) * 100)}%` }} />
            </span>
          </div>
          <ul className="sa-kitchen-grid sa-kitchen-food">
            {FOOD_ITEMS.map((item) => {
              const held = inventory[item] ?? 0;
              const gain = Math.min(FOOD_ENERGY[item], ENERGY_MAX - energy);
              return (
                <li key={item} className={held > 0 ? "sa-stock-card sa-kitchen-card" : "sa-stock-card sa-kitchen-card is-empty"}>
                  <h3>
                    <StackAcresIcon name={icon(item)} size={22} />
                    <span>{machineItemLabel(item, held)}</span>
                  </h3>
                  <p className="sa-stock-terms">+{FOOD_ENERGY[item]} energy each</p>
                  <button
                    type="button"
                    className="sa-cta"
                    disabled={busy(`eat:${item}`) || held < 1 || full}
                    onClick={() => void run(() => onEat(item), `Yum! +${gain} energy.`)}
                  >
                    {held < 1 ? "None yet" : full ? "Full" : `Eat · +${gain}`}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "cellar" && (
        <CellarPanel
          cellar={
            cellar?.manifest
              ? toVatContainer({ id: cellar.machineId }, cellar.manifest, new Date(nowMs), CELLAR_AGING_TIERS)
              : cellar
          }
          nowMs={nowMs}
          busy={busy}
          onOpen={() =>
            void run(onOpenCellar, (result) =>
              result.gold !== undefined ? `Sold the aged jars for ${result.gold.toLocaleString()} Gold!` : "Sold!",
            )
          }
        />
      )}
    </div>
  );
}

interface KitchenRecipeProps {
  recipe: RecipeId;
  inventory: StackAcresInventory;
  busy: (intent: string) => boolean;
  onMake: () => void;
}

/** One recipe on a built machine, with what is held and what is still missing. */
function KitchenRecipe({ recipe, inventory, busy, onMake }: KitchenRecipeProps) {
  const ingredients = recipeIngredients(recipe, inventory);
  const ready = ingredients.every((ingredient) => ingredient.missing === 0);
  const def = RECIPE_CATALOGUE[recipe];
  return (
    <div className={ready ? "sa-stock-card sa-kitchen-card is-ready" : "sa-stock-card sa-kitchen-card"}>
      <h3>
        <StackAcresIcon name={icon(def.output.item)} size={22} />
        <span>{def.label}</span>
      </h3>
      <p className="sa-kitchen-where">{MACHINE_CATALOGUE[def.machine].label}</p>
      <ul className="sa-kitchen-ingredients">
        {ingredients.map((ingredient) => {
          const short = missingLine(ingredient);
          return (
            <li key={ingredient.item} className={short ? "is-missing" : "is-ready"}>
              <StackAcresIcon name={icon(ingredient.item)} size={18} />
              <span>
                {Math.min(ingredient.have, ingredient.need)} / {machineItemLabel(ingredient.item, ingredient.need)}
              </span>
              {short && <span className="sa-kitchen-missing">{short}</span>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="sa-cta" disabled={busy(`process:${recipe}`) || !ready} onClick={onMake}>
        {RECIPE_VERB[recipe]} {def.label}
      </button>
    </div>
  );
}

interface CellarPanelProps {
  cellar: VatContainer | null;
  nowMs: number;
  busy: (intent: string) => boolean;
  onOpen: () => void;
}

/** The Preserves Cellar: no new jars, but jars already down there can be opened and sold. */
function CellarPanel({ cellar, nowMs, busy, onOpen }: CellarPanelProps) {
  const title = <h3>{MACHINE_CATALOGUE.cellar.label}</h3>;
  const manifest = cellar?.manifest ?? null;

  if (!cellar || !manifest) {
    return (
      <div className="sa-stock-card sa-kitchen-card sa-kitchen-wide">
        {title}
        <p className="sa-kitchen-cellar-line">The cellar is empty, and it takes no new jars.</p>
      </div>
    );
  }

  const jars = machineItemLabel(manifest.item, manifest.quantity);
  const nextAt = cellar.nextTier ? Date.parse(manifest.sealedAt) + cellar.nextTier.durationMs : null;
  const nextLine =
    cellar.nextTier && nextAt !== null
      ? `${cellar.nextTier.label} in ${waitLabel(Math.max(0, nextAt - nowMs))}.`
      : "As good as it gets.";

  return (
    <div className="sa-stock-card sa-kitchen-card sa-kitchen-wide">
      {title}
      {cellar.status === "aging" ? (
        <p className="sa-kitchen-cellar-line">
          {jars} aging. {nextLine}
        </p>
      ) : (
        <>
          <p className="sa-kitchen-cellar-line">
            {jars}, {cellar.currentTier?.label}. {nextLine} Fully aged, they sell for{" "}
            {cellar.maxGoldValue.toLocaleString()} Gold.
          </p>
          <button type="button" className="sa-cta" disabled={busy("collect-cellar")} onClick={onOpen}>
            Sell the jars · {cellar.collectibleGoldValue.toLocaleString()} Gold
          </button>
        </>
      )}
    </div>
  );
}
