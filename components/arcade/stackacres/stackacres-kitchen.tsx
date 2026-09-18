"use client";

import { useState } from "react";
import { CELLAR_CAPACITY, CELLAR_ITEMS, type CellarItem, type VatContainer } from "@/lib/stackacres/aging";
import { ENERGY_MAX, FOOD_ENERGY, FOOD_ITEMS, type FoodItem } from "@/lib/stackacres/energy";
import { MACHINE_CATALOGUE, type MachineKind } from "@/lib/stackacres/machines";
import { machineItemIcon, machineItemLabel, machineItemNoun, type MachineItemId } from "@/lib/stackacres/machine-items";
import { RECIPE_CATALOGUE, RECIPE_VERB, recipesForMachine, type RecipeId } from "@/lib/stackacres/recipes";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import { missingLine, recipeIngredients } from "@/lib/stackacres/recipe-uses";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * Ray's kitchen: the Kitchen tab of the dialogue his house opens. Build the
 * Oven, the Stew Pot and the Kitchen Counter, cook what they make, eat for
 * energy, and age jars in the Preserves Cellar. Every button goes through
 * the farm's own `act`, so each one is optimistic like any other farm tap.
 */

export interface KitchenResult {
  ok: boolean;
  message?: string;
  /** Set when opening the cellar paid out. */
  gold?: number;
}

/** The cooking machines, in the order the kitchen lists them. */
const KITCHEN_MACHINES = ["oven", "stew_pot", "counter"] as const satisfies readonly MachineKind[];

/** What each kitchen machine is for, before it is built. */
const KITCHEN_PITCH: Record<(typeof KITCHEN_MACHINES)[number], string> = {
  oven: "Build an Oven to bake bread.",
  stew_pot: "Build a Stew Pot to cook garden stew and tomato sauce.",
  counter: "Build a Kitchen Counter for salad, salsa and jars of pickles.",
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
};

export interface StackAcresKitchenProps {
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
  cellar: VatContainer | null;
  onStoreJars: (item: CellarItem) => Promise<KitchenResult>;
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
  onStoreJars,
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

  const buildRow = (kind: MachineKind, pitch: string) => {
    const def = MACHINE_CATALOGUE[kind];
    return (
      <div className="sa-kitchen-row" key={kind}>
        <span>{pitch}</span>
        <button
          type="button"
          className="sa-cta"
          disabled={busy(`place-machine:${kind}`) || (goldBalance !== null && goldBalance < def.placeCost)}
          onClick={() => void run(() => onBuild(kind), `The ${def.label} is ready!`)}
        >
          Build {def.label} · {def.placeCost.toLocaleString()} Gold
        </button>
      </div>
    );
  };

  return (
    <div className="sa-kitchen">
      <p className="sa-kitchen-energy">
        Energy <strong>{energy}</strong> / {ENERGY_MAX}
        {full ? " (full)" : ""}
      </p>

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
          : buildRow(kind, KITCHEN_PITCH[kind]),
      )}

      {built("cellar") ? (
        <CellarPanel
          cellar={cellar}
          inventory={inventory}
          nowMs={nowMs}
          busy={busy}
          onStore={(item) =>
            void run(() => onStoreJars(item), `Stored in the cellar. They'll be worth more the longer they sit.`)
          }
          onOpen={() =>
            void run(onOpenCellar, (result) =>
              result.gold !== undefined ? `Sold the aged jars for ${result.gold.toLocaleString()} Gold!` : "Sold!",
            )
          }
        />
      ) : (
        buildRow("cellar", "Build a Preserves Cellar to age pickles and sauerkraut for more Gold.")
      )}

      <ul className="sa-kitchen-food">
        {FOOD_ITEMS.map((item) => {
          const held = inventory[item] ?? 0;
          return (
            <li key={item} className="sa-kitchen-row">
              <StackAcresIcon name={icon(item)} size={20} />
              <span>{machineItemLabel(item, held)}</span>
              <button
                type="button"
                className="sa-cta"
                disabled={busy(`eat:${item}`) || held < 1 || full}
                onClick={() => void run(() => onEat(item), `Yum! +${FOOD_ENERGY[item]} energy.`)}
              >
                Eat · +{FOOD_ENERGY[item]}
              </button>
            </li>
          );
        })}
      </ul>

      {note && <p className="sa-kitchen-note" role="status">{note}</p>}
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
    <div className="sa-kitchen-recipe">
      <p className="sa-kitchen-recipe-title">
        {def.label} <span className="sa-kitchen-where">· {MACHINE_CATALOGUE[def.machine].label}</span>
      </p>
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
  inventory: StackAcresInventory;
  nowMs: number;
  busy: (intent: string) => boolean;
  onStore: (item: CellarItem) => void;
  onOpen: () => void;
}

/** The Preserves Cellar: store jars, wait, sell them for more. */
function CellarPanel({ cellar, inventory, nowMs, busy, onStore, onOpen }: CellarPanelProps) {
  const title = <p className="sa-kitchen-recipe-title">{MACHINE_CATALOGUE.cellar.label}</p>;
  const manifest = cellar?.manifest ?? null;

  if (!cellar || !manifest) {
    return (
      <div className="sa-kitchen-recipe">
        {title}
        <p className="sa-kitchen-cellar-line">
          Store up to {CELLAR_CAPACITY} jars. The longer they sit, the more they sell for.
        </p>
        {CELLAR_ITEMS.map((item) => {
          const count = Math.min(CELLAR_CAPACITY, inventoryQuantity(inventory, item));
          return (
            <button
              key={item}
              type="button"
              className="sa-cta"
              disabled={busy("seal-cellar") || count < 1}
              onClick={() => onStore(item)}
            >
              {count < 1 ? `No ${machineItemNoun(item, 2)} yet` : `Store ${machineItemLabel(item, count)}`}
            </button>
          );
        })}
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
    <div className="sa-kitchen-recipe">
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
