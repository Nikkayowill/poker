import type { Card } from "./types";

const rankValue: Record<Card["rank"], number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14,
};

const categoryNames = [
  "High card",
  "One pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
];

const rankNames: Record<Card["rank"], string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  "10": "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
};

export interface HandScore {
  values: number[];
  name: string;
}

function scoreFive(cards: Card[]): HandScore {
  const values = cards.map((card) => rankValue[card.rank]).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const groups = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const unique = [...new Set(values)];
  let straightHigh = 0;
  if (unique.length === 5 && unique[0] - unique[4] === 4) straightHigh = unique[0];
  if (unique.join(",") === "14,5,4,3,2") straightHigh = 5;

  let score: number[];
  if (flush && straightHigh) score = [8, straightHigh];
  else if (groups[0][1] === 4) score = [7, groups[0][0], groups[1][0]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) {
    score = [6, groups[0][0], groups[1][0]];
  } else if (flush) score = [5, ...values];
  else if (straightHigh) score = [4, straightHigh];
  else if (groups[0][1] === 3) {
    score = [3, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    score = [2, ...pairs, groups[2][0]];
  } else if (groups[0][1] === 2) {
    score = [1, groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  } else score = [0, ...values];

  return {
    values: score,
    name: score[0] === 8 && score[1] === 14 ? "Royal flush" : categoryNames[score[0]],
  };
}

export function compareScores(a: HandScore, b: HandScore): number {
  const length = Math.max(a.values.length, b.values.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.values[index] ?? 0) - (b.values[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The same exhaustive search, carrying the winning combination out with the
 * score instead of discarding it.
 *
 * Scoring is untouched -- scoreFive and compareScores decide, exactly as
 * before, and evaluateHand still returns precisely what it always returned.
 * The only new thing is that the five cards which produced the best score are
 * no longer thrown away, so a showdown can point at them.
 */
function searchBestFive(cards: Card[]): { score: HandScore; cards: Card[] } {
  if (cards.length < 5) throw new Error("At least five cards are required.");
  let best: HandScore | null = null;
  let bestCards: Card[] = [];
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const candidate = scoreFive(five);
            // Strictly greater, so ties keep the first combination found and
            // the result stays deterministic for a given input order.
            if (!best || compareScores(candidate, best) > 0) {
              best = candidate;
              bestCards = five;
            }
          }
        }
      }
    }
  }
  return { score: best!, cards: bestCards };
}

export function evaluateHand(cards: Card[]): HandScore {
  return searchBestFive(cards).score;
}

/**
 * The exact five cards that make the best hand out of `cards`.
 *
 * Used to show a player *why* they won rather than only that they did. Callers
 * must be sure the cards are legitimately visible first -- at a genuine
 * showdown -- because this is derived from hole cards.
 */
export function bestFiveCards(cards: Card[]): Card[] {
  return searchBestFive(cards).cards;
}

/**
 * Beginner-facing made-hand label. Before five cards are available it reports
 * rank groups (or the high card); from the flop onward it uses the exact
 * server evaluator, so the hint can never disagree with showdown scoring.
 */
export function describeHand(cards: Card[]): string {
  if (cards.length >= 5) return evaluateHand(cards).name;
  if (cards.length === 0) return "";

  const counts = new Map<Card["rank"], number>();
  cards.forEach((card) => counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1));
  const groups = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || rankValue[b[0]] - rankValue[a[0]],
  );

  if (groups[0][1] === 4) return "Four of a kind";
  if (groups[0][1] === 3) return "Three of a kind";
  if (groups.filter(([, count]) => count === 2).length >= 2) return "Two pair";
  if (groups[0][1] === 2) return "One pair";

  const high = cards.reduce((best, card) =>
    rankValue[card.rank] > rankValue[best.rank] ? card : best,
  );
  return `${rankNames[high.rank]} high`;
}
