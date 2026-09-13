/**
 * The day boundary shared across StackAcres: land maintenance, the daily
 * Gold grant, and Ante Up's own daily gates all use the same UTC midnight
 * rather than each learning a separate one.
 *
 * THIS FILE USED TO ALSO HOLD A FLAT DAILY CEILING on Gold a player could
 * take out of the farm (`STACKACRES_GOLD_CEILING`, the "X Gold left today"
 * reservation every sale/contract/vat/drone payout went through). Removed
 * 2026-09-12 (Kayo's call): StackAcres has no cap on earning -- the more you
 * play, the more it pays, with no daily bucket to fill. The forage drone lost
 * its own share of that reservation at the same time; its price went up
 * instead (see DRONE_DEPLOY_COST_GOLD in ./drone.ts) so an idle fleet costs
 * more to field rather than being capped once fielded. The `homestead_*`
 * naming below stays for the reason CLAUDE.md gives for `river_*`: they are
 * compatibility ids, not a hint that Bushels are still a thing.
 */

/** The day a moment belongs to, as `YYYY-MM-DD` in UTC. */
export function stackacresExchangeDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Milliseconds until the next UTC day starts. */
export function msUntilNextExchangeDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
