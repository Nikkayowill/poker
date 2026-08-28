import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import type { StakesTier } from "@/lib/game/tiers";
import { getPlayerStanding } from "./stats-store";
import { ensureProfile } from "./profile-store";
import { joinSitAndGoTable, openSitAndGoTable, readSitAndGoTableById } from "./sit-and-go-service";
import { openHeadsUpQuickPlay, readHeadsUpTableById } from "./heads-up-service";
import {
  advanceStoredGameWithTimeouts,
  archiveStaleGames,
  countActiveGames,
  createStoredGame,
  findOpenPublicGame,
  getStoredGame,
  listPublicPlayingGames,
  loadGameWithTimeouts,
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

describe("listPublicPlayingGames (memory mode)", () => {
  it("lists only public tables still playing, ranked by human seat count", async () => {
    const before = await listPublicPlayingGames(1000);
    const beforeIds = new Set(before.map((table) => table.id));

    const finished = createGame(randomUUID());
    finished.status = "complete";
    await createStoredGame(finished);

    const privateTable = createGame(randomUUID(), "You", undefined, { isPrivate: true });
    await createStoredGame(privateTable);

    // createGame always seats the host as a human at seat 0, so an all-bot
    // table has to be produced by hand -- there's no route that creates one.
    const quiet = createGame(randomUUID());
    quiet.seats[0].isHuman = false;
    quiet.seats[0].ownerToken = null;
    await createStoredGame(quiet);

    const populated = createGame(randomUUID(), "You");
    await createStoredGame(populated);

    const after = await listPublicPlayingGames(1000);
    const fresh = after.filter((table) => !beforeIds.has(table.id));
    const freshIds = fresh.map((table) => table.id);

    expect(freshIds).toContain(quiet.id);
    expect(freshIds).toContain(populated.id);
    expect(freshIds).not.toContain(finished.id);
    expect(freshIds).not.toContain(privateTable.id);

    // The populated table has a human seat and should rank ahead of the
    // all-bot one, wherever either lands relative to tables from an earlier
    // test in this file.
    expect(freshIds.indexOf(populated.id)).toBeLessThan(freshIds.indexOf(quiet.id));
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
  function backdatedGame(msAgo: number, tier: StakesTier) {
    const game = createGame(randomUUID(), "You", undefined, { tier });
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

    const fresh = createGame(randomUUID(), "You", undefined, { tier: "500k" });
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
    const stake = game.seats.find((seat) => seat.ownerToken === token)!.stack;
    await createStoredGame(game);

    const archivedCount = await archiveStaleGames();
    expect(archivedCount).toBeGreaterThanOrEqual(1);
    expect((await getStoredGame(game.id))?.status).toBe("archived");

    const after = await ensureProfile(token);
    expect(after.goldBalance).toBe(before.goldBalance + stake);
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
