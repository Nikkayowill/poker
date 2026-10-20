import { describe, expect, it } from "vitest";

import {
  HIRED_HAND_BEDS_PER_PASS,
  HIRED_HAND_CHORES_EVERY_MS,
  hiredHandChoresDue,
  hiredHandWageDue,
  pickHiredHandChores,
} from "./hired-hand";
import type { StackAcresStock } from "./catalogue";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;

function row(id: string, over: { stock?: StackAcresStock; startedAt?: string; readyAt?: string; lastWateredAt?: string | null; lastFedAt?: string | null } = {}) {
  return {
    id,
    status: "working" as const,
    stock: over.stock ?? ("wheat" as StackAcresStock),
    startedAt: over.startedAt ?? ago(2 * MIN),
    readyAt: over.readyAt ?? ahead(3 * MIN),
    lastFedAt: over.lastFedAt ?? null,
    lastWateredAt: over.lastWateredAt === undefined ? ago(2 * MIN) : over.lastWateredAt,
  };
}

describe("hired hand wage", () => {
  it("is due once the game day moves past the last one paid", () => {
    expect(hiredHandWageDue(100, 100)).toBe(false);
    expect(hiredHandWageDue(100, 101)).toBe(true);
    // Days away are not owed one by one: the pass pays today and moves on.
    expect(hiredHandWageDue(100, 140)).toBe(true);
  });
});

describe("hired hand chores timing", () => {
  it("waits the full interval between passes", () => {
    const at = NOW.getTime();
    expect(hiredHandChoresDue(at, at + HIRED_HAND_CHORES_EVERY_MS - 1)).toBe(false);
    expect(hiredHandChoresDue(at, at + HIRED_HAND_CHORES_EVERY_MS)).toBe(true);
  });
});

describe("pickHiredHandChores", () => {
  it("waters unwatered seed first, then harvests what is ripe", () => {
    const rows = [
      row("ripe", { startedAt: ago(6 * MIN), readyAt: ago(MIN), lastWateredAt: ago(6 * MIN) }),
      row("seed", { lastWateredAt: null, startedAt: ago(MIN) }),
      row("growing"),
    ];
    expect(pickHiredHandChores(rows, NOW, new Set())).toEqual({ water: ["seed"], harvest: ["ripe"] });
  });

  it("does at most a pass's worth of beds, oldest first", () => {
    const seeds = Array.from({ length: 6 }, (_, i) => row(`seed-${i}`, { lastWateredAt: null, startedAt: ago((i + 1) * MIN) }));
    const ripe = row("ripe", { startedAt: ago(6 * MIN), readyAt: ago(MIN), lastWateredAt: ago(6 * MIN) });
    const picked = pickHiredHandChores([...seeds, ripe], NOW, new Set());
    expect(picked.water).toEqual(["seed-5", "seed-4", "seed-3", "seed-2"]);
    expect(picked.water).toHaveLength(HIRED_HAND_BEDS_PER_PASS);
    expect(picked.harvest).toEqual([]);
  });

  it("leaves animals and piped beds alone", () => {
    const rows = [
      row("hen", { stock: "hen" as StackAcresStock, lastWateredAt: null, lastFedAt: ago(MIN), readyAt: ago(MIN), startedAt: ago(10 * MIN) }),
      row("piped", { lastWateredAt: null, startedAt: ago(MIN) }),
    ];
    expect(pickHiredHandChores(rows, NOW, new Set(["piped"]))).toEqual({ water: [], harvest: [] });
  });
});
