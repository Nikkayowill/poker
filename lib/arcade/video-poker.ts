/**
 * Video Poker -- Jacks or Better, single hand.
 *
 * Five cards up, hold what you want, draw once, get paid off a fixed table.
 * Pure and synchronous like every other engine here: a function takes a round
 * and returns the next one, and nothing reads a clock, a store or a request.
 *
 * ## The hand is ranked by the poker table's own evaluator
 *
 * `rankVideoPokerHand` calls `evaluateHand` from lib/game/evaluator.ts rather
 * than counting pairs again. This is the same argument lib/game/deck.ts makes
 * for the shared deck, and it has real teeth: a second, private idea of what
 * beats what is a second thing to keep in step, and the day the two disagree
 * the arcade is paying out on a hand the felt would not have. Everything below
 * is a *mapping* from that score onto a pay line, not a re-evaluation.
 *
 * ## The paytable is 8/5, and the two numbers are the whole game
 *
 * Video poker paytables are named for the full house and flush lines, because
 * those two are what the return actually turns on -- the royal flush is the
 * headline and contributes about 2% of it. 9/6 "full pay" returns 99.54% to a
 * perfect player, which is a thinner house edge than anything else in this
 * arcade; 8/5 returns about 97.3%, which sits next to Hi-Lo's 3% and
 * Blackjack's. That is why the lines are 8 and 5 rather than the numbers a
 * player might recognise from a Nevada bar top, and it is stated on the felt
 * rather than left to be discovered.
 *
 * A multiplier here is GROSS -- what comes back per Gold staked, stake
 * included. So `jacks-or-better: 1` is a push, not a win of one unit. Getting
 * that backwards would pay every winner their stake twice; see the note on
 * rule 3 in lib/server/casino-round-service.ts.
 */

import { makeDeck, type RandomInt } from "@/lib/game/deck";
import { evaluateHand } from "@/lib/game/evaluator";
import type { Card } from "@/lib/game/types";

/** Cards in a video poker hand. Fixed at five -- this is not a stud variant. */
export const VIDEO_POKER_HAND_SIZE = 5;

export type VideoPokerPhase = "draw" | "settled";

export type VideoPokerRank =
  | "royal-flush"
  | "straight-flush"
  | "four-of-a-kind"
  | "full-house"
  | "flush"
  | "straight"
  | "three-of-a-kind"
  | "two-pair"
  | "jacks-or-better";

export interface PayLine {
  rank: VideoPokerRank;
  label: string;
  /** Gross return per Gold staked, stake included. 1 is a push. */
  multiplier: number;
}

/**
 * The pay table, best line first -- which is also the order it is rendered in,
 * so the machine's glass and the rules cannot drift apart.
 */
export const VIDEO_POKER_PAYTABLE: readonly PayLine[] = [
  { rank: "royal-flush", label: "Royal Flush", multiplier: 800 },
  { rank: "straight-flush", label: "Straight Flush", multiplier: 50 },
  { rank: "four-of-a-kind", label: "Four of a Kind", multiplier: 25 },
  { rank: "full-house", label: "Full House", multiplier: 8 },
  { rank: "flush", label: "Flush", multiplier: 5 },
  { rank: "straight", label: "Straight", multiplier: 4 },
  { rank: "three-of-a-kind", label: "Three of a Kind", multiplier: 3 },
  { rank: "two-pair", label: "Two Pair", multiplier: 2 },
  { rank: "jacks-or-better", label: "Jacks or Better", multiplier: 1 },
];

/** The lowest pair that pays. Jacks -- hence the name of the game. */
const LOWEST_PAYING_PAIR = 11;

export interface VideoPokerRound {
  /** Undealt cards. Dealt from the end with pop(), like every other deck here. */
  deck: Card[];
  hand: Card[];
  /** Which positions the player kept. All false until the draw is taken. */
  held: boolean[];
  /** Which positions were replaced. All false before the draw -- the felt animates from this. */
  replaced: boolean[];
  stake: number;
  phase: VideoPokerPhase;
  /** Null while the hand is still live, and also null for a settled hand that pays nothing. */
  rank: VideoPokerRank | null;
  /** Net change in Gold, settled only. Negative is a loss. */
  netGold: number;
}

export function payLine(rank: VideoPokerRank): PayLine {
  const line = VIDEO_POKER_PAYTABLE.find((entry) => entry.rank === rank);
  if (!line) throw new Error(`No pay line for ${rank}.`);
  return line;
}

/**
 * Which pay line a five-card hand lands on, or null for nothing.
 *
 * `evaluateHand` hands back `values`, whose first element is the category
 * index (0 high card .. 8 straight flush) and whose second is the category's
 * top rank. Everything here is a read of those two numbers; no card is
 * inspected directly, which is what keeps this a mapping rather than a second
 * evaluator.
 */
export function rankVideoPokerHand(hand: Card[]): VideoPokerRank | null {
  if (hand.length !== VIDEO_POKER_HAND_SIZE) {
    throw new Error("A video poker hand is exactly five cards.");
  }
  const [category, top] = evaluateHand(hand).values;
  switch (category) {
    case 8:
      // An ace-high straight flush is the royal, and it is the only reason
      // this line needs the tiebreaker at all.
      return top === 14 ? "royal-flush" : "straight-flush";
    case 7:
      return "four-of-a-kind";
    case 6:
      return "full-house";
    case 5:
      return "flush";
    case 4:
      return "straight";
    case 3:
      return "three-of-a-kind";
    case 2:
      return "two-pair";
    case 1:
      // The one place a category is not enough: a pair of tens pays nothing.
      return top >= LOWEST_PAYING_PAIR ? "jacks-or-better" : null;
    default:
      return null;
  }
}

/** What a settled round pays back, GROSS. Zero for a losing hand, the stake for a push. */
export function videoPokerPayout(round: VideoPokerRound): number {
  if (round.phase !== "settled" || !round.rank) return 0;
  return Math.floor(round.stake * payLine(round.rank).multiplier);
}

/** Opens a round against a supplied deck. Tests pass an exact deck; the app calls dealVideoPoker. */
export function startVideoPokerRound({ stake, deck }: { stake: number; deck: Card[] }): VideoPokerRound {
  if (!Number.isFinite(stake) || stake <= 0) throw new Error("A round needs a positive stake.");
  const cards = [...deck];
  const hand: Card[] = [];
  for (let index = 0; index < VIDEO_POKER_HAND_SIZE; index += 1) {
    const card = cards.pop();
    if (!card) throw new Error("The deck ran out of cards.");
    hand.push(card);
  }
  return {
    deck: cards,
    hand,
    held: hand.map(() => false),
    replaced: hand.map(() => false),
    stake: Math.floor(stake),
    phase: "draw",
    rank: null,
    netGold: 0,
  };
}

/** A shuffled round from the shared 52-card deck. randomInt is injected, as in lib/game/deck.ts. */
export function dealVideoPokerRound(stake: number, randomInt: RandomInt): VideoPokerRound {
  return startVideoPokerRound({ stake, deck: makeDeck(randomInt) });
}

/** A hold array is legal only if it is exactly one boolean per card. */
export function isLegalHold(round: VideoPokerRound, held: boolean[]): boolean {
  return round.phase === "draw" && held.length === round.hand.length;
}

/**
 * The player's one decision. Replaces everything not held, ranks, settles.
 *
 * Holding all five is legal and is a real strategy -- it is how you keep a
 * made hand -- so it is a draw of zero cards, not a refusal.
 *
 * Inert on an illegal hold rather than throwing: the service re-checks
 * legality before this, and a throw there would be a 500 where a 409 belongs.
 */
export function drawVideoPoker(round: VideoPokerRound, held: boolean[]): VideoPokerRound {
  if (!isLegalHold(round, held)) return round;

  const deck = [...round.deck];
  const hand = round.hand.map((card, index) => {
    if (held[index]) return card;
    const replacement = deck.pop();
    if (!replacement) throw new Error("The deck ran out of cards.");
    return replacement;
  });

  const rank = rankVideoPokerHand(hand);
  const gross = rank ? Math.floor(round.stake * payLine(rank).multiplier) : 0;

  return {
    ...round,
    deck,
    hand,
    held: [...held],
    replaced: held.map((keep) => !keep),
    phase: "settled",
    rank,
    // Gross minus what was already taken. A pushed pair of jacks nets zero
    // rather than winning a stake, which is what `multiplier: 1` means.
    netGold: gross - round.stake,
  };
}

/**
 * Takes only the two fields it reads, so the browser can call it on a
 * snapshot -- which has no deck and is the only thing the client ever holds.
 */
export function videoPokerOutcomeLabel(round: Pick<VideoPokerRound, "phase" | "rank">): string {
  if (round.phase !== "settled") return "Hold and draw";
  if (!round.rank) return "No pay";
  return payLine(round.rank).label;
}

/**
 * The round as the browser may see it.
 *
 * `deck` is gone, which is the whole reason the server holds the round: the
 * next five cards are sitting on top of it, and a client that could read them
 * would know exactly what to hold.
 */
export interface VideoPokerSnapshot {
  id: string;
  version: number;
  hand: Card[];
  held: boolean[];
  replaced: boolean[];
  stake: number;
  phase: VideoPokerPhase;
  rank: VideoPokerRank | null;
  netGold: number;
}

export function toVideoPokerSnapshot(
  round: VideoPokerRound,
  meta: { id: string; version: number },
): VideoPokerSnapshot {
  return {
    id: meta.id,
    version: meta.version,
    hand: round.hand.map((card) => ({ ...card })),
    held: [...round.held],
    replaced: [...round.replaced],
    stake: round.stake,
    phase: round.phase,
    rank: round.rank,
    netGold: round.netGold,
  };
}
