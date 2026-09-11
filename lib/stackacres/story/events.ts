/**
 * What the story engine listens for. Every event here is a fact the SERVER
 * already establishes while running an existing action; nothing in this
 * union is reported by the browser. The client only replays the same
 * events locally so a counter can tick before the round trip lands.
 *
 *   harvested            <- collect (a crop unit; livestock reports too)
 *   watered              <- water
 *   fed                  <- feed, feed-pen
 *   feed-bought          <- buy-feed (servings, not sacks)
 *   processed            <- process, work
 *   fish-caught          <- catch-fish
 *   secret-zone-tapped   <- tap-secret-zone
 *   sector-cleared       <- clear-sector
 *   pipe-placed          <- place-pipe
 *   soil-placed          <- place-soil-tile
 *   contract-fulfilled   <- fulfill-contract
 *   enchantment-forged   <- forge-enchantment
 *   crossbreed-harvested <- harvest-crossbreed
 *
 * `deliver` objectives are not events. They read the inventory at turn-in.
 */

import type { StackAcresStock } from "../catalogue";
import type { CrossbreedItem } from "../crossbreed-items";
import type { FishSpecies } from "../fishing";
import type { PipeKind } from "../irrigation";
import type { RecipeId } from "../recipes";
import type { HiddenZoneId } from "../secrets";
import type { SectorId } from "../sectors";

export type StoryEvent =
  | { readonly kind: "harvested"; readonly stock: StackAcresStock; readonly count: number }
  | { readonly kind: "watered"; readonly count: number }
  | { readonly kind: "fed"; readonly count: number }
  | { readonly kind: "feed-bought"; readonly servings: number }
  | { readonly kind: "processed"; readonly recipe: RecipeId; readonly count: number }
  | { readonly kind: "fish-caught"; readonly species: FishSpecies }
  | { readonly kind: "secret-zone-tapped"; readonly zoneId: HiddenZoneId }
  | { readonly kind: "sector-cleared"; readonly sector: SectorId }
  | { readonly kind: "pipe-placed"; readonly pipe: PipeKind }
  | { readonly kind: "soil-placed"; readonly count: number }
  | { readonly kind: "contract-fulfilled" }
  | { readonly kind: "enchantment-forged" }
  | { readonly kind: "crossbreed-harvested"; readonly item: CrossbreedItem };

export type StoryEventKind = StoryEvent["kind"];
