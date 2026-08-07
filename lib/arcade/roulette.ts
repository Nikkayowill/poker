/**
 * Roulette -- European, single zero.
 *
 * One bet, one spin, settled. Pure and synchronous like every other engine
 * here: nothing reads a clock, a store or a request, so the payout table --
 * the part worth getting right -- is entirely reachable from `npm test`.
 *
 * ## The single zero IS the house edge
 *
 * There are 37 pockets and every bet is priced as though there were 36. A
 * straight-up number pays 35 to 1 against 36 losing pockets; red pays 1 to 1
 * against 19. That is a 1/37 = 2.70% edge on every bet on the layout, uniform
 * and self-evident from the wheel -- which is why, unlike Hi-Lo, there is no
 * separate HOUSE_EDGE constant to apply. Adding one would be charging twice
 * for the same thing.
 *
 * This is emphatically not the American wheel: a second zero doubles the edge
 * to 5.26% and is the single most player-hostile change available here. The
 * pocket count is asserted in the tests for that reason.
 *
 * ## La partage is not implemented, and that is a decision
 *
 * Some European houses return half an even-money bet when the ball lands on
 * zero, which cuts the edge on those bets to 1.35%. Offering it on red/black
 * but not on a straight-up number would mean two different house edges on one
 * layout, which is a thing a player has to be told rather than shown. Zero
 * loses everything except a straight-up bet on zero, and the felt says so.
 *
 * ## The wheel order is the wheel's, not the layout's
 *
 * WHEEL_ORDER is the physical sequence of pockets on a European wheel, where
 * reds and blacks alternate and consecutive numbers sit opposite each other.
 * It decides nothing about odds -- a spin picks a pocket uniformly -- and
 * exists so the drawn wheel is a real wheel rather than 0..36 in a ring.
 */

import type { RandomInt } from "@/lib/game/deck";

/** Pockets on a European wheel. 37, and the whole house edge is the fact that it is not 36. */
export const POCKET_COUNT = 37;

/**
 * The physical order of pockets, clockwise from zero, on a European wheel.
 *
 * Reds and blacks alternate all the way round and each number sits opposite
 * its neighbour in value. Only the drawing reads this.
 */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

/** The red numbers. The blacks are everything else that is not zero. */
const RED_POCKETS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type PocketColour = "red" | "black" | "green";

export function pocketColour(pocket: number): PocketColour {
  if (pocket === 0) return "green";
  return RED_POCKETS.has(pocket) ? "red" : "black";
}

/**
 * Every bet the layout offers.
 *
 * A discriminated union rather than a `{ kind, selection: string }` pair, so
 * the route's zod schema can refuse "column 7" at the edge instead of leaving
 * `rouletteWins` to decide what an out-of-range column means.
 */
export type RouletteBet =
  | { kind: "straight"; pocket: number }
  | { kind: "colour"; colour: "red" | "black" }
  | { kind: "parity"; parity: "odd" | "even" }
  | { kind: "half"; half: "low" | "high" }
  | { kind: "dozen"; dozen: 1 | 2 | 3 }
  | { kind: "column"; column: 1 | 2 | 3 };

export type RouletteBetKind = RouletteBet["kind"];

/**
 * Net odds -- "35" means 35 to 1, so a winner gets 36 times the stake back.
 *
 * Kept as *net* here because that is how a roulette layout is printed and how
 * a player will check it. The conversion to the gross figure the wallet needs
 * happens in one place, `roulettePayout`; doing it per bet kind is how one of
 * them ends up paying the stake twice.
 */
export const ROULETTE_ODDS: Record<RouletteBetKind, number> = {
  straight: 35,
  colour: 1,
  parity: 1,
  half: 1,
  dozen: 2,
  column: 2,
};

/** How many of the 37 pockets win each bet. Used to state the true chance on the felt. */
export function winningPockets(bet: RouletteBet): number {
  switch (bet.kind) {
    case "straight":
      return 1;
    case "colour":
    case "parity":
    case "half":
      return 18;
    case "dozen":
    case "column":
      return 12;
  }
}

export function isLegalBet(bet: RouletteBet): boolean {
  switch (bet.kind) {
    case "straight":
      return Number.isInteger(bet.pocket) && bet.pocket >= 0 && bet.pocket < POCKET_COUNT;
    case "colour":
      return bet.colour === "red" || bet.colour === "black";
    case "parity":
      return bet.parity === "odd" || bet.parity === "even";
    case "half":
      return bet.half === "low" || bet.half === "high";
    case "dozen":
      return bet.dozen === 1 || bet.dozen === 2 || bet.dozen === 3;
    case "column":
      return bet.column === 1 || bet.column === 2 || bet.column === 3;
  }
}

/**
 * Whether a bet wins on a pocket.
 *
 * Zero is handled first and once. Every outside bet loses to it -- that single
 * line is the house's entire margin, and burying it inside each branch is how
 * one branch ends up forgetting it and paying red on a green zero.
 */
export function rouletteWins(bet: RouletteBet, pocket: number): boolean {
  if (bet.kind === "straight") return bet.pocket === pocket;
  if (pocket === 0) return false;

  switch (bet.kind) {
    case "colour":
      return pocketColour(pocket) === bet.colour;
    case "parity":
      return (pocket % 2 === 1) === (bet.parity === "odd");
    case "half":
      return bet.half === "low" ? pocket <= 18 : pocket >= 19;
    case "dozen":
      return Math.ceil(pocket / 12) === bet.dozen;
    case "column":
      // Columns run down the layout: 1,4,7.. / 2,5,8.. / 3,6,9..
      return ((pocket - 1) % 3) + 1 === bet.column;
  }
}

/** How a bet reads on the felt: "Red", "2nd dozen", "Straight up 17". */
export function betLabel(bet: RouletteBet): string {
  switch (bet.kind) {
    case "straight":
      return `Straight up ${bet.pocket}`;
    case "colour":
      return bet.colour === "red" ? "Red" : "Black";
    case "parity":
      return bet.parity === "odd" ? "Odd" : "Even";
    case "half":
      return bet.half === "low" ? "1 to 18" : "19 to 36";
    case "dozen":
      return `${["1st", "2nd", "3rd"][bet.dozen - 1]} dozen`;
    case "column":
      return `${["1st", "2nd", "3rd"][bet.column - 1]} column`;
  }
}

export type RoulettePhase = "bet" | "settled";

export interface RouletteRound {
  stake: number;
  bet: RouletteBet;
  /** Null until the wheel is spun. Nothing decides the round before then. */
  pocket: number | null;
  phase: RoulettePhase;
  won: boolean;
  /** Net change in Gold, settled only. Negative is a loss. */
  netGold: number;
}

/** What a settled round pays back, GROSS. Zero on a loss; stake x (odds + 1) on a win. */
export function roulettePayout(round: RouletteRound): number {
  if (round.phase !== "settled" || !round.won) return 0;
  // The one place net odds become the gross figure the wallet takes.
  return Math.floor(round.stake * (ROULETTE_ODDS[round.bet.kind] + 1));
}

/** Opens a round with the bet placed and the wheel not yet spun. */
export function startRouletteRound({ stake, bet }: { stake: number; bet: RouletteBet }): RouletteRound {
  if (!Number.isFinite(stake) || stake <= 0) throw new Error("A round needs a positive stake.");
  if (!isLegalBet(bet)) throw new Error("That is not a bet this layout offers.");
  return {
    stake: Math.floor(stake),
    bet,
    pocket: null,
    phase: "bet",
    won: false,
    netGold: 0,
  };
}

/**
 * Spins the wheel and settles.
 *
 * The pocket is drawn uniformly over all 37, not over WHEEL_ORDER's positions
 * -- those are the same set, but drawing over the physical ring would invite
 * someone to "improve" it into something weighted by neighbours later.
 *
 * Inert on a round that has already been spun rather than throwing: the
 * service re-checks before this, and a throw there would be a 500 where a 409
 * belongs -- and a second spin on one bet is precisely what the version guard
 * exists to stop.
 */
export function spinRoulette(round: RouletteRound, randomInt: RandomInt): RouletteRound {
  if (round.phase !== "bet") return round;

  const pocket = randomInt(POCKET_COUNT);
  const won = rouletteWins(round.bet, pocket);
  const gross = won ? Math.floor(round.stake * (ROULETTE_ODDS[round.bet.kind] + 1)) : 0;

  return {
    ...round,
    pocket,
    phase: "settled",
    won,
    // Gross minus what was already taken, so a winner is never paid their own
    // stake as though it were winnings.
    netGold: gross - round.stake,
  };
}

export function rouletteOutcomeLabel(round: Pick<RouletteRound, "phase" | "pocket" | "won">): string {
  if (round.phase !== "settled" || round.pocket === null) return "Place your bet";
  const colour = pocketColour(round.pocket);
  const face = round.pocket === 0 ? "Zero" : `${round.pocket} ${colour}`;
  return round.won ? `${face} — paid` : face;
}

/* ------------------------------------------------------- drawing the wheel */

/** Radians per pocket. */
export const POCKET_ANGLE = (Math.PI * 2) / POCKET_COUNT;

/** How many full turns the wheel makes before it settles. Feel, not rules. */
export const SPIN_TURNS = 6;
/** How long a spin takes. Under the 900ms-per-request feel budget it is not, and does not need to be. */
export const SPIN_DURATION_MS = 3600;

/**
 * Where the wheel must come to rest for `pocket` to sit under the marker.
 *
 * Pockets are drawn at `index * POCKET_ANGLE` clockwise from the top, so the
 * wheel has to rotate back by the winner's index -- plus whole turns, which
 * are what make it a spin rather than a nudge.
 */
export function restingRotation(pocket: number, turns = SPIN_TURNS): number {
  const index = WHEEL_ORDER.indexOf(pocket);
  if (index < 0) throw new Error(`No such pocket on the wheel: ${pocket}`);
  return turns * Math.PI * 2 - index * POCKET_ANGLE;
}

/**
 * Where the wheel is, partway through a spin.
 *
 * Quartic ease-out: it leaves hard and creeps into the pocket, which is what a
 * real wheel does and is the whole reason the last half second is worth
 * watching. It terminates *exactly* -- at `elapsed >= duration` this returns
 * the resting rotation itself rather than something a hair short of it, so the
 * animation loop always sleeps and the winning number is always exactly under
 * the marker. Same contract `stepGlideChip` holds in lib/scene.
 */
export function wheelRotation(
  pocket: number,
  elapsedMs: number,
  durationMs = SPIN_DURATION_MS,
  turns = SPIN_TURNS,
): number {
  const resting = restingRotation(pocket, turns);
  if (durationMs <= 0 || elapsedMs >= durationMs) return resting;
  if (elapsedMs <= 0) return 0;
  const progress = elapsedMs / durationMs;
  return resting * (1 - (1 - progress) ** 4);
}

/* ------------------------------------------------------------- redaction */

/**
 * The round as the browser may see it.
 *
 * There is no deck here to hide, but there is something better hidden: before
 * the spin, `pocket` is genuinely null in the stored round -- the number is
 * not drawn until the spin request arrives. A client cannot read a result that
 * does not exist yet, which is a stronger guarantee than redacting one.
 */
export interface RouletteSnapshot {
  id: string;
  version: number;
  stake: number;
  bet: RouletteBet;
  pocket: number | null;
  colour: PocketColour | null;
  phase: RoulettePhase;
  won: boolean;
  netGold: number;
  /** Net odds and true chance, so the felt can quote the price it is charging. */
  odds: number;
  winningPockets: number;
}

export function toRouletteSnapshot(
  round: RouletteRound,
  meta: { id: string; version: number },
): RouletteSnapshot {
  return {
    id: meta.id,
    version: meta.version,
    stake: round.stake,
    bet: { ...round.bet },
    pocket: round.pocket,
    colour: round.pocket === null ? null : pocketColour(round.pocket),
    phase: round.phase,
    won: round.won,
    netGold: round.netGold,
    odds: ROULETTE_ODDS[round.bet.kind],
    winningPockets: winningPockets(round.bet),
  };
}
