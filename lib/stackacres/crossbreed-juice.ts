/**
 * Crossbreed flash: configuration and pure math for the one moment a
 * Crossbreeding Bed answers a tap with a hybrid instead of a plain harvest.
 *
 * PHASER-FREE ON PURPOSE, same discipline ./juice.ts states at its own top --
 * the only caller, components/arcade/stackacres/game-juice-manager.ts, plays
 * these numbers back through Phaser and decides none of them itself.
 *
 * "A UNIQUE VISUAL PARTICLE FLASH", read literally: rather than one fixed
 * palette for every hybrid, the burst is drawn from the TWO parent stocks'
 * own ./juice.ts shard styles (`juiceStyleFor`) -- a Sprout x Cash Crop cross
 * throws carrot-orange and corn-gold together, a Hen x Pig cross throws
 * chalk-white from both sides at different speeds. Every one of
 * ./crossbreeding.ts's six pairings therefore reads as visually distinct
 * without this file needing its own six-entry palette to keep in sync with
 * that matrix by hand.
 */

import { juiceStyleFor, type JuiceShardStyle } from "./juice";
import type { StackAcresStock } from "./catalogue";
import type { CrossbreedItem } from "./crossbreed-items";
import { CROSSBREED_ITEM_CATALOGUE } from "./crossbreed-items";

/** One parent stock's own shard style, richer than a plain harvest pop --
 *  a cross is rarer than any single collection, and the burst should read
 *  that way. Scaling factors, not new numbers: every underlying speed/
 *  gravity/lifetime is still exactly ./juice.ts's own per-stock physics, so
 *  a crop's shard still falls like that crop's shard always has. */
const CROSSBREED_SHARD_COUNT_SCALE = 1.6;
const CROSSBREED_SHARD_RADIUS_SCALE = 1.15;

function scaledParentStyle(stock: StackAcresStock): JuiceShardStyle {
  const base = juiceStyleFor(stock);
  return {
    ...base,
    shardCount: Math.round(base.shardCount * CROSSBREED_SHARD_COUNT_SCALE),
    shardRadius: base.shardRadius * CROSSBREED_SHARD_RADIUS_SCALE,
  };
}

export interface CrossbreedFlashStyle {
  /** One richer shard burst per parent -- fired from the SAME point, an
   *  instant apart, so the two colours read as one event crossing rather
   *  than two separate pops. */
  parentA: JuiceShardStyle;
  parentB: JuiceShardStyle;
  /** How long after the first burst the second one fires, ms. Not
   *  simultaneous: a dead-even double burst reads as noise, a short beat
   *  between them reads as "one thing, then the other, met in the middle". */
  secondBurstDelayMs: number;
}

export function crossbreedFlashStyleFor(a: StackAcresStock, b: StackAcresStock): CrossbreedFlashStyle {
  return {
    parentA: scaledParentStyle(a),
    parentB: scaledParentStyle(b),
    secondBurstDelayMs: 90,
  };
}

/** "CROSS! Golden Maize" -- named after the crit flash's own "CRIT! x1.75"
 *  convention (./juice.ts's `critFlashLabel`), the same all-caps exclaim
 *  read, naming the exact hybrid produced rather than a generic "Mutation!"
 *  a player would have to look up. */
export function crossbreedFlashLabel(hybrid: CrossbreedItem): string {
  return `CROSS! ${CROSSBREED_ITEM_CATALOGUE[hybrid].label}`;
}

export const CROSSBREED_FLASH_TEXT_LIFT = 52;
export const CROSSBREED_FLASH_TEXT_DURATION_MS = 640;
