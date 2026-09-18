"use client";

import { useState } from "react";
import { ENERGY_MAX, FOOD_ENERGY, FOOD_ITEMS, type FoodItem } from "@/lib/stackacres/energy";
import { MACHINE_CATALOGUE } from "@/lib/stackacres/machines";
import { machineItemIcon, machineItemLabel, type MachineItemId } from "@/lib/stackacres/machine-items";
import { RECIPE_CATALOGUE } from "@/lib/stackacres/recipes";
import type { StackAcresInventory } from "@/lib/stackacres/inventory";
import { missingLine, recipeIngredients } from "@/lib/stackacres/recipe-uses";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * Ray's kitchen: the Kitchen tab of the dialogue his house opens. Build the
 * Oven, bake Flour into Bread, build the Stew Pot, cook garden crops into
 * Stew, and eat for energy. Every button goes through
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
  onEat: (item: FoodItem) => Promise<KitchenResult>;
}

const OVEN_COST = MACHINE_CATALOGUE.oven.placeCost;
const BREAD_FLOUR = RECIPE_CATALOGUE.bread.inputs[0].quantity;
const STEW_POT_COST = MACHINE_CATALOGUE.stew_pot.placeCost;

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
  onEat,
}: StackAcresKitchenProps) {
  const [note, setNote] = useState<string | null>(null);
  const flour = inventory.flour ?? 0;
  const full = energy >= ENERGY_MAX;
  const stewIngredients = recipeIngredients("stew", inventory);
  const canCookStew = stewIngredients.every((ingredient) => ingredient.missing === 0);

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

      {!stewPotBuilt ? (
        <div className="sa-kitchen-row">
          <span>Build a Stew Pot to cook garden stew.</span>
          <button
            type="button"
            className="sa-cta"
            disabled={busy("place-machine:stew_pot") || (goldBalance !== null && goldBalance < STEW_POT_COST)}
            onClick={() => void run(onBuildStewPot, "The Stew Pot is ready!")}
          >
            Build Stew Pot · {STEW_POT_COST.toLocaleString()} Gold
          </button>
        </div>
      ) : (
        <div className="sa-kitchen-recipe">
          <p className="sa-kitchen-recipe-title">{RECIPE_CATALOGUE.stew.label}</p>
          <ul className="sa-kitchen-ingredients">
            {stewIngredients.map((ingredient) => {
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
            disabled={busy("process:stew") || !canCookStew}
            onClick={() => void run(onCookStew, "A hot pot of stew!")}
          >
            Cook Stew
          </button>
        </div>
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
