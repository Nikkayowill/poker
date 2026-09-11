/**
 * The story events one client action WOULD produce if the server says yes:
 * what stackacres-farm.tsx hands `useStackAcresStory().noteEvent` the
 * instant a request is sent, so an open bubble's counter ticks before the
 * round trip lands. A guess, never authority: the server runs the same
 * reducer inside the action itself, and its view overwrites this on
 * arrival (see the hook's own header).
 *
 * Only the actions whose outcome is knowable from the request are
 * predicted. A fish's species, a secret zone's roll and a Mill's collection
 * are the server's dice, so those return nothing and the counter moves on
 * the response instead.
 */

import { STACKACRES_FEED } from "../catalogue";
import type { Action } from "../farm-actions";
import { isInstantRecipe } from "../recipes";
import type { StackAcresUnitSnapshot } from "../units";
import { stockZone } from "../world";
import type { StoryEvent } from "./events";

export interface StoryPredictContext {
  readonly units: readonly StackAcresUnitSnapshot[];
}

export function storyEventsForAction(body: Action, ctx: StoryPredictContext): StoryEvent[] {
  switch (body.action) {
    case "collect": {
      const named = body.unitIds ? new Set(body.unitIds) : null;
      const counts = new Map<StackAcresUnitSnapshot["stock"], number>();
      for (const unit of ctx.units) {
        if (named ? !named.has(unit.id) : unit.state !== "ready") continue;
        counts.set(unit.stock, (counts.get(unit.stock) ?? 0) + 1);
      }
      return [...counts].map(([stock, count]) => ({ kind: "harvested", stock, count }));
    }
    case "water":
      return [{ kind: "watered", count: body.unitIds && body.unitIds.length > 1 ? body.unitIds.length : 1 }];
    case "feed":
      return [{ kind: "fed", count: 1 }];
    case "feed-pen": {
      const hungry = ctx.units.filter((u) => u.state === "hungry" && stockZone(u.stock) === body.zone).length;
      return hungry > 0 ? [{ kind: "fed", count: hungry }] : [];
    }
    case "buy-feed": {
      const item = STACKACRES_FEED[body.itemId];
      return item ? [{ kind: "feed-bought", servings: item.servings * body.quantity }] : [];
    }
    case "process":
      return isInstantRecipe(body.recipe) ? [{ kind: "processed", recipe: body.recipe, count: 1 }] : [];
    case "clear-sector":
      return [{ kind: "sector-cleared", sector: body.sector }];
    case "place-pipe":
      return [{ kind: "pipe-placed", pipe: body.kind }];
    case "place-soil-tile":
      return [{ kind: "soil-placed", count: 1 }];
    case "fulfill-contract":
      return [{ kind: "contract-fulfilled" }];
    case "forge-enchantment":
      return [{ kind: "enchantment-forged" }];
    default:
      return [];
  }
}
