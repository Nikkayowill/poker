import { describe, expect, it } from "vitest";
import {
  advanceTimedTurn,
  applyPlayerAction,
  createHeadsUpGame,
  HEADS_UP_SEAT_COUNT,
  MAX_MISSED_TURNS,
} from "./engine";
import { TIER_CONFIG } from "./tiers";
import type { Card } from "./types";
import { defaultEquipped } from "@/lib/cosmetics/catalog";
import type { PlayerProfile } from "@/lib/profile/types";

const cards = (values: string): Card[] =>
  values.split(" ").map((value) => {
    const suitMap = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" } as const;
    return {
      rank: value.slice(0, -1) as Card["rank"],
      suit: suitMap[value.at(-1)! as keyof typeof suitMap],
    };
  });

const entrantProfile = (
  name: string,
  overrides: Partial<Pick<PlayerProfile, "id" | "isRegistered">> = {},
): Pick<
  PlayerProfile,
  "id" | "isRegistered" | "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped"
> => ({
  id: crypto.randomUUID(),
  isRegistered: true,
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  accent: "#79c9ff",
  avatarUrl: null,
  avatarPreset: "ace",
  equipped: defaultEquipped,
  ...overrides,
});

function twoEntrants() {
  const tokens = [crypto.randomUUID(), crypto.randomUUID()];
  const entrants = [
    { token: tokens[0], profile: entrantProfile("Player 1") },
    { token: tokens[1], profile: entrantProfile("Player 2") },
  ];
  return { tokens, entrants };
}

describe("createHeadsUpGame", () => {
  it("seats exactly two humans, no bots, at the tier's fixed stack and blinds", () => {
    const { entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    const config = TIER_CONFIG["1k"];

    expect(game.seats).toHaveLength(HEADS_UP_SEAT_COUNT);
    expect(game.seats.every((seat) => seat.isHuman)).toBe(true);
    // The first hand is already dealt (createHeadsUpGame deals immediately,
    // same as createGame), so a blind is already committed out of each
    // seat's stack -- what should hold is stack + committed === the buy-in.
    expect(game.seats.every((seat) => seat.stack + seat.committed === config.minBuyIn)).toBe(true);
    expect(game.smallBlind).toBe(config.smallBlind);
    expect(game.bigBlind).toBe(config.bigBlind);
    expect(game.isPrivate).toBe(true);
    expect(game.tournament).toEqual({
      format: "heads_up",
      entryFee: config.minBuyIn,
      startingStack: config.minBuyIn,
      blindLevel: 0,
      finishedAtHand: null,
      winnerProfileId: null,
    });
  });

  it("throws unless given exactly two entrants", () => {
    const { entrants } = twoEntrants();
    expect(() => createHeadsUpGame([entrants[0]], "1k")).toThrow();
    expect(() => createHeadsUpGame([...entrants, entrants[0]], "1k")).toThrow();
  });
});

describe("heads-up match settlement", () => {
  it("records the survivor as winner the instant the loser is out of chips", () => {
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    game.status = "playing";
    game.street = "river";
    game.community = cards("2c 3d 7h 8s 9c");
    game.currentPlayer = 0;
    game.currentBet = 0;
    game.seats.forEach((seat) => {
      seat.acted = true;
      seat.streetBet = 0;
    });
    // Equal committed amounts (a genuine call, not a lopsided side pot), so
    // the whole pot goes to one winner cleanly.
    game.seats[0].acted = false;
    game.seats[0].status = "active";
    game.seats[0].stack = 500;
    game.seats[0].committed = 500;
    game.seats[0].holeCards = cards("As Ad");
    game.seats[1].status = "all-in";
    game.seats[1].stack = 0;
    game.seats[1].committed = 500;
    game.seats[1].holeCards = cards("Ks Kd");
    const totalChips = game.seats[0].stack + game.seats[0].committed
      + game.seats[1].stack + game.seats[1].committed;

    const handOver = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(handOver.status).toBe("complete");
    // No rake: a heads-up loss shouldn't leak Gold out of the two stacks --
    // every chip either seat had is still in play between the two of them.
    expect(handOver.rake).toBe(0);
    expect(handOver.seats[0].stack + handOver.seats[1].stack).toBe(totalChips);
    expect(handOver.seats[1].stack).toBe(0);
    // Flagged finished the same instant the deciding hand ends, not on some
    // later next-hand pass -- waiting left a real window where both players
    // could leave the table before anything ever re-checked funded seats,
    // and the match would never settle (see finalizeTournamentIfDecided).
    expect(handOver.tournament?.winnerProfileId).toBe(handOver.seats[0].profileId);
    expect(handOver.tournament?.finishedAtHand).toBe(handOver.handNumber);

    // A stray next-hand call (e.g. a second browser tab racing in) must not
    // re-decide or overwrite an already-decided match.
    const finished = applyPlayerAction(handOver, { type: "next-hand" }, tokens[0]);
    expect(finished.tournament?.winnerProfileId).toBe(handOver.seats[0].profileId);
    expect(finished.tournament?.finishedAtHand).toBe(handOver.handNumber);
  });

  it("never takes rake on a heads-up pot", () => {
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    game.status = "playing";
    game.street = "river";
    game.community = cards("2c 3d 7h 8s 9c");
    game.currentPlayer = 0;
    game.currentBet = 0;
    game.seats.forEach((seat) => {
      seat.acted = true;
      seat.streetBet = 0;
    });
    game.seats[0].acted = false;
    game.seats[0].status = "active";
    game.seats[0].stack = 500;
    game.seats[0].committed = 5000;
    game.seats[0].holeCards = cards("As Ad");
    game.seats[1].status = "all-in";
    game.seats[1].stack = 0;
    game.seats[1].committed = 5000;
    game.seats[1].holeCards = cards("Ks Kd");

    // A pot this large would be raked at the standard 4%/3bb cap on a cash
    // table (see the "rake" describe block in engine.test.ts) -- confirms
    // the tournament guard, not just that this particular pot is too small.
    const finished = applyPlayerAction(game, { type: "check" }, tokens[0]);
    expect(finished.rake).toBe(0);
    expect(finished.winners[0].amount).toBe(10000);
  });
});

describe("heads-up match: no rebuys", () => {
  it("refuses a rebuy even once a seat is out of chips", () => {
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    game.status = "complete";
    game.seats[0].stack = 0;
    game.seats[0].status = "out";

    expect(() =>
      applyPlayerAction(game, { type: "rebuy", amount: TIER_CONFIG["1k"].minBuyIn }, tokens[0]),
    ).toThrow(/rebuy/i);
  });
});

describe("heads-up match: leaving forfeits", () => {
  it("leaving mid-hand on your own turn forfeits the match immediately, not just this hand", () => {
    // The real "close the tab or click Leave" case: no waiting on the turn
    // clock and no bot ever appears in the seat -- the match ends right here.
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k"); // dealt immediately, so status is "playing"
    expect(game.status).toBe("playing");
    const leavingIndex = game.currentPlayer!;
    const leavingToken = tokens[leavingIndex];
    const survivingProfileId = entrants[leavingIndex === 0 ? 1 : 0].profile.id;

    const after = applyPlayerAction(game, { type: "leave-seat" }, leavingToken);
    expect(after.seats[leavingIndex].status).toBe("out");
    expect(after.seats[leavingIndex].stack).toBe(0);
    expect(after.status).toBe("complete");
    expect(after.tournament?.winnerProfileId).toBe(survivingProfileId);
  });

  it("leaving mid-hand off turn doesn't disturb the live hand, but fast-tracks the forfeit", () => {
    // Whoever it currently isn't their turn can't be force-folded out of turn
    // without risking the other seat's own live decision -- so this only
    // primes the existing missed-turn count. The very next time it's their
    // turn (below, simulated the same way the AFK-tournament-seat engine
    // test does) it forfeits on the first timeout instead of the usual three.
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    const stayingIndex = game.currentPlayer!;
    const leavingIndex = stayingIndex === 0 ? 1 : 0;

    const after = applyPlayerAction(game, { type: "leave-seat" }, tokens[leavingIndex]);
    expect(after.status).toBe("playing");
    expect(after.currentPlayer).toBe(stayingIndex);
    expect(after.seats[leavingIndex].status).not.toBe("out");
    expect(after.seats[leavingIndex].missedTurns).toBe(MAX_MISSED_TURNS - 1);
    expect(after.tournament?.winnerProfileId).toBeNull();

    // Fast-forward to the leaving seat's own turn timing out.
    after.currentPlayer = leavingIndex;
    after.turnStartedAt = new Date(Date.now() - 60_000).toISOString();
    after.turnDeadlineAt = new Date(Date.now() - 1000).toISOString();
    const { state } = advanceTimedTurn(after, Date.now());
    expect(state.seats[leavingIndex].status).toBe("out");
    expect(state.seats[leavingIndex].stack).toBe(0);
    expect(state.tournament?.winnerProfileId).toBe(entrants[stayingIndex].profile.id);
  });

  it("zeroes the leaving seat between hands, and the next deal awards the match to the other seat", () => {
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    game.status = "complete"; // simulates a hand having just ended

    const after = applyPlayerAction(game, { type: "leave-seat" }, tokens[0]);
    expect(after.seats[0].stack).toBe(0);
    expect(after.seats[0].status).toBe("out");
    // Forfeiting a heads-up seat leaves exactly one funded seat, so the
    // match is decided the same instant, not on some later next-hand pass
    // nobody has any reason left to trigger (see the settlement test above).
    expect(after.tournament?.winnerProfileId).toBe(entrants[1].profile.id);

    const finished = applyPlayerAction(after, { type: "next-hand" }, tokens[1]);
    expect(finished.status).toBe("complete");
    expect(finished.tournament?.winnerProfileId).toBe(entrants[1].profile.id);
  });

  it("does not re-declare a winner once the match has already finished", () => {
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    game.status = "complete";
    game.tournament!.winnerProfileId = entrants[0].profile.id;
    game.tournament!.finishedAtHand = 3;

    const after = applyPlayerAction(game, { type: "leave-seat" }, tokens[1]);
    expect(after.tournament?.winnerProfileId).toBe(entrants[0].profile.id);
  });

  it("leaving after the match is decided does not zero the winner's own stack", () => {
    // The winner clicking "Leave table" off the win screen used to run
    // through the exact same forfeitTournamentSeat call as a real forfeit,
    // zeroing a stack that already reflected a paid-out win.
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    game.status = "complete";
    game.tournament!.winnerProfileId = entrants[0].profile.id;
    game.tournament!.finishedAtHand = 3;
    const stackBeforeLeaving = game.seats[0].stack;

    const after = applyPlayerAction(game, { type: "leave-seat" }, tokens[0]);
    expect(after.seats[0].stack).toBe(stackBeforeLeaving);
    expect(after.seats[0].status).toBe("out");
  });

  it("the last funded seat leaving with no winner named yet becomes the winner, not an orphaned zero", () => {
    // Reproduces the real stuck state this guards against: seat 1 already
    // forfeited/busted to zero with the match never finalized (a lost race,
    // or an out-of-order retry), then seat 0 -- the actual survivor -- also
    // calls leave-seat. The old unconditional forfeitTournamentSeat would
    // zero seat 0 too, leaving nobody funded and finalizeTournamentIfDecided
    // permanently unable to name a winner.
    const { tokens, entrants } = twoEntrants();
    const game = createHeadsUpGame(entrants, "1k");
    game.status = "complete";
    game.seats[1].stack = 0;
    game.seats[1].status = "out";

    const after = applyPlayerAction(game, { type: "leave-seat" }, tokens[0]);
    expect(after.seats[0].stack).toBeGreaterThan(0);
    expect(after.tournament?.winnerProfileId).toBe(entrants[0].profile.id);
  });
});
