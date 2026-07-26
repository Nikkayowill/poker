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

  return { values: score, name: categoryNames[score[0]] };
}

export function compareScores(a: HandScore, b: HandScore): number {
  const length = Math.max(a.values.length, b.values.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.values[index] ?? 0) - (b.values[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function evaluateHand(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error("At least five cards are required.");
  let best: HandScore | null = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const candidate = scoreFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareScores(candidate, best) > 0) best = candidate;
          }
        }
      }
    }
  }
  return best!;
}
