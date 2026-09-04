/**
 * Town Influence: the progression counter a fulfilled Contract feeds.
 *
 * Deliberately thin. It is a running total, uncapped, never spent anywhere
 * -- so unlike Gold it carries none of the daily-ceiling risk and needs no
 * reservation dance. `lib/server/stackacres-store.ts` moves it through a
 * plain additive RPC (`adjust_homestead_influence`), the same shape
 * `adjustStackAcresCapacity` already uses for a number nothing ever refunds.
 *
 * What Influence eventually unlocks is out of scope for the first Contract
 * pass -- this module exists so the number has somewhere honest to live
 * before that design happens, not to pre-empt it.
 */

export function influenceLabel(total: number): string {
  return total.toLocaleString();
}
