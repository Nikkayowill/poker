import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DuelRequestError,
  acceptDuelChallenge,
  cancelDuelChallenge,
  listDuelChallenges,
  openDuelChallenge,
  playDuelMove,
  readDuelMatch,
  resignDuelMatch,
} from "./pvp-match-service";
import { __resetHeadToHeadMemory, getHeadToHeadRecords } from "./head-to-head-store";
import { __resetLeaderboardMemory, getGameLeaderboard } from "./leaderboard-store";
import { __resetPvpChallengesForTest } from "./pvp-challenge-store";
import { __resetPvpMatchesForTest } from "./pvp-match-store";
import { adjustGold, ensureProfile, setUnlimitedGold } from "./profile-store";

/**
 * The duel money contract, in memory mode.
 *
 * The invariant that matters is CONSERVATION: a duel has no house, so the two
 * players' balances must sum to the same number before and after, whatever
 * happens in between. That is a stronger statement than any per-outcome
 * assertion, because it has to survive a win, a draw, a resignation, an
 * abandoned challenge and a lost race alike -- and it is the property that
 * makes these games safe to offer at any stake, which the casino games needed
 * a house edge to argue instead.
 *
 * Every test below therefore checks totals, not just one player's payout: a
 * bug that pays the winner twice and one that fails to debit the loser look
 * identical from one side.
 */

const STAKE = 1000;

async function funded(gold = 10_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** The pair, plus their combined balance -- the number that must never move. */
async function table() {
  const a = await funded();
  const b = await funded();
  return {
    a,
    b,
    async total() {
      return (await balance(a.token)) + (await balance(b.token));
    },
  };
}

beforeEach(() => {
  __resetPvpChallengesForTest();
  __resetPvpMatchesForTest();
  __resetLeaderboardMemory();
  __resetHeadToHeadMemory();
});

describe("challenge escrow", () => {
  it("debits the challenger when the offer is made, not when it is taken", async () => {
    const { a } = await table();
    const before = await balance(a.token);

    await openDuelChallenge(a.token, "chess", STAKE, null);

    // The stake is held from the moment the offer stands. An offer backed by
    // nothing is one the acceptor would pay into.
    expect(await balance(a.token)).toBe(before - STAKE);
  });

  it("refunds exactly once when the challenger withdraws", async () => {
    const { a } = await table();
    const before = await balance(a.token);
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);

    await cancelDuelChallenge(a.token, challenge.id);
    expect(await balance(a.token)).toBe(before);

    // Rule 4: the guarded write returns the row at most once, so the second
    // press refunds nothing rather than minting a stake.
    await expect(cancelDuelChallenge(a.token, challenge.id)).rejects.toBeInstanceOf(DuelRequestError);
    expect(await balance(a.token)).toBe(before);
  });

  it("will not let another player withdraw somebody else's escrow", async () => {
    const { a, b } = await table();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);
    const beforeB = await balance(b.token);

    await expect(cancelDuelChallenge(b.token, challenge.id)).rejects.toBeInstanceOf(DuelRequestError);
    expect(await balance(b.token)).toBe(beforeB);
  });

  it("refuses a stake the challenger cannot cover, without debiting", async () => {
    const poor = await funded(500);
    await expect(openDuelChallenge(poor.token, "chess", STAKE, null)).rejects.toBeInstanceOf(
      DuelRequestError,
    );
    expect(await balance(poor.token)).toBe(500);
  });

  it("holds one open challenge per player per game", async () => {
    const { a } = await table();
    await openDuelChallenge(a.token, "chess", STAKE, null);
    const after = await balance(a.token);

    // The second is refused and -- critically -- refunded: rule 1 says a stake
    // that bought nothing goes back.
    await expect(openDuelChallenge(a.token, "chess", STAKE, null)).rejects.toBeInstanceOf(
      DuelRequestError,
    );
    expect(await balance(a.token)).toBe(after);
  });

  it("lets the same player hold a challenge at each game at once", async () => {
    const { a } = await table();
    await openDuelChallenge(a.token, "chess", STAKE, null);
    await expect(openDuelChallenge(a.token, "checkers", STAKE, null)).resolves.toBeTruthy();
  });

  it("refuses a challenge to yourself before touching the wallet", async () => {
    const { a } = await table();
    const before = await balance(a.token);
    await expect(openDuelChallenge(a.token, "chess", STAKE, a.id)).rejects.toBeInstanceOf(
      DuelRequestError,
    );
    expect(await balance(a.token)).toBe(before);
  });

  it("refuses a wager under the floor, without touching the wallet", async () => {
    const { a } = await table();
    const before = await balance(a.token);
    await expect(openDuelChallenge(a.token, "chess", 499, null)).rejects.toBeInstanceOf(
      DuelRequestError,
    );
    expect(await balance(a.token)).toBe(before);
  });

  it("lets the challenger name any wager at or above the floor", async () => {
    const { a } = await table();
    const before = await balance(a.token);
    await openDuelChallenge(a.token, "chess", 7777, null);
    expect(await balance(a.token)).toBe(before - 7777);
  });
});

describe("accepting", () => {
  it("debits the acceptor and puts both stakes in one pot", async () => {
    const t = await table();
    const total = await t.total();

    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    const { match } = await acceptDuelChallenge(t.b.token, await openId(t.a.token));

    expect(match.stake).toBe(STAKE);
    expect(match.pot).toBe(STAKE * 2);
    // Both have paid; the pot is off both balances and not yet anybody's.
    expect(await t.total()).toBe(total - STAKE * 2);
  });

  it("seats the challenger at seat 0 and the acceptor at seat 1", async () => {
    const t = await table();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    const { match } = await acceptDuelChallenge(t.b.token, await openId(t.a.token));

    expect(match.yourSeat).toBe(1);
    expect(match.players[0].profileId).toBe(t.a.id);
    expect(match.players[1].profileId).toBe(t.b.id);
  });

  it("lets exactly one of two racing acceptors in, and charges only them", async () => {
    const t = await table();
    const c = await funded();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    const id = await openId(t.a.token);

    const results = await Promise.allSettled([
      acceptDuelChallenge(t.b.token, id),
      acceptDuelChallenge(c.token, id),
    ]);

    // The claim is a status-guarded UPDATE, so one wins. The loser must not be
    // left debited for a match they are not in.
    const accepted = results.filter((r) => r.status === "fulfilled");
    expect(accepted).toHaveLength(1);
    const paid = [await balance(t.b.token), await balance(c.token)].filter((b) => b < 10_000);
    expect(paid).toHaveLength(1);
  });

  it("refunds nothing and reopens the challenge when the acceptor cannot pay", async () => {
    const t = await table();
    const poor = await funded(100);
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    const id = await openId(t.a.token);

    await expect(acceptDuelChallenge(poor.token, id)).rejects.toBeInstanceOf(DuelRequestError);
    expect(await balance(poor.token)).toBe(100);

    // The challenger's escrow must go back in the pool rather than being
    // stranded in an accepted row that never became a match.
    const { challenges } = await listDuelChallenges(t.a.token, "chess");
    expect(challenges.map((entry) => entry.id)).toContain(id);
  });

  it("refuses a player accepting their own challenge", async () => {
    const t = await table();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    const after = await balance(t.a.token);

    await expect(acceptDuelChallenge(t.a.token, await openId(t.a.token))).rejects.toBeInstanceOf(
      DuelRequestError,
    );
    // Not debited a second time to play themselves.
    expect(await balance(t.a.token)).toBe(after);
  });
});

describe("settlement", () => {
  it("pays the whole pot to the winner and conserves Gold across the duel", async () => {
    const t = await table();
    const total = await t.total();
    const beforeA = await balance(t.a.token);

    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    // Seat 1 resigns, so seat 0 -- the challenger -- takes the pot.
    const { match } = await resignDuelMatch(t.b.token, await matchId(t.a.token));

    expect(match.status).toBe("settled");
    expect(match.winnerSeat).toBe(0);
    // The winner is up their opponent's stake, not the whole pot: their own
    // ante was already theirs.
    expect(await balance(t.a.token)).toBe(beforeA + STAKE);
    // And nothing leaked to a house that does not exist.
    expect(await t.total()).toBe(total);
  });

  it("pays a resignation exactly once however many times it is sent", async () => {
    const t = await table();
    const total = await t.total();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    const id = await matchId(t.a.token);

    // Rule 2: only the writer that wins the version race pays. A second
    // resign -- a double tap, a retry, both tabs -- finds a settled match.
    await resignDuelMatch(t.b.token, id);
    await resignDuelMatch(t.b.token, id);
    await resignDuelMatch(t.b.token, id);

    expect(await t.total()).toBe(total);
  });

  it("pays a pot once when both players resign at the same instant", async () => {
    const t = await table();
    const total = await t.total();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    const id = await matchId(t.a.token);

    await Promise.all([
      resignDuelMatch(t.a.token, id).catch(() => null),
      resignDuelMatch(t.b.token, id).catch(() => null),
    ]);

    expect(await t.total()).toBe(total);
  });

  it("frees both players to duel again once the match settles", async () => {
    const t = await table();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    await resignDuelMatch(t.b.token, await matchId(t.a.token));

    // The unique index is partial on `active`, so a finished match must not
    // block the rematch.
    expect((await readDuelMatch(t.a.token, "chess")).match).toBeNull();
    await expect(openDuelChallenge(t.a.token, "chess", STAKE, null)).resolves.toBeTruthy();
  });
});

describe("authorization", () => {
  it("refuses a move from somebody who is not in the match", async () => {
    const t = await table();
    const stranger = await funded();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    const id = await matchId(t.a.token);

    await expect(
      playDuelMove(stranger.token, { matchId: id, version: 1, move: {} }),
    ).rejects.toBeInstanceOf(DuelRequestError);
  });

  it("refuses a resignation from somebody who is not in the match", async () => {
    const t = await table();
    const stranger = await funded();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));

    await expect(
      resignDuelMatch(stranger.token, await matchId(t.a.token)),
    ).rejects.toBeInstanceOf(DuelRequestError);
  });
});

describe("unlimited-Gold profiles", () => {
  it("never pays a pot to a player who did not ante into it", async () => {
    // An unlimited profile is not charged, so crediting one the pot would mint
    // the loser's stake out of nothing on every match.
    const t = await table();
    await setUnlimitedGold(t.a.id, true);
    const beforeA = await balance(t.a.token);

    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    await resignDuelMatch(t.b.token, await matchId(t.a.token));

    expect(await balance(t.a.token)).toBe(beforeA);
  });
});

describe("a real game, end to end", () => {
  /**
   * Plays an actual checkers match through the service until somebody wins.
   *
   * Every other test here runs against the framework's own paths -- escrow,
   * claims, resignation -- and would still pass if no engine worked at all.
   * This one drives a REAL engine through the real routes' service layer:
   * challenge, accept, then move after move off each seat's own snapshot,
   * until `result()` ends it and the pot moves.
   *
   * Checkers rather than chess because its games are short and its snapshot
   * hands back the legal moves for the seat to act, so the test can play
   * without reimplementing the rules -- which is also the property that lets
   * its board be thin.
   */
  it("plays checkers to a finish and moves the pot exactly once", async () => {
    const t = await table();
    const total = await t.total();
    const beforeA = await balance(t.a.token);
    const beforeB = await balance(t.b.token);

    await openDuelChallenge(t.a.token, "checkers", STAKE, null);
    const { challenges } = await listDuelChallenges(t.a.token, "checkers");
    await acceptDuelChallenge(t.b.token, challenges.find((c) => c.mine)!.id);

    // Both stakes are off the table and in the pot.
    expect(await t.total()).toBe(total - STAKE * 2);

    let settled: Awaited<ReturnType<typeof playDuelMove>>["match"] | null = null;
    // A capped loop, not `while (true)`: a rules bug that never terminates
    // should fail this test rather than hang the suite, which is exactly how
    // countSolutions hung it for two minutes before its own guard existed.
    for (let ply = 0; ply < 400; ply += 1) {
      // Whoever is to move reads their own snapshot -- the same call the
      // client's poll makes -- and plays the first move it offers.
      const seats = [
        { player: t.a, read: await readDuelMatch(t.a.token, "checkers") },
        { player: t.b, read: await readDuelMatch(t.b.token, "checkers") },
      ];
      const live = seats.find((seat) => seat.read.match)?.read.match ?? null;
      if (!live || live.status === "settled") {
        settled = live;
        break;
      }

      // Only the seat to move is given legal moves -- that redaction is what
      // identifies the mover here, so this doubles as a check that the engine
      // really does withhold them from the other seat.
      const mover = seats.find(
        (seat) => ((seat.read.match?.state as { legalMoves?: unknown[] })?.legalMoves ?? []).length > 0,
      );
      expect(mover).toBeTruthy();
      const match = mover!.read.match!;
      const moves = (match.state as { legalMoves: unknown[] }).legalMoves;

      const result = await playDuelMove(mover!.player.token, {
        matchId: match.id,
        version: match.version,
        move: moves[0],
      });
      if (result.match.status === "settled") {
        settled = result.match;
        break;
      }
    }

    expect(settled?.status).toBe("settled");
    expect(settled?.outcome?.reason).toBeTruthy();

    // The pot went somewhere, once, and nothing leaked to a house that does
    // not exist. A draw returns both antes; a win moves one stake across.
    expect(await t.total()).toBe(total);
    const afterA = await balance(t.a.token);
    const afterB = await balance(t.b.token);
    if (settled?.winnerSeat === null) {
      expect(afterA).toBe(beforeA);
      expect(afterB).toBe(beforeB);
    } else {
      const [up, down] = settled?.winnerSeat === 0
        ? [afterA - beforeA, afterB - beforeB]
        : [afterB - beforeB, afterA - beforeA];
      expect(up).toBe(STAKE);
      expect(down).toBe(-STAKE);
    }
  });
});

describe("head-to-head record", () => {
  it("counts a win for the winner and a loss for the loser, from either side", async () => {
    const t = await table();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    // Seat 1 (b) resigns, so seat 0 (a) wins.
    await resignDuelMatch(t.b.token, await matchId(t.a.token));

    const aRecord = (await getHeadToHeadRecords(t.a.id, [t.b.id])).get(t.b.id);
    const bRecord = (await getHeadToHeadRecords(t.b.id, [t.a.id])).get(t.a.id);
    expect(aRecord).toEqual({ wins: 1, losses: 0, draws: 0, currentStreak: 1, bestStreak: 1 });
    expect(bRecord).toEqual({ wins: 0, losses: 1, draws: 0, currentStreak: -1, bestStreak: 0 });
  });

  it("accumulates across games and games settled the other way round", async () => {
    const t = await table();
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    await resignDuelMatch(t.b.token, await matchId(t.a.token)); // a wins

    await openDuelChallenge(t.b.token, "checkers", STAKE, null);
    const { challenges } = await listDuelChallenges(t.b.token, "checkers");
    const { match: checkersMatch } = await acceptDuelChallenge(
      t.a.token,
      challenges.find((c) => c.mine)!.id,
    );
    await resignDuelMatch(t.a.token, checkersMatch.id); // b wins

    const aRecord = (await getHeadToHeadRecords(t.a.id, [t.b.id])).get(t.b.id);
    expect(aRecord).toMatchObject({ wins: 1, losses: 1, draws: 0 });
    // Two games in play, so there is no single ordering to call a streak --
    // the per-game rows carry those. See getHeadToHeadSummaries.
    expect(aRecord?.currentStreak).toBe(0);
  });

  it("reports nothing against a stranger you have never settled a duel with", async () => {
    const { a } = await table();
    const stranger = await funded();
    expect((await getHeadToHeadRecords(a.id, [stranger.id])).get(stranger.id)).toBeUndefined();
  });
});

describe("per-game leaderboard stats", () => {
  it("writes a win and a loss for every decided match, through both playDuelMove and resignDuelMatch", async () => {
    const t = await table();

    // Two decided by resignation.
    for (let round = 0; round < 2; round += 1) {
      await openDuelChallenge(t.a.token, "chess", STAKE, null);
      await acceptDuelChallenge(t.b.token, await openId(t.a.token));
      await resignDuelMatch(t.b.token, await matchId(t.a.token)); // a wins
    }
    // A third, played out for real, so both settlement call sites -- the
    // move path and the resignation path -- are exercised here.
    await openDuelChallenge(t.a.token, "chess", STAKE, null);
    const { match } = await acceptDuelChallenge(t.b.token, await openId(t.a.token));
    await resignDuelMatch(t.a.token, match.id); // this time b wins

    // Below chess's minSample (3) until this third result lands.
    const board = await getGameLeaderboard("chess", 10);
    const rowA = board.find((row) => row.profileId === t.a.id)!;
    const rowB = board.find((row) => row.profileId === t.b.id)!;
    expect(rowA.stats).toMatchObject({ wins: 2, losses: 1 });
    expect(rowB.stats).toMatchObject({ wins: 1, losses: 2 });
  });
});

/** The id of this player's own open challenge. */
async function openId(token: string): Promise<string> {
  const { challenges } = await listDuelChallenges(token, "chess");
  const mine = challenges.find((entry) => entry.mine);
  if (!mine) throw new Error("no open challenge");
  return mine.id;
}

/** The id of this player's live match. */
async function matchId(token: string): Promise<string> {
  const { match } = await readDuelMatch(token, "chess");
  if (!match) throw new Error("no live match");
  return match.id;
}
