/**
 * What a finished Ante Up attempt actually did to the player's balance.
 *
 * A win never pays back less than the stake (lib/arcade/win-never-loses.test.ts
 * pins that for every game), so a payout above zero is always at least the
 * wager. The helper still works from payout minus wager rather than trusting
 * that, so a table that ever slipped under 1x would show the real number
 * instead of "+X Gold" under a celebration.
 *
 * The wager left the wallet when the attempt opened, so the honest number is
 * always payout minus wager. One helper rather than the same ternary in five
 * boards, because the five have to agree about this.
 */

export interface AnteUpResultLine {
  /** payout - wager. Negative when a win still cost the player Gold. */
  net: number;
  /** Whether the player finished ahead. What the celebration should key off, not `payout > 0`. */
  profited: boolean;
  /** Ready to render. */
  label: string;
}

export function anteUpResultLine(wager: number, payout: number): AnteUpResultLine {
  if (wager <= 0) {
    return { net: 0, profited: false, label: "Practice round, no Gold at stake" };
  }

  const net = payout - wager;
  if (net > 0) return { net, profited: true, label: `+${net.toLocaleString()} Gold` };
  if (net === 0) return { net, profited: false, label: "Wager returned, no change" };
  if (payout > 0) {
    // A win, but a slow one: some of the stake comes back and the rest does
    // not. Naming both halves is the only way this reads as what happened.
    return {
      net,
      profited: false,
      label: `${payout.toLocaleString()} back, ${Math.abs(net).toLocaleString()} Gold down`,
    };
  }
  return { net, profited: false, label: `−${wager.toLocaleString()} Gold` };
}
