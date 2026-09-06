/**
 * The player intents StackAcres' client sends to `/api/stackacres/actions`,
 * and the two identity helpers keyed off them.
 *
 * Lives in lib/ rather than beside the component so the optimistic-prediction
 * layer (./optimistic-actions.ts) and the component can share one definition
 * of what an action IS -- and so `intentOf` is reachable by vitest, which
 * lib/ is and components/ is not.
 *
 * This is intents only: not every member here is wired to a control today
 * (`work` and `fulfill-contract` come from the automated farmhand, and a few
 * route actions have no UI yet), and the server's own discriminated union in
 * app/api/stackacres/actions/route.ts is the wire authority. `sell` is dead
 * -- the route stopped accepting it -- but kept in the union until the
 * component's last reference to it is gone.
 */

import type { StackAcresStock } from "./catalogue";
import type { StackAcresItem } from "./items";
import type { SectorId } from "./sectors";
import type { HiddenZoneId, SecretItemId } from "./secrets";
import type { SynergyArchetype } from "./synergy-perks";
import type { MidnightMerchantItemId } from "./midnight-merchant";
import type { NpcId } from "./friendship";
import type { MachineItemId } from "./machine-items";

export type Action =
  | { action: "expand-capacity"; stock: StackAcresStock }
  | { action: "clear-sector"; sector: SectorId }
  | { action: "build-greenhouse" }
  | { action: "stock"; stock: StackAcresStock; inGreenhouse?: boolean }
  | { action: "buy-stock"; stock: StackAcresStock }
  | { action: "retire"; unitId: string }
  // No `unitIds` means "bring in everything that is ready" -- what the
  // Harvest key sends. A single id is what tapping one unit sends.
  | { action: "collect"; unitIds?: string[] }
  | { action: "feed"; unitId: string }
  | { action: "water"; unitId: string }
  | { action: "clear"; unitId: string }
  | { action: "buy-feed"; itemId: string }
  | { action: "sell"; item: StackAcresItem; quantity: number }
  | { action: "upgrade-tool" }
  // The idle-worker pass: settles every ripe wheat plot and every mill that
  // has become startable or finished. Moves no Gold; the automated farmhand
  // is what asks for it (see `farmhandHooks`).
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
  // coordinates, not world units -- see soilTileAt. `place-soil-tile` spends
  // SOIL_TILE_PRICE_GOLD; `remove-soil-tile` moves no Gold.
  | { action: "place-soil-tile"; tx: number; ty: number }
  | { action: "remove-soil-tile"; tx: number; ty: number }
  // The Pixel Pilgrim's shrine. Only ever sent from his dialogue's own
  // "yes" -- see StackAcresMonkDialogue -- never from the tap that opens
  // it, so declining never reaches this at all.
  | { action: "pray" }
  // NPC friendship: a gift, from the friendship dialogue's own item picker.
  // See lib/stackacres/friendship.ts's own header.
  | { action: "give-gift"; npc: NpcId; item: MachineItemId };

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
  // Distinguished from an outdoor sow of the same crop: the two are
  // different intents (different slot cap, different growth clock), and
  // treating them as one would let a request in flight for one silently
  // swallow a press aimed at the other.
  if (body.action === "stock") return `stock:${body.stock}${body.inGreenhouse ? ":greenhouse" : ""}`;
  if ("stock" in body) return `${body.action}:${body.stock}`;
  if ("sector" in body) return `${body.action}:${body.sector}`;
  // Checked before the generic "item" branch below: a gift carries `item`
  // but no `quantity` (it is always exactly one unit), and gifting one NPC
  // must never be conflated with gifting another over the same item.
  if ("npc" in body) return `${body.action}:${body.npc}:${body.item}`;
  if ("item" in body) return `${body.action}:${body.item}:${body.quantity}`;
  if ("itemId" in body) return `${body.action}:${body.itemId}`;
  if ("archetype" in body) return `${body.action}:${body.archetype}`;
  if ("tx" in body) return `${body.action}:${body.tx},${body.ty}`;
  return body.action;
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
