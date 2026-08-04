import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import type { Card, GameState } from "@/lib/game/types";
import {
  archiveCompletedHand,
  getArchivedHand,
  listHandHistory,
  type HandHistoryPage,
} from "./hand-archive-store";
import { ensureProfile } from "./profile-store";

const ACE: Card = { rank: "A", suit: "spades" };
const KING: Card = { rank: "K", suit: "spades" };
const SEVEN: Card = { rank: "7", suit: "hearts" };
const DEUCE: Card = { rank: "2", suit: "clubs" };

/**
 * A completed hand between two seated humans, built the same way the other
 * bookkeeping tests build one: a real createGame() table with the fields the
 * archiver reads set directly. `street` and seat `status` are what decide
 * whether cards were shown, so they are the point of every case below.
 */
async function twoHandedHand(options: {
  heroToken: string;
  villainToken: string;
  street: GameState["street"];
  villainStatus: "active" | "folded";
  heroWins?: number;
}) {
  const state = createGame(options.heroToken);
  state.id = randomUUID();
  state.handNumber = 1;
  state.street = options.street;
  state.status = "complete";
  state.community = options.street === "showdown" ? [ACE, KING, SEVEN, DEUCE, { rank: "9", suit: "diamonds" }] : [];
  state.pot = 1000;
  state.rake = 0;

  const hero = state.seats[0];
  hero.isHuman = true;
  hero.ownerToken = options.heroToken;
  hero.name = "Hero";
  hero.holeCards = [ACE, KING];
  hero.committed = 500;
  hero.status = "active";

  const villain = state.seats[1];
  villain.isHuman = true;
  villain.ownerToken = options.villainToken;
  villain.name = "Villain";
  villain.holeCards = [SEVEN, DEUCE];
  villain.committed = 500;
  villain.status = options.villainStatus;

  // Everyone else sat this hand out.
  for (const seat of state.seats.slice(2)) {
    seat.holeCards = [];
    seat.status = "out";
    seat.ownerToken = null;
    seat.isHuman = false;
  }

  state.winners = [{
    seatId: hero.id,
    name: hero.name,
    amount: options.heroWins ?? 1000,
    hand: "Two pair",
    bestFive: null,
  }];

  await archiveCompletedHand(state);
  return state;
}

describe("archiveCompletedHand", () => {
  let heroToken: string;
  let villainToken: string;
  let heroId: string;
  let villainId: string;

  beforeEach(async () => {
    heroToken = randomUUID();
    villainToken = randomUUID();
    heroId = (await ensureProfile(heroToken)).id;
    villainId = (await ensureProfile(villainToken)).id;
  });

  it("records the hand for everyone who was dealt into it", async () => {
    const state = await twoHandedHand({
      heroToken,
      villainToken,
      street: "showdown",
      villainStatus: "active",
    });

    const hand = await getArchivedHand(heroId, state.id, 1);
    expect(hand).not.toBeNull();
    expect(hand?.pot).toBe(1000);
    expect(hand?.reachedShowdown).toBe(true);
    // The four seats that were not dealt in are not players in this hand.
    expect(hand?.players).toHaveLength(2);
    expect(hand?.players.map((player) => player.displayName).sort()).toEqual(["Hero", "Villain"]);
  });

  it("replays an opponent's cards only when the table actually saw them", async () => {
    const state = await twoHandedHand({
      heroToken,
      villainToken,
      street: "showdown",
      villainStatus: "active",
    });

    const hand = await getArchivedHand(heroId, state.id, 1);
    const villain = hand?.players.find((player) => player.displayName === "Villain");
    expect(villain?.cardsWereShown).toBe(true);
    expect(villain?.holeCards).toEqual([SEVEN, DEUCE]);
  });

  it("never replays cards that were mucked, not even to the hand's winner", async () => {
    // The villain folded, so the hand ended without a genuine showdown. Those
    // cards were never public and no amount of elapsed time makes them so.
    const state = await twoHandedHand({
      heroToken,
      villainToken,
      street: "river",
      villainStatus: "folded",
    });

    const hand = await getArchivedHand(heroId, state.id, 1);
    expect(hand?.reachedShowdown).toBe(false);
    const villain = hand?.players.find((player) => player.displayName === "Villain");
    expect(villain?.cardsWereShown).toBe(false);
    expect(villain?.holeCards).toBeNull();

    // The hero still gets their own cards back -- that is the whole feature.
    const hero = hand?.players.find((player) => player.isMine);
    expect(hero?.displayName).toBe("Hero");
    expect(hero?.holeCards).toEqual([ACE, KING]);
  });

  it("shows each player their own cards and hides the other's, from the same archived hand", async () => {
    const state = await twoHandedHand({
      heroToken,
      villainToken,
      street: "river",
      villainStatus: "folded",
    });

    const heroView = await getArchivedHand(heroId, state.id, 1);
    const villainView = await getArchivedHand(villainId, state.id, 1);

    // One stored row, two different redactions of it.
    expect(heroView?.players.find((p) => p.displayName === "Hero")?.holeCards).toEqual([ACE, KING]);
    expect(heroView?.players.find((p) => p.displayName === "Villain")?.holeCards).toBeNull();
    expect(villainView?.players.find((p) => p.displayName === "Villain")?.holeCards).toEqual([SEVEN, DEUCE]);
    expect(villainView?.players.find((p) => p.displayName === "Hero")?.holeCards).toBeNull();
  });

  it("refuses a hand the caller was never in, without confirming it exists", async () => {
    const state = await twoHandedHand({
      heroToken,
      villainToken,
      street: "showdown",
      villainStatus: "active",
    });

    const stranger = (await ensureProfile(randomUUID())).id;
    // Same answer as a hand number that was never played: a stranger learns
    // nothing about a table they never sat at.
    expect(await getArchivedHand(stranger, state.id, 1)).toBeNull();
    expect(await getArchivedHand(stranger, state.id, 999)).toBeNull();
  });

  it("is idempotent per hand, so a retry or a race writes one archive", async () => {
    const state = await twoHandedHand({
      heroToken,
      villainToken,
      street: "showdown",
      villainStatus: "active",
    });

    // Re-archiving the same completed state, as a retried sibling would.
    await archiveCompletedHand(state);
    await archiveCompletedHand(state);

    const page = await listHandHistory(heroId);
    expect(page.entries.filter((entry) => entry.gameId === state.id)).toHaveLength(1);
  });

  it("captures the board and result at completion, before the next deal overwrites them", async () => {
    const state = await twoHandedHand({
      heroToken,
      villainToken,
      street: "showdown",
      villainStatus: "active",
    });

    // The live aggregate rolls straight into the next hand.
    state.handNumber = 2;
    state.community = [];
    state.winners = [];
    state.pot = 0;
    state.street = "preflop";

    const hand = await getArchivedHand(heroId, state.id, 1);
    expect(hand?.community).toHaveLength(5);
    expect(hand?.pot).toBe(1000);
    expect(hand?.winners[0]?.name).toBe("Hero");
  });
});

describe("listHandHistory", () => {
  it("returns only the caller's own hands, newest first", async () => {
    const heroToken = randomUUID();
    const villainToken = randomUUID();
    const heroId = (await ensureProfile(heroToken)).id;
    const outsiderId = (await ensureProfile(randomUUID())).id;

    const first = await twoHandedHand({ heroToken, villainToken, street: "showdown", villainStatus: "active" });
    const second = await twoHandedHand({ heroToken, villainToken, street: "showdown", villainStatus: "active" });

    const page = await listHandHistory(heroId);
    const mine = page.entries.filter((entry) => entry.gameId === first.id || entry.gameId === second.id);
    expect(mine).toHaveLength(2);
    expect(new Date(mine[0].endedAt).getTime()).toBeGreaterThanOrEqual(new Date(mine[1].endedAt).getTime());
    expect(mine.every((entry) => entry.won)).toBe(true);

    expect((await listHandHistory(outsiderId)).entries).toHaveLength(0);
  });

  it("pages through hands that all finished in the same millisecond without losing any", async () => {
    const heroToken = randomUUID();
    const villainToken = randomUUID();
    const heroId = (await ensureProfile(heroToken)).id;

    // Archived back-to-back, so these share an endedAt. A cursor that were
    // only a timestamp would page straight past the whole tied group and
    // drop hands out of the player's history silently.
    const played: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const state = await twoHandedHand({ heroToken, villainToken, street: "showdown", villainStatus: "active" });
      played.push(state.id);
    }
    expect(new Set(played).size).toBe(5);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: HandHistoryPage = await listHandHistory(heroId, { limit: 2, cursor });
      seen.push(...page.entries.map((entry) => entry.gameId));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(10); // a cursor that never advances would loop forever
    } while (cursor);

    expect(seen.sort()).toEqual([...played].sort());
    // Every hand exactly once: no duplicates from a cursor that stalls.
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("treats a malformed or hostile cursor as no cursor at all", async () => {
    const heroToken = randomUUID();
    const villainToken = randomUUID();
    const heroId = (await ensureProfile(heroToken)).id;
    await twoHandedHand({ heroToken, villainToken, street: "showdown", villainStatus: "active" });

    // The middle field reaches a PostgREST or(...) filter, whose grammar is
    // commas and parentheses. None of these may be taken as a cursor.
    for (const cursor of [
      "not-a-cursor",
      "2026-08-03T12:00:00.000Z|not-a-uuid|1",
      `2026-08-03T12:00:00.000Z|${randomUUID()}),or(profile_id.neq.x|1`,
      `2026-08-03T12:00:00.000Z|${randomUUID()}|abc`,
      `2026-08-03T12:00:00.000Z|${randomUUID()}|-1`,
    ]) {
      const page = await listHandHistory(heroId, { limit: 5, cursor });
      expect(page.entries.length).toBeGreaterThan(0);
    }
  });
});
