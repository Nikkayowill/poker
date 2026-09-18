"use client";

import { useState } from "react";
import { ENERGY_MAX, FOOD_ENERGY, FOOD_ITEMS, type FoodItem } from "@/lib/stackacres/energy";
import { MACHINE_CATALOGUE, type MachineKind } from "@/lib/stackacres/machines";
import { machineItemIcon, machineItemLabel, type MachineItemId } from "@/lib/stackacres/machine-items";
import { RECIPE_CATALOGUE, type RecipeId } from "@/lib/stackacres/recipes";
import type { StackAcresInventory } from "@/lib/stackacres/inventory";
import { missingLine, recipeIngredients } from "@/lib/stackacres/recipe-uses";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * Ray's kitchen: the Kitchen tab of the dialogue his house opens. Build the
 * Oven, bake Flour into Bread, build the Stew Pot and the Kitchen Counter,
 * cook garden crops into Stew and Salad, and eat for energy. Every button goes through
 * the farm's own `act`, so each one is optimistic like any other farm tap.
 */

export interface KitchenResult {
  ok: boolean;
  message?: string;
}

export interface StackAcresKitchenProps {
  energy: number;
  inventory: StackAcresInventory;
  ovenBuilt: boolean;
  stewPotBuilt: boolean;
  /** Null while the profile is unknown; unlimited Gold passes Infinity. */
  goldBalance: number | null;
  busy: (intent: string) => boolean;
  onBuildOven: () => Promise<KitchenResult>;
  onBake: () => Promise<KitchenResult>;
  onBuildStewPot: () => Promise<KitchenResult>;
  onCookStew: () => Promise<KitchenResult>;
  counterBuilt: boolean;
  onBuildCounter: () => Promise<KitchenResult>;
  onTossSalad: () => Promise<KitchenResult>;
  onEat: (item: FoodItem) => Promise<KitchenResult>;
}

const OVEN_COST = MACHINE_CATALOGUE.oven.placeCost;
const BREAD_FLOUR = RECIPE_CATALOGUE.bread.inputs[0].quantity;

function icon(item: MachineItemId): PainterName {
  return machineItemIcon(item) as PainterName;
}

export function StackAcresKitchen({
  energy,
  inventory,
  ovenBuilt,
  stewPotBuilt,
  goldBalance,
  busy,
  onBuildOven,
  onBake,
  onBuildStewPot,
  onCookStew,
  counterBuilt,
  onBuildCounter,
  onTossSalad,
  onEat,
}: StackAcresKitchenProps) {
  const [note, setNote] = useState<string | null>(null);
  const flour = inventory.flour ?? 0;
  const full = energy >= ENERGY_MAX;

  const run = async (call: () => Promise<KitchenResult>, done: string) => {
    setNote(null);
    const result = await call();
    setNote(result.ok ? done : (result.message ?? "That didn't work. Try again."));
  };

  return (
    <div className="sa-kitchen">
      <p className="sa-kitchen-energy">
        Energy <strong>{energy}</strong> / {ENERGY_MAX}
        {full ? " (full)" : ""}
      </p>

      {!ovenBuilt ? (
        <div className="sa-kitchen-row">
          <span>Build an Oven to bake bread.</span>
          <button
            type="button"
            className="sa-cta"
            disabled={busy("place-machine:oven") || (goldBalance !== null && goldBalance < OVEN_COST)}
            onClick={() => void run(onBuildOven, "The Oven is ready!")}
          >
            Build Oven · {OVEN_COST.toLocaleString()} Gold
          </button>
        </div>
      ) : (
        <div className="sa-kitchen-row">
          <StackAcresIcon name={icon("flour")} size={20} />
          <span>
            {machineItemLabel("flour", flour)} on hand. {BREAD_FLOUR} Flour bakes 1 Bread.
          </span>
          <button
            type="button"
            className="sa-cta"
            disabled={busy("process:bread") || flour < BREAD_FLOUR}
            onClick={() => void run(onBake, "Fresh bread!")}
          >
            Bake Bread
          </button>
        </div>
      )}

      <KitchenRecipe
        kind="stew_pot"
        recipe="stew"
        built={stewPotBuilt}
        pitch="Build a Stew Pot to cook garden stew."
        builtNote="The Stew Pot is ready!"
        verb="Cook Stew"
        doneNote="A hot pot of stew!"
        inventory={inventory}
        goldBalance={goldBalance}
        busy={busy}
        run={run}
        onBuild={onBuildStewPot}
        onMake={onCookStew}
      />

      <KitchenRecipe
        kind="counter"
        recipe="salad"
        built={counterBuilt}
        pitch="Build a Kitchen Counter to toss fresh salad."
        builtNote="The Kitchen Counter is ready!"
        verb="Toss Salad"
        doneNote="A crisp garden salad!"
        inventory={inventory}
        goldBalance={goldBalance}
        busy={busy}
        run={run}
        onBuild={onBuildCounter}
        onMake={onTossSalad}
      />

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
  kind: MachineKind;
  recipe: RecipeId;
  built: boolean;
  pitch: string;
  builtNote: string;
  verb: string;
  doneNote: string;
  inventory: StackAcresInventory;
  goldBalance: number | null;
  busy: (intent: string) => boolean;
  run: (call: () => Promise<KitchenResult>, done: string) => Promise<void>;
  onBuild: () => Promise<KitchenResult>;
  onMake: () => Promise<KitchenResult>;
}

/** One kitchen machine: a build button until it is placed, then its recipe
 *  with what is held and what is still missing. */
function KitchenRecipe({
  kind,
  recipe,
  built,
  pitch,
  builtNote,
  verb,
  doneNote,
  inventory,
  goldBalance,
  busy,
  run,
  onBuild,
  onMake,
}: KitchenRecipeProps) {
  const def = MACHINE_CATALOGUE[kind];
  if (!built) {
    return (
      <div className="sa-kitchen-row">
        <span>{pitch}</span>
        <button
          type="button"
          className="sa-cta"
          disabled={busy(`place-machine:${kind}`) || (goldBalance !== null && goldBalance < def.placeCost)}
          onClick={() => void run(onBuild, builtNote)}
        >
          Build {def.label} · {def.placeCost.toLocaleString()} Gold
        </button>
      </div>
    );
  }
  const ingredients = recipeIngredients(recipe, inventory);
  const ready = ingredients.every((ingredient) => ingredient.missing === 0);
  return (
    <div className="sa-kitchen-recipe">
      <p className="sa-kitchen-recipe-title">{RECIPE_CATALOGUE[recipe].label}</p>
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
      <button
        type="button"
        className="sa-cta"
        disabled={busy(`process:${recipe}`) || !ready}
        onClick={() => void run(onMake, doneNote)}
      >
        {verb}
      </button>
    </div>
  );
}
