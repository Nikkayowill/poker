import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import { getPlayerStanding } from "./stats-store";
import {
  advanceStoredGameWithTimeouts,
  countActiveGames,
  createStoredGame,
  getStoredGame,
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
