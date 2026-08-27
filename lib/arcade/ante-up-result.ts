/**
 * What a finished Ante Up attempt actually did to the player's balance.
 *
 * Every Ante Up board used to render a win as `+{payout} Gold` and fire the
 * gold celebration whenever the payout was above zero. That was safe only
 * while every winning rung paid more than 1x. It no longer does: the slow
 * rungs at Memory Match, Word Stack and Connections deliberately pay back
 * less than was staked, so that clearing a board is not by itself profit (see
 * each game's own multiplier table for why). Against those rungs the old
 * display is a lie -- a 1,000 Gold wager returning 600 rendered as "+600 Gold"
 * under a celebration, while the player was 400 down.
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
