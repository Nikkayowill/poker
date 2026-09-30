import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPlayerAction, createGame, createHeadsUpGame } from "@/lib/game/engine";
import type { Card } from "@/lib/game/types";
import { TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { getPlayerStanding } from "./stats-store";
import { ensureProfile } from "./profile-store";
import { joinSitAndGoTable, openSitAndGoTable, readSitAndGoTableById } from "./sit-and-go-service";
import { openHeadsUpQuickPlay, readHeadsUpTableById } from "./heads-up-service";
import { __backdateHeadsUpTableStartForTest } from "./heads-up-store";
import {
  advanceStoredGameWithTimeouts,
  archiveStaleGames,
  countActiveGames,
  createStoredGame,
  findOpenPublicGame,
  getStoredGame,
  loadGameWithTimeouts,
  updateStoredGame,
} from "./game-store";

function dueGame() {
  const token = randomUUID();
  const game = createGame(token);
  game.turnDeadlineAt = new Date(0).toISOString();
  return game;
}


describe("game deadline persistence (memory mode)", () => {
  it("keeps ordinary snapshot reads strictly read-only", async () => {
    const game = dueGame();
    await createStoredGame(game);

    const snapshot = await getStoredGame(game.id);

    expect(snapshot?.version).toBe(game.version);
    expect(snapshot?.turnDeadlineAt).toBe(game.turnDeadlineAt);

    const advanced = await loadGameWithTimeouts(game.id);
    expect(advanced?.version).toBe(game.version + 1);
  });

  it("treats simultaneous deadline attempts as one commit and one normal no-op", async () => {
    const game = dueGame();
    await createStoredGame(game);
    const firstReader = await getStoredGame(game.id);
    const secondReader = await getStoredGame(game.id);
    expect(firstReader).not.toBeNull();
    expect(secondReader).not.toBeNull();

    const [firstResult, secondResult] = await Promise.all([
      advanceStoredGameWithTimeouts(firstReader!),
      advanceStoredGameWithTimeouts(secondReader!),
    ]);

    expect(firstResult.version).toBe(game.version + 1);
    expect(secondResult.version).toBe(game.version + 1);
    expect(firstResult).toBe(secondResult);
    expect((await getStoredGame(game.id))?.version).toBe(game.version + 1);
  });

  it("coalesces a 100-request deadline burst into one version transition", async () => {
    const game = dueGame();
    await createStoredGame(game);
    const readers = await Promise.all(
      Array.from({ length: 100 }, () => getStoredGame(game.id)),
    );

    const results = await Promise.all(
      readers.map((state) => advanceStoredGameWithTimeouts(state!)),
    );

    expect(new Set(results).size).toBe(1);
    expect(results.every((state) => state.version === game.version + 1)).toBe(true);
    expect((await getStoredGame(game.id))?.version).toBe(game.version + 1);
  });

  it("leaves no due turn behind, so the browser has nothing to poll for", async () => {
    // The invariant that lets the client stop polling: after one request,
    // whatever is on turn is either waiting on a clock that has not run out
    // or is not there at all. If a due turn could survive a request, the
    // browser would have to keep asking -- which is what it used to do.
    const game = dueGame();
    await createStoredGame(game);

    const advanced = await advanceStoredGameWithTimeouts((await getStoredGame(game.id))!);

    expect(advanced.version).toBeGreaterThan(game.version);
    const deadline = Date.parse(advanced.turnDeadlineAt ?? "");
    const stillDue = advanced.currentPlayer !== null
      && Number.isFinite(deadline)
      && deadline <= Date.now();
    expect(stillDue).toBe(false);
  });

  it("does not act for a human whose clock is still running", async () => {
    // "Stops when human input is required" concretely: a seated human with
    // time left must be left alone. (An *expired* human clock is a different
    // thing -- that is the auto-fold, and it is meant to fire.)
    const token = randomUUID();
    const game = createGame(token);
    const human = game.seats.findIndex((seat) => seat.isHuman);
    expect(human).toBeGreaterThanOrEqual(0);
    game.currentPlayer = human;
    game.turnStartedAt = new Date().toISOString();
    game.turnDeadlineAt = new Date(Date.now() + 15_000).toISOString();
    await createStoredGame(game);

    const advanced = await advanceStoredGameWithTimeouts((await getStoredGame(game.id))!);

    expect(advanced.version).toBe(game.version);
    expect(advanced.currentPlayer).toBe(human);
  });

  it("does not advance a table whose deadline has not arrived", async () => {
    const token = randomUUID();
    const game = createGame(token);
    game.turnDeadlineAt = new Date(Date.now() + 60_000).toISOString();
    await createStoredGame(game);

    const advanced = await advanceStoredGameWithTimeouts((await getStoredGame(game.id))!);

    expect(advanced.version).toBe(game.version);
  });

  it("is idempotent: a repeated advance does not take a second turn", async () => {
    const game = dueGame();
    await createStoredGame(game);

    const first = await advanceStoredGameWithTimeouts((await getStoredGame(game.id))!);
    // A duplicate request, arriving after the first has fully settled -- the
    // retry case, not the race case the tests above cover.
    const second = await advanceStoredGameWithTimeouts((await getStoredGame(game.id))!);

    // The second request found nothing due, because the seat it would have
    // acted for now has a fresh deadline in the future.
    expect(second.version).toBe(first.version);
    expect((await getStoredGame(game.id))?.version).toBe(first.version);
  });
});

describe("stats recording through the real advance path (memory mode)", () => {
  /**
   * A regression test for a bug that hand-built fixtures in stats-store.test
   * .ts could not have caught, because they construct an already-finished
   * hand directly rather than reaching "complete" through this module's own
   * advance loop.
   *
   * The bug: advanceTimedTurn mutates its input state in place (it calls
   * applyTurnAction(state, action), which sets fields directly on the object
   * it was given), so inside resolveTimedAdvance, `current` and
   * `advanced.state` become the same reference the moment the call returns.
   * The hook used to read `current.status` *after* that call, which means it
   * was comparing that object's status to itself -- always false once a hand
   * genuinely completes. A human's own action was immune (the /actions route
   * captures its "was it already complete" flag as a boolean *before*
   * calling into the engine), so this only ever failed when a bot's timed
   * action was what closed the hand. Driving a whole hand through repeated,
   * independent advanceStoredGameWithTimeouts calls -- one per simulated
   * request, exactly like separate browsers hitting /advance -- is what
   * exercises that path for real.
   */
  it("records a stat when a bot's action closes the hand, not just a human's", async () => {
    const token = randomUUID();
    const game = createGame(token, "Hero");
    await createStoredGame(game);

    let current = (await getStoredGame(game.id))!;
    let guard = 0;
    while (current.status === "playing" && guard < 200) {
      // Every seat here is a bot except the human's, so whichever seat is on
      // turn when the deadline is checked, it is overwhelmingly a bot's
      // action that ends up closing the hand -- which is exactly the path
      // that silently never recorded anything.
      current.turnDeadlineAt = new Date(0).toISOString();
      await createStoredGame(current);
      current = await advanceStoredGameWithTimeouts((await getStoredGame(game.id))!);
      guard += 1;
    }
    expect(current.status).toBe("complete");

    const { ensureProfile } = await import("./profile-store");
    const profile = await ensureProfile(token);
    const standing = await getPlayerStanding(profile.id, "lifetime");
    expect(standing?.stats.handsPlayed).toBe(1);
  });
});

describe("countActiveGames (memory mode)", () => {
  it("counts only tables still playing, not every table the store has ever seen", async () => {
    const before = await countActiveGames();

    const finished = createGame(randomUUID());
    finished.status = "complete";
    await createStoredGame(finished);
    expect((await countActiveGames()).publicTables).toBe(before.publicTables);

    const live = createGame(randomUUID());
    await createStoredGame(live);
    expect((await countActiveGames()).publicTables).toBe(before.publicTables + 1);
  });
});

describe("stale-table matchmaking and archival (memory mode)", () => {
  // A short window so "stale" and "fresh" can both be produced deterministically
  // within one test, by backdating a table's own updatedAt rather than waiting.
  // beforeAll/afterAll, not beforeEach/afterEach: staleTableMs() is read fresh
  // on every call (see its own comment), but an afterEach here would delete
  // the override after the *first* test in this block and silently fall every
  // later one back to the real 30-minute default.
  let originalStaleMs: string | undefined;
  beforeAll(() => {
    originalStaleMs = process.env.RIVER_STALE_TABLE_MS;
    process.env.RIVER_STALE_TABLE_MS = "1000";
  });
  afterAll(() => {
    if (originalStaleMs === undefined) delete process.env.RIVER_STALE_TABLE_MS;
    else process.env.RIVER_STALE_TABLE_MS = originalStaleMs;
  });

  // Every other test in this file (and shared memoryGames, a module-global
  // with no per-test reset) creates its games at the default cheapest tier,
  // and findOpenPublicGame ranks within one tier -- so each test below that
  // asserts an *exact* winner uses its own tier, distinct from "1k" and from
  // each other, rather than racing leftovers from the rest of the file or
  // from earlier tests in this same block.
  // Bought in at the tier's own amount. The default 1000 is far below a
  // high tier's big blind, which rounds most bot stacks to zero and can open
  // the table already "complete" with only the host funded.
  const tierGame = (tier: StakesTier) =>
    createGame(randomUUID(), "You", undefined, { tier, buyIn: TIER_CONFIG[tier].minBuyIn });

  function backdatedGame(msAgo: number, tier: StakesTier) {
    const game = tierGame(tier);
    const stamp = new Date(Date.now() - msAgo).toISOString();
    game.createdAt = stamp;
    game.updatedAt = stamp;
    return game;
  }

  it("does not prefer a populated table whose only human seat has gone quiet", async () => {
    // Older and "populated" -- the exact shape that used to win outright.
    // Keep this beyond the production 30-minute default as well as the short
    // test override. That makes the fixture stale even if another Vitest
    // worker temporarily restores the process-level environment.
    const stale = backdatedGame(31 * 60_000, "500k");
    await createStoredGame(stale);

    const fresh = tierGame("500k");
    await createStoredGame(fresh);

    expect(await findOpenPublicGame(fresh.tier)).toBe(fresh.id);
  });

  it("still falls back to the oldest table when nothing populated is fresh", async () => {
    const older = backdatedGame(120_000, "250k");
    await createStoredGame(older);
    const newer = backdatedGame(60_000, "250k");
    await createStoredGame(newer);

    expect(await findOpenPublicGame(older.tier)).toBe(older.id);
  });

  it("archives a table nothing can ever unstick again, and refunds its human seat", async () => {
    const token = randomUUID();
    const before = await ensureProfile(token, "Ghost");
    const game = createGame(token, "Ghost");
    game.updatedAt = new Date(Date.now() - 60_000).toISOString();
    // The opening hand is live, so the seat has blinds in the pot. Those are
    // played out, not lost: with every other seat a bot, the away human's
    // blind comes back to them only if the hand's rules say so. Here we only
    // check the credit matches what the archived state says they walked with.
    await createStoredGame(game);

    const archivedCount = await archiveStaleGames();
    expect(archivedCount).toBeGreaterThanOrEqual(1);
    const stored = (await getStoredGame(game.id))!;
    expect(stored.status).toBe("archived");
    const seat = stored.seats.find((candidate) => candidate.ownerToken === token)!;
    expect(seat.stack).toBe(0);

    const after = await ensureProfile(token);
    expect(after.goldBalance).toBeGreaterThan(before.goldBalance);
  });

  /** A river spot where the away human holds aces against an all-in bot. */
  function abandonedRiver(token: string) {
    const toCards = (values: string): Card[] => values.split(" ").map((value) => ({
      rank: value.slice(0, -1) as Card["rank"],
      suit: ({ c: "clubs", d: "diamonds", h: "hearts", s: "spades" } as const)[value.at(-1) as "c" | "d" | "h" | "s"],
    }));
    const game = createGame(token, "Ghost");
    const human = game.seats.findIndex((seat) => seat.ownerToken === token);
    const bot = (human + 1) % game.seats.length;
    game.street = "river";
    game.community = toCards("2c 3d 7h 8s 9c");
    game.currentBet = 0;
    game.seats.forEach((seat) => {
      Object.assign(seat, { acted: true, streetBet: 0, committed: 0, status: "folded" });
    });
    Object.assign(game.seats[human], {
      status: "active", stack: 500, committed: 200, acted: false, holeCards: toCards("As Ad"),
    });
    Object.assign(game.seats[bot], { status: "all-in", stack: 0, committed: 200, holeCards: toCards("Ks Kd") });
    game.pot = 400;
    game.currentPlayer = human;
    game.turnStartedAt = new Date(Date.now() - 60_000).toISOString();
    game.turnDeadlineAt = new Date(Date.now() - 45_000).toISOString();
    game.updatedAt = new Date(Date.now() - 60_000).toISOString();
    return game;
  }

  it("plays out a hand abandoned mid-pot instead of losing the chips in it", async () => {
    const token = randomUUID();
    const before = await ensureProfile(token, "Ghost");
    await createStoredGame(abandonedRiver(token));

    await archiveStaleGames();

    // The away human times out into a check, aces win the 400 pot less 4%
    // rake, and they walk with 500 behind plus 384.
    expect((await ensureProfile(token)).goldBalance).toBe(before.goldBalance + 884);
  });

  it("never pays an archived table out twice", async () => {
    const token = randomUUID();
    const before = await ensureProfile(token, "Ghost");
    const game = abandonedRiver(token);
    await createStoredGame(game);
    // A copy read before the sweep, like a request that was already in flight.
    const staleCopy = (await getStoredGame(game.id))!;

    await archiveStaleGames();
    const paid = (await ensureProfile(token)).goldBalance;
    expect(paid).toBe(before.goldBalance + 884);

    // Leaving the archived table is refused outright.
    const archived = (await getStoredGame(game.id))!;
    expect(() => applyPlayerAction(archived, { type: "leave-seat" }, token)).toThrow(/closed/i);

    // The in-flight copy still says "playing", but its write loses the
    // version race, so the actions route never reaches its credit.
    const left = applyPlayerAction(staleCopy, { type: "leave-seat" }, token);
    await expect(updateStoredGame(left, { type: "leave-seat" }, token)).rejects.toThrow(/changed/i);

    // A second sweep finds nothing left to pay.
    await archiveStaleGames();
    expect((await ensureProfile(token)).goldBalance).toBe(paid);
    expect((await getStoredGame(game.id))?.status).toBe("archived");
  });

  it("refunds an abandoned Sit & Go's ORIGINAL entry fee, not a live stack, and cancels rather than completes it", async () => {
    const tokens = Array.from({ length: 6 }, () => randomUUID());
    const before = await Promise.all(tokens.map((token) => ensureProfile(token)));

    const { table: opened } = await openSitAndGoTable(tokens[0], "1k");
    let dealt = opened;
    for (let i = 1; i < 6; i += 1) {
      dealt = (await joinSitAndGoTable(tokens[i], opened.id)).table;
    }
    expect(dealt.status).toBe("active");
    const gameId = dealt.gameId!;

    // Simulate chips pushed to seat 0 via soft play, then the whole table
    // going idle -- exactly the exploit refunding a live stack here would
    // open. Re-persisting directly (memory mode's createStoredGame is a
    // plain overwrite) is the same shortcut engine.test.ts uses elsewhere
    // to set up a scenario without playing real hands to reach it.
    const game = (await getStoredGame(gameId))!;
    game.seats[0].stack = 6000;
    game.seats[1].stack = 0;
    game.updatedAt = new Date(Date.now() - 60_000).toISOString();
    await createStoredGame(game);

    await archiveStaleGames();

    expect((await getStoredGame(gameId))?.status).toBe("archived");
    const { table: cancelled } = await readSitAndGoTableById(tokens[0], opened.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.winnerId).toBeNull();

    for (let i = 0; i < 6; i += 1) {
      // Debited the entry fee at registration, refunded the same entry fee
      // here: net zero. Seat 0's inflated 6000 stack must never have been
      // credited.
      expect(await ensureProfile(tokens[i]).then((p) => p.goldBalance)).toBe(before[i].goldBalance);
    }
  });

  it("refunds an abandoned heads-up match's ORIGINAL stake, not a live stack, and cancels rather than completes it", async () => {
    const tokens = [randomUUID(), randomUUID()];
    const before = await Promise.all(tokens.map((token) => ensureProfile(token)));

    const { table: opened } = await openHeadsUpQuickPlay(tokens[0], "1k");
    const { table: matched } = await openHeadsUpQuickPlay(tokens[1], "1k");
    expect(matched.id).toBe(opened.id);
    const gameId = matched.gameId!;

    // Same soft-play-then-go-idle shape the Sit & Go test above simulates:
    // a live stack pushed to one seat must never be what gets refunded.
    const game = (await getStoredGame(gameId))!;
    game.seats[0].stack = 2000;
    game.seats[1].stack = 0;
    game.updatedAt = new Date(Date.now() - 60_000).toISOString();
    await createStoredGame(game);

    await archiveStaleGames();

    expect((await getStoredGame(gameId))?.status).toBe("archived");
    const { table: cancelled } = await readHeadsUpTableById(tokens[0], opened.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.winnerId).toBeNull();

    for (let i = 0; i < 2; i += 1) {
      // Debited the stake at match creation, refunded the same stake here:
      // net zero. Seat 0's inflated 2000 stack must never have been credited.
      expect(await ensureProfile(tokens[i]).then((p) => p.goldBalance)).toBe(before[i].goldBalance);
    }
  });

  it("refunds a heads-up match stuck 'complete' with no winner ever named, even though games.status already left 'playing'", async () => {
    // The orphan sweepUndecidedTournaments exists for: both seats forfeited
    // to zero (a double leave-seat, or the pre-fix corruption where the
    // survivor's own post-decision leave zeroed them too) with nobody left
    // for finalizeTournamentIfDecided to name winner. The underlying game
    // is already "complete", so the ordinary games.status === "playing"
    // sweep above never sees this row at all -- only the heads_up_tables
    // row itself (still "active") says anything is wrong.
    const tokens = [randomUUID(), randomUUID()];
    const before = await Promise.all(tokens.map((token) => ensureProfile(token)));

    const { table: opened } = await openHeadsUpQuickPlay(tokens[0], "1k");
    const { table: matched } = await openHeadsUpQuickPlay(tokens[1], "1k");
    const gameId = matched.gameId!;

    const game = (await getStoredGame(gameId))!;
    game.status = "complete";
    game.seats[0].stack = 0;
    game.seats[0].status = "out";
    game.seats[1].stack = 0;
    game.seats[1].status = "out";
    game.tournament!.winnerProfileId = null;
    await createStoredGame(game);
    __backdateHeadsUpTableStartForTest(opened.id, new Date(Date.now() - 60_000).toISOString());

    await archiveStaleGames();

    // Archived before the refund, so a match whose escrow is gone can never
    // go on to name a winner.
    expect((await getStoredGame(gameId))?.status).toBe("archived");
    const { table: cancelled } = await readHeadsUpTableById(tokens[0], opened.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.winnerId).toBeNull();

    for (let i = 0; i < 2; i += 1) {
      expect(await ensureProfile(tokens[i]).then((p) => p.goldBalance)).toBe(before[i].goldBalance);
    }
  });

  it("leaves a long-running heads-up match alone while its players are still at it", async () => {
    const tokens = [randomUUID(), randomUUID()];
    const before = await Promise.all(tokens.map((token) => ensureProfile(token)));
    const { table: opened } = await openHeadsUpQuickPlay(tokens[0], "1k");
    await openHeadsUpQuickPlay(tokens[1], "1k");
    // Started well past the stale window, but the game itself is fresh.
    __backdateHeadsUpTableStartForTest(opened.id, new Date(Date.now() - 60_000).toISOString());

    await archiveStaleGames();

    const { table } = await readHeadsUpTableById(tokens[0], opened.id);
    expect(table.status).toBe("active");
    expect((await getStoredGame(table.gameId!))?.status).not.toBe("archived");
    for (let i = 0; i < 2; i += 1) {
      // Still down the stake: nothing was refunded out from under the match.
      expect(await ensureProfile(tokens[i]).then((p) => p.goldBalance)).toBe(before[i].goldBalance - table.stake);
    }
  });

  it("pays the winner of a decided heads-up match the sweep finds, instead of refunding both", async () => {
    const tokens = [randomUUID(), randomUUID()];
    const before = await Promise.all(tokens.map((token) => ensureProfile(token)));
    const { table: opened } = await openHeadsUpQuickPlay(tokens[0], "1k");
    const { table: matched } = await openHeadsUpQuickPlay(tokens[1], "1k");
    const gameId = matched.gameId!;

    const game = (await getStoredGame(gameId))!;
    const winner = game.seats.find((seat) => seat.ownerToken === tokens[0])!;
    const loser = game.seats.find((seat) => seat.ownerToken === tokens[1])!;
    winner.stack += loser.stack;
    loser.stack = 0;
    loser.status = "out";
    game.status = "complete";
    game.tournament!.winnerProfileId = winner.profileId;
    game.updatedAt = new Date(Date.now() - 60_000).toISOString();
    await createStoredGame(game);
    __backdateHeadsUpTableStartForTest(opened.id, new Date(Date.now() - 60_000).toISOString());

    await archiveStaleGames();

    const { table } = await readHeadsUpTableById(tokens[0], opened.id);
    expect(table.status).toBe("completed");
    expect(table.winnerId).toBe(winner.profileId);
    expect(await ensureProfile(tokens[0]).then((p) => p.goldBalance)).toBe(before[0].goldBalance + table.stake);
    expect(await ensureProfile(tokens[1]).then((p) => p.goldBalance)).toBe(before[1].goldBalance - table.stake);
  });

  it("archives a tournament game never linked to its table without paying its stacks out", async () => {
    const tokens = [randomUUID(), randomUUID()];
    const profiles = await Promise.all(tokens.map((token) => ensureProfile(token)));
    const game = createHeadsUpGame(tokens.map((token, i) => ({ token, profile: profiles[i] })), "1k");
    game.updatedAt = new Date(Date.now() - 60_000).toISOString();
    await createStoredGame(game);

    await archiveStaleGames();

    expect((await getStoredGame(game.id))?.status).toBe("archived");
    for (let i = 0; i < 2; i += 1) {
      expect(await ensureProfile(tokens[i]).then((p) => p.goldBalance)).toBe(profiles[i].goldBalance);
    }
  });

  it("leaves a fresh table alone", async () => {
    const game = createGame(randomUUID());
    await createStoredGame(game);

    await archiveStaleGames();

    expect((await getStoredGame(game.id))?.status).toBe("playing");
  });

  it("never writes 'complete' -- archiving must not relaunch a dead table into another hand", async () => {
    const game = backdatedGame(60_000, "100k");
    await createStoredGame(game);

    await archiveStaleGames();

    expect((await getStoredGame(game.id))?.status).toBe("archived");
    expect((await getStoredGame(game.id))?.status).not.toBe("complete");
  });
});
