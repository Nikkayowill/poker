/**
 * The player intents StackAcres' client sends to `/api/stackacres/actions`,
 * and the two identity helpers keyed off them.
 *
 * Lives in lib/ rather than beside the component so the optimistic-prediction
 * layer (./optimistic-actions.ts) and the component can share one definition
 * of what an action IS -- and so `intentOf` is reachable by vitest, which
 * lib/ is and components/ is not.
 *
 * This is intents only: the server's own discriminated union in
 * app/api/stackacres/actions/route.ts is the wire authority.
 */

import { isLivestock, STACKACRES_CATALOGUE, type StackAcresCrop, type StackAcresStock } from "./catalogue";
import type { StackAcresBuyableCutter } from "./cutters";
import type { SectorId } from "./sectors";
import type { HiddenZoneId, SecretItemId } from "./secrets";
import type { SynergyArchetype } from "./synergy-perks";
import type { MidnightMerchantItemId } from "./midnight-merchant";
import type { NpcId } from "./friendship";
import type { MachineItemId } from "./machine-items";
import type { MachineKind } from "./machines";
import type { RecipeId } from "./recipes";
import type { SoilTier } from "./soil-tiers";
import type { BlueprintId } from "./blueprints";
import type { PipeFacing, PipeKind } from "./irrigation";
import type { ZoneId } from "./zones";
import type { TravelerId } from "./story/travelers";

export type Action =
  | { action: "expand-capacity"; stock: StackAcresStock }
  | { action: "clear-sector"; sector: SectorId }
  | { action: "unlock-crop-fields" }
  | { action: "build-greenhouse" }
  // `tx`/`ty` name the bed `onRadialSeed` tapped, when the tap named a real
  // bed -- see `predictStackAcresAction`'s "stock" case in
  // optimistic-actions.ts for why the optimistic guess needs them too, not
  // just the server.
  | { action: "stock"; stock: StackAcresStock; inGreenhouse?: boolean; tx?: number; ty?: number }
  | { action: "buy-stock"; stock: StackAcresStock }
  | { action: "retire"; unitId: string }
  // No `unitIds` means "bring in everything that is ready" -- what the
  // Harvest key sends. A single id is what tapping one unit sends.
  | { action: "collect"; unitIds?: string[] }
  | { action: "feed"; unitId: string }
  // Feeds the hungry animals in one pen, a serving each, as far as the feed
  // goes. What dropping the feed scoop on a trough sends.
  | { action: "feed-pen"; zone: ZoneId }
  // unitId is always the tapped crop -- kept as the intent key so a re-press
  // mid-flight still dedupes to the same gesture. unitIds is set only when
  // the drop landed on a >=2x2 block of thirsty crops (the water can's own
  // drag gesture, see stackacres-farm.tsx's `onWorldUnitTap`), naming the
  // whole block to water in one request; absent it, this waters unitId alone.
  | { action: "water"; unitId: string; unitIds?: string[] }
  // Fills the watering can at the well.
  | { action: "draw-water" }
  // The dock's cast, completed: which fish it lands is the server's own
  // dice roll, same posture as `collect`'s Gold.
  | { action: "catch-fish" }
  | { action: "clear"; unitId: string }
  | { action: "buy-feed"; itemId: string; quantity: number }
  // Sells any inventory item -- raw harvest or crafted good -- for Gold, at
  // that item's own sell price, any time. The baseline income path now that
  // harvest always credits inventory instead of Gold.
  | { action: "sell"; item: MachineItemId; quantity: number }
  | { action: "upgrade-tool" }
  | { action: "buy-cutter"; cutter: StackAcresBuyableCutter }
  // The processing track, all from the Workshop sheet (WorkshopModal.tsx).
  // `sow-wheat` and `place-machine` spend Gold; the rest move inventory only.
  | { action: "sow-wheat" }
  | { action: "place-machine"; kind: MachineKind }
  // One batch. Instant for a Dairy or a Loom; a Mill enqueues and `work`
  // collects it.
  | { action: "process"; recipe: RecipeId }
  | { action: "seal-vat" }
  | { action: "collect-vat" }
  // The idle-worker pass: settles every ripe wheat plot and every mill that
  // has become startable or finished. Moves no Gold. The Workshop sheet
  // fires it when something is due and on its own "work the farm" key.
  | { action: "work" }
  // Asks the town to post an order. Moves nothing either. `fulfill-contract`
  // below is the one that pays, and it reserves against the same flat daily
  // ceiling a harvest does. See lib/server/stackacres-service.ts's header.
  | { action: "request-contract" }
  | { action: "fulfill-contract" }
  | { action: "tap-secret-zone"; zoneId: HiddenZoneId }
  | { action: "donate-secret-item"; itemId: SecretItemId }
  | { action: "consume-secret-item"; itemId: SecretItemId }
  | { action: "trade-secret-item"; itemId: SecretItemId }
  // The Synergy Tree. `unlock-synergy-perk` spends Gold, once, permanent;
  // `activate-synergy-perk` moves no Gold, only the loadout.
  | { action: "unlock-synergy-perk"; archetype: SynergyArchetype }
  | { action: "activate-synergy-perk"; archetype: SynergyArchetype; slot: number }
  | { action: "midnight-merchant-buy"; itemId: MidnightMerchantItemId }
  // Placeable soil beds (./soil.ts). `tx`/`ty` are SOIL_TILE lattice
  // coordinates, not world units -- see soilTileAt. Gold moves at the shop
  // (`buy-soil`, priced from SOIL_TIER_DEFS server-side) and nowhere else:
  // `place-soil-tile` spends a BAG of the named tier, and `remove-soil-tile`
  // spends nothing and refunds nothing.
  | { action: "place-soil-tile"; tx: number; ty: number; tier?: SoilTier }
  | { action: "buy-soil"; tier: SoilTier; quantity: number }
  | { action: "remove-soil-tile"; tx: number; ty: number }
  // Hold-tap lift, tap-to-drop: slides the contiguous group of beds touching
  // `(tx, ty)` so that tile lands on `(toTx, toTy)`, whatever crop stands on
  // it carried along. Free -- moves no Gold either way. The group itself is
  // never named by the client; the server (and the optimistic guess) derive
  // it fresh from `(tx, ty)` via `soilTileGroup`, see stackacres-service.ts.
  | { action: "move-soil-tile-group"; tx: number; ty: number; toTx: number; toTy: number }
  // Ray's seed shelf (./catalogue.ts's SeedStock). Buys seeds of one crop for
  // Gold, ahead of planting -- `stock` above spends one off the shelf
  // instead of charging Gold directly once the crop it names is a crop
  // rather than livestock. See stockStackAcres's own header.
  | { action: "buy-seed"; crop: StackAcresCrop; quantity: number }
  // The Pixel Pilgrim's shrine. Only ever sent from his dialogue's own
  // "yes" -- see StackAcresMonkDialogue -- never from the tap that opens
  // it, so declining never reaches this at all.
  | { action: "pray" }
  // NPC friendship: a gift, from the friendship dialogue's own item picker.
  // See lib/stackacres/friendship.ts's own header.
  | { action: "give-gift"; npc: NpcId; item: MachineItemId }
  // The travelers' story (./story/). Both move no Gold: `story-meet` accepts
  // a traveler's first quest, `story-turn-in` hands the active one in --
  // debiting only the items it asked for, and paying a story keepsake,
  // never a purse. Only ever sent from a bubble's own committing button.
  | { action: "story-meet"; traveler: TravelerId }
  | { action: "story-turn-in"; traveler: TravelerId }
  // The Mechanical Forage Drone. `deploy-drone` spends the flat hangar fee,
  // once per drone; `collect-drone-forage` pays whatever the server rolled
  // for that one claim -- there is no fake patch for it in
  // ./optimistic-actions.ts (a dice roll this app won't fake, same posture
  // a harvest's own secret-find roll takes), only the scene's own
  // local-optimistic vacuum animation. See lib/stackacres/drone.ts.
  | { action: "deploy-drone" }
  | { action: "collect-drone-forage"; droneId: string }
  // The Prestige Reset Valve. `confirm: true` is required rather than
  // inferred from the action name alone -- see the route's own comment on
  // this action for why an irreversible sweep with no row to version-guard
  // wants a payload shape a stray retry cannot satisfy by accident.
  | { action: "prestige-reset"; confirm: true }
  // The Sunlight Forge: a permanent tool enchantment, catalogue id (not the
  // versioned wrapper). See lib/stackacres/forge.ts.
  | { action: "forge-enchantment"; itemId: string }
  // The Crossbreeding Bed (./crossbreeding.ts). `plant-crossbreed` pays the
  // way `stock` does -- a seed off the shelf for a crop, Gold for livestock;
  // `harvest-crossbreed` moves no Gold, a hybrid is inventory not a payout.
  | { action: "plant-crossbreed"; row: number; col: number; stock: StackAcresStock }
  | { action: "harvest-crossbreed"; plotId: string }
  // The irrigation pipe network. `tx`/`ty` are STACKACRES_TILE lattice
  // coordinates (floor(worldX / PIPE_TILE)), not world units -- see
  // lib/stackacres/irrigation.ts's `pipeTileAt`. `place-pipe` spends Gold
  // (PIPE_PLACE_COST); `remove-pipe` moves none.
  | { action: "place-pipe"; tx: number; ty: number; kind: PipeKind }
  | { action: "remove-pipe"; tx: number; ty: number }
  // Points a lone pipe tile one way (lib/stackacres/irrigation.ts's
  // `PipeFacing`). Cosmetic, moves no Gold, and keyed on the tile by the
  // `tx` branch of `intentOf` the same way place/remove are.
  | { action: "aim-pipe"; tx: number; ty: number; facing: PipeFacing }
  // Ray's Mythic Blueprints. Neither moves Gold -- a stage is filled from
  // the processing inventory, same as a Town Contract. See
  // lib/server/stackacres-blueprint-service.ts's own header.
  | { action: "start-blueprint"; structureId: BlueprintId }
  | { action: "contribute-blueprint"; structureId: BlueprintId; itemId: MachineItemId; amount: number };

/**
 * What the player asked for, as one string. Two presses that mean the same
 * thing share it; collecting two different hens does not.
 *
 * This is the identity both duplicate guards are keyed on -- the in-flight set
 * that drops a second press, and the idempotency key held across a request
 * whose answer never arrived.
 */
export function intentOf(body: Action): string {
  if ("unitId" in body) return `${body.action}:${body.unitId}`;
  // One bed cell, not one stock kind: two presses planting hens in two
  // different cells are two intents, and the generic "stock" branch below
  // would collapse them onto one. Checked before it for that reason.
  if (body.action === "plant-crossbreed") return `${body.action}:${body.row},${body.col}`;
  if ("plotId" in body) return `${body.action}:${body.plotId}`;
  // Distinguished from an outdoor sow of the same crop: the two are
  // different intents (different slot cap, different growth clock), and
  // treating them as one would let a request in flight for one silently
  // swallow a press aimed at the other.
  if (body.action === "stock") return `stock:${body.stock}${body.inGreenhouse ? ":greenhouse" : ""}`;
  if ("stock" in body) return `${body.action}:${body.stock}`;
  // A seed purchase for one crop must never dedupe against or block a
  // purchase of a different crop -- checked before the generic fallback,
  // which would otherwise collapse every crop's buy onto one shared
  // "buy-seed" intent the way soil's own tier-blind intent already does
  // (a gap that is fine at 3 soil tiers and would not be at 22 crops).
  if ("crop" in body) return `${body.action}:${body.crop}`;
  if ("sector" in body) return `${body.action}:${body.sector}`;
  // Checked before the generic "item" branch below: a gift carries `item`
  // but no `quantity` (it is always exactly one unit), and gifting one NPC
  // must never be conflated with gifting another over the same item.
  if ("npc" in body) return `${body.action}:${body.npc}:${body.item}`;
  if ("item" in body) return `${body.action}:${body.item}:${body.quantity}`;
  // A contribution to one blueprint must never dedupe against or block a
  // contribution to a different one -- checked before the generic `itemId`
  // fallback below, which would otherwise collapse every structure's
  // delivery of the same material onto one shared intent. `start-blueprint`
  // carries no `itemId`, so it falls into this branch on `structureId` alone.
  if ("structureId" in body) {
    return "itemId" in body ? `${body.action}:${body.structureId}:${body.itemId}` : `${body.action}:${body.structureId}`;
  }
  if ("itemId" in body) return `${body.action}:${body.itemId}`;
  // A forage claim on one drone must never dedupe against or block a claim
  // on a different drone -- checked before the generic fallback below,
  // which would otherwise collapse every drone's claim onto one shared
  // "collect-drone-forage" intent.
  if ("droneId" in body) return `${body.action}:${body.droneId}`;
  if ("archetype" in body) return `${body.action}:${body.archetype}`;
  // Feeding one pen must never block feeding another.
  if ("zone" in body) return `${body.action}:${body.zone}`;
  if ("tx" in body) return `${body.action}:${body.tx},${body.ty}`;
  // Making cheese must never dedupe against or block weaving cloth, and
  // building a Mill must never block building a Dairy. `place-pipe` carries
  // `kind` too but is caught by the `tx` branch above, so this only ever
  // sees `place-machine`.
  if ("recipe" in body) return `${body.action}:${body.recipe}`;
  if ("kind" in body) return `${body.action}:${body.kind}`;
  return body.action;
}

/**
 * The instant toast a spend should show, or null for an action that either
 * moves no Gold/shelf stock or already gets its own call-site toast.
 *
 * Kayo (2026-09-11): shop purchases "don't feel responsive" -- `buySound()`
 * plays on every one of these already (see lib/audio/stackacres-sfx.ts, wired
 * at every call site), but a muted phone or a quiet room has nothing else to
 * go on until the round trip lands, so a purchase can read as having done
 * nothing. This is the visual half `act()` (stackacres-farm.tsx) fires
 * alongside the optimistic patch, through the same `sa-toast` `lastCollect`
 * mechanism every other instant confirmation on this screen already uses.
 *
 * Deliberately excludes `place-soil-tile`/`remove-soil-tile`/
 * `move-soil-tile-group`/`place-pipe`/`remove-pipe`: those five already set
 * their own `lastCollect` toast at the call site, a beat before `act()` runs,
 * and firing a second, generic one here would silently overwrite it in the
 * same render (both are plain `setState` calls in one synchronous stack).
 * Also excludes anything that moves no Gold or shelf stock (`collect`,
 * `feed`, `water`, `retire`, the Workshop/Town Contract actions, ...) --
 * those already read as answered through their own sound, sprite change, or
 * (for `collect`) the "on its way" toast `act` sets independently.
 */
export function purchaseCueText(body: Action): string | null {
  switch (body.action) {
    case "stock":
      return isLivestock(body.stock)
        ? `Bought a ${STACKACRES_CATALOGUE[body.stock].label}!`
        : `Seeded ${STACKACRES_CATALOGUE[body.stock].label}!`;
    case "buy-stock":
      return `Bought a ${STACKACRES_CATALOGUE[body.stock].label}!`;
    case "expand-capacity":
      return "Capacity expanded!";
    case "buy-feed":
      return "Feed delivered!";
    case "buy-soil":
      return "Soil delivered!";
    case "buy-seed":
      return "Seeds delivered!";
    case "upgrade-tool":
      return "Spade upgraded!";
    case "buy-cutter":
      return "New tool in hand!";
    case "unlock-synergy-perk":
      return "Perk unlocked!";
    case "midnight-merchant-buy":
      return "Bought!";
    case "clear-sector":
      return "Clearing the land…";
    case "unlock-crop-fields":
      return "Crop Fields unlocked!";
    case "build-greenhouse":
      return "Greenhouse begun!";
    case "forge-enchantment":
      return "Enchantment forged!";
    case "deploy-drone":
      return "Drone deployed!";
    default:
      return null;
  }
}

/**
 * A fresh idempotency key.
 *
 * `crypto.randomUUID` is only defined in a secure context, which the deployed
 * site always is and a phone pointed at a dev box over the LAN is not -- and a
 * throw here would silently swallow the action rather than perform it. The
 * fallback does not have to be a UUID, only unlikely to collide with this same
 * player's other keys inside the server's own ten-minute window.
 */
export function newIntentKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
