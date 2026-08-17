import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseBotAction,
  createGame,
  dealNextHandIfDue,
} from "./engine";
import type { BotPersonality, Card, GameState, Rank, Suit } from "./types";

/**
 * Bot personality: weighted assignment, and the preflop looseness that
 * actually drives VPIP apart per archetype.
 *
 * Personality now rolls independently per seat (see `pickBotPersonality` in
 * engine.ts) rather than being baked onto a fixed pool-identity pattern, so
 * "does the distribution land near 35/45/20" and "does each archetype
 * actually play a different range" both need a statistical test rather than
 * a single deterministic assertion -- eyeballing the tuning constants isn't
 * enough to know they hit the requested VPIP bands.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const fullDeck = (): Card[] => SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));

const seededRandom = (initialSeed: number) => {
  let seed = initialSeed;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

function randomHoleCards(random: () => number): Card[] {
  const deck = fullDeck();
  const first = deck.splice(Math.floor(random() * deck.length), 1)[0];
  const second = deck.splice(Math.floor(random() * deck.length), 1)[0];
  return [first, second];
}

/**
 * A bot, first to act preflop, facing exactly the big blind -- the plainest
 * "does this hand voluntarily enter the pot" decision there is, which is
 * exactly what VPIP measures.
 */
function facingOpenPot(personality: BotPersonality, holeCards: Card[]): GameState {
  const game = createGame(crypto.randomUUID(), "Host");
  game.seats.forEach((seat, index) => {
    seat.status = index === 0 || index === 3 ? "active" : "folded";
  });
  Object.assign(game.seats[3], {
    holeCards,
    stack: 1000,
    streetBet: 0,
    committed: 0,
    acted: false,
    actedAtBet: null,
    personality,
  });
  game.currentPlayer = 3;
  game.street = "preflop";
  game.currentBet = game.bigBlind;
  game.minRaise = game.bigBlind;
  game.pot = game.smallBlind + game.bigBlind;
  return game;
}

function measureVpip(personality: BotPersonality, trials: number, seedBase: number): number {
  let continued = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const random = seededRandom(seedBase + trial);
    const game = facingOpenPot(personality, randomHoleCards(random));
    if (chooseBotAction(game, 3, random).type !== "fold") continued += 1;
  }
  return continued / trials;
}

describe("personality assignment", () => {
  it("rolls MANIAC/ROCK/CALLING_STATION independently of seat, roughly 35/45/20", () => {
    const tally: Record<BotPersonality, number> = { MANIAC: 0, ROCK: 0, CALLING_STATION: 0 };
    const trials = 2000;
    for (let trial = 0; trial < trials; trial += 1) {
      const game = createGame(crypto.randomUUID(), "Host");
      game.seats.slice(1).forEach((seat) => {
        tally[seat.personality as BotPersonality] += 1;
      });
    }
    const total = trials * 5; // five bot seats per table
    const share = (personality: BotPersonality) => tally[personality] / total;
    // Generous absolute tolerance: this is a statistical draw, not a fixed
    // sequence, and the point is catching a badly broken weighting (e.g. an
    // even 3-way split, or a personality that never appears), not pinning
    // the exact percentages.
    expect(share("MANIAC")).toBeGreaterThan(0.28);
    expect(share("MANIAC")).toBeLessThan(0.42);
    expect(share("ROCK")).toBeGreaterThan(0.37);
    expect(share("ROCK")).toBeLessThan(0.53);
    expect(share("CALLING_STATION")).toBeGreaterThan(0.14);
    expect(share("CALLING_STATION")).toBeLessThan(0.26);
  });
});

describe("preflop looseness by personality (VPIP)", () => {
  // Wide-ish bands around the requested ranges (Loose Cannon 40-50%, Table
  // Captain 25-35%, Whale 60%+): this measures a Monte Carlo estimate over
  // random hole cards and a randomized decision engine, not a closed-form
  // number, so the band has to tolerate real sampling variance rather than
  // pin an exact figure that would make this test flaky.
  const TRIALS = 800;
  const VPIP_TEST_TIMEOUT_MS = 15_000;

  // Calibrated against the tuning in `personalityProfiles`: at these seeds
  // and this trial count, ROCK/MANIAC/CALLING_STATION measure roughly
  // 0.26/0.45/0.64. Every call here is fully deterministic (seeded hole
  // cards, seeded decision rolls, personality pinned rather than drawn), so
  // these bounds aren't chasing run-to-run noise -- they're a margin around
  // an exact, reproducible number, wide enough to survive a deliberate
  // future retune without being so wide it stops catching a broken one.
  it("keeps the Table Captain (ROCK) disciplined", () => {
    const vpip = measureVpip("ROCK", TRIALS, 1_000);
    expect(vpip).toBeGreaterThan(0.18);
    expect(vpip).toBeLessThan(0.38);
  }, VPIP_TEST_TIMEOUT_MS);

  it("makes the Loose Cannon (MANIAC) noticeably wider", () => {
    const vpip = measureVpip("MANIAC", TRIALS, 2_000);
    expect(vpip).toBeGreaterThan(0.35);
    expect(vpip).toBeLessThan(0.55);
  }, VPIP_TEST_TIMEOUT_MS);

  it("makes the Whale (CALLING_STATION) play almost everything", () => {
    const vpip = measureVpip("CALLING_STATION", TRIALS, 3_000);
    expect(vpip).toBeGreaterThan(0.55);
  }, VPIP_TEST_TIMEOUT_MS);

  it("orders the three archetypes Whale > Loose Cannon > Table Captain", () => {
    const rock = measureVpip("ROCK", TRIALS, 4_000);
    const maniac = measureVpip("MANIAC", TRIALS, 5_000);
    const whale = measureVpip("CALLING_STATION", TRIALS, 6_000);
    expect(whale).toBeGreaterThan(maniac);
    expect(maniac).toBeGreaterThan(rock);
  }, VPIP_TEST_TIMEOUT_MS);
});

describe("table traffic: staggered bot re-entry", () => {
  /**
   * A table where every bot seat is funded above the minimum, so a
   * voluntary departure is unambiguous (stack goes from well above zero to
   * zero, not from an already-thin stack), sitting at a finished hand with a
   * due deadline. Matches the `dueForTheNextHand`-style pattern used
   * elsewhere in this suite (e.g. `busted-seat.test.ts`) rather than
   * routing through `scheduleNextHand`, so the deadline is exact and not
   * incidentally dependent on `NEXT_HAND_DELAY_MS`.
   */
  function fundedTableDueNow(now: number): GameState {
    const game = createGame(crypto.randomUUID(), "Host");
    game.seats.forEach((seat) => {
      if (!seat.isHuman) seat.stack = 2_000;
    });
    game.status = "complete";
    game.nextHandAt = new Date(now - 1).toISOString();
    return game;
  }

  it("does nothing when the leave chance is zero (the VITEST-gated default)", () => {
    const now = Date.now();
    const game = fundedTableDueNow(now);
    const { state, dealt } = dealNextHandIfDue(game, now);
    expect(dealt).toBe(true);
    expect(state.seats.every((seat) => seat.isHuman || seat.stack > 0)).toBe(true);
    expect(state.seats.every((seat) => seat.reseatEligibleAt === null)).toBe(true);
  });

  it("empties a seat immediately but does not refill it before the stagger elapses", () => {
    vi.stubEnv("RIVER_BOT_LEAVE_CHANCE", "1");
    vi.stubEnv("RIVER_BOT_REENTRY_DELAY_MIN_MS", "60000");
    vi.stubEnv("RIVER_BOT_REENTRY_DELAY_MAX_MS", "60000");
    const now = Date.now();
    const game = fundedTableDueNow(now);
    const startingBotCount = game.seats.filter((seat) => !seat.isHuman).length;

    const { state: departed } = dealNextHandIfDue(game, now);
    // At least one healthy bot stood up: some seat is now out, staying human
    // count unchanged (nobody claimed it, it's just empty-feeling).
    const emptied = departed.seats.filter((seat) => !seat.isHuman && seat.stack <= 0);
    expect(emptied.length).toBeGreaterThan(0);
    emptied.forEach((seat) => {
      expect(seat.status).toBe("out");
      expect(seat.reseatEligibleAt).not.toBeNull();
      expect(Date.parse(seat.reseatEligibleAt!)).toBeGreaterThan(now);
    });
    expect(departed.seats.filter((seat) => !seat.isHuman).length).toBe(startingBotCount);

    // Well before the 60s stagger elapses, another hand deals (the table
    // stays playable via its still-funded seats) but the emptied seat stays
    // empty.
    departed.status = "complete";
    departed.nextHandAt = new Date(now + 2_000 - 1).toISOString();
    const { state: stillEmpty } = dealNextHandIfDue(departed, now + 2_000);
    const stillOut = stillEmpty.seats.filter((seat) => !seat.isHuman && seat.stack <= 0);
    expect(stillOut.length).toBeGreaterThan(0);
  });

  it("refills the seat once the stagger elapses", () => {
    vi.stubEnv("RIVER_BOT_LEAVE_CHANCE", "1");
    vi.stubEnv("RIVER_BOT_REENTRY_DELAY_MIN_MS", "1000");
    vi.stubEnv("RIVER_BOT_REENTRY_DELAY_MAX_MS", "1000");
    const now = Date.now();
    const game = fundedTableDueNow(now);
    const { state: departed } = dealNextHandIfDue(game, now);
    const emptiedSeatId = departed.seats.find((seat) => !seat.isHuman && seat.stack <= 0)!.id;
    const reseatEligibleAt = Date.parse(
      departed.seats.find((seat) => seat.id === emptiedSeatId)!.reseatEligibleAt!,
    );

    // Disable further departures so only the refill is under test, then jump
    // past the stagger and let the table deal again.
    vi.stubEnv("RIVER_BOT_LEAVE_CHANCE", "0");
    departed.status = "complete";
    departed.nextHandAt = new Date(reseatEligibleAt + 5_000 - 1).toISOString();
    const { state: refilled } = dealNextHandIfDue(departed, reseatEligibleAt + 5_000);
    const seat = refilled.seats.find((candidate) => candidate.id === emptiedSeatId)!;
    expect(seat.stack).toBeGreaterThan(0);
    expect(seat.reseatEligibleAt).toBeNull();
  });
});
