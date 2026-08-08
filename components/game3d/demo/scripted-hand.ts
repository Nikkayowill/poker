/**
 * A scripted hand for the /game3d demo route: a branching sequence of fully
 * formed `GameSnapshot`s, typed against the real wire contract, so the
 * bridge is exercised by exactly the shape the live API returns. The chip
 * sums are kept honest at every step (pot always equals blinds + bets in),
 * because the scene asserts its felt-sums-to-pot invariant against them.
 *
 * Steps advance on a timer; a step carrying `next` pauses the script until
 * the player chooses Fold / Call / Raise in the HUD, then continues down
 * that branch — the demo is a puppet show, but your seat is a real choice.
 */

import type { Card, GameSnapshot, LegalActions, PublicSeat } from "@/lib/game/types";
import {
  FIXTURE_NAMES,
  card,
  makeGameSnapshot,
  makeSixSeats,
} from "@/lib/game3d/snapshot-fixture";

export type DemoAction = "fold" | "call" | "raise";

export interface DemoStep {
  snapshot: GameSnapshot;
  holdMs: number;
  /** Present on a step that waits for the player; builds the continuation. */
  next?: (action: DemoAction) => DemoStep[];
}

const MY_HOLE: Card[] = [card("A", "spades"), card("K", "spades")];
const FLOP: Card[] = [card("A", "hearts"), card("7", "diamonds"), card("K", "diamonds")];
const TURN = card("2", "clubs");
const RIVER = card("9", "hearts");
const VILLAIN_HOLE: Card[] = [card("Q", "diamonds"), card("J", "diamonds")];

const HIDDEN: Array<Card | null> = [null, null];

interface SeatTweak {
  streetBet?: number;
  stack?: number;
  status?: PublicSeat["status"];
  lastAction?: string | null;
  isCurrent?: boolean;
  holeCards?: Array<Card | null>;
}

function buildSeats(tweaks: Record<number, SeatTweak>): PublicSeat[] {
  return makeSixSeats((position) => {
    const tweak = tweaks[position] ?? {};
    const inHand = tweak.status !== "folded";
    return {
      streetBet: 0,
      stack: 1000,
      isCurrent: false,
      holeCards: position === 0 ? MY_HOLE : inHand ? HIDDEN : [],
      ...tweak,
    };
  });
}

function myLegalActions(toCall: number, myStack: number): LegalActions {
  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    canRaise: true,
    canAllIn: true,
    toCall,
    callAmount: toCall,
    minRaiseTo: toCall * 2 || 20,
    maxRaiseTo: myStack,
    // The demo's numbers are illustrative; the engine owns the real ones.
  };
}

/** The hand up to the player's first decision. */
export function openingSteps(handNumber: number): DemoStep[] {
  const base = { handNumber, version: handNumber * 100 };

  const blinds: DemoStep = {
    holdMs: 1700,
    snapshot: makeGameSnapshot({
      ...base,
      street: "preflop",
      pot: 15,
      currentPlayer: 4,
      message: "Blinds posted.",
      seats: buildSeats({
        2: { streetBet: 5, stack: 995, lastAction: "small blind" },
        3: { streetBet: 10, stack: 990, lastAction: "big blind" },
        4: { isCurrent: true },
      }),
    }),
  };

  const villainRaise: DemoStep = {
    holdMs: 1500,
    snapshot: makeGameSnapshot({
      ...base,
      version: base.version + 1,
      street: "preflop",
      pot: 45,
      currentPlayer: 5,
      message: `${FIXTURE_NAMES[4]} raises to 30.`,
      seats: buildSeats({
        2: { streetBet: 5, stack: 995 },
        3: { streetBet: 10, stack: 990 },
        4: { streetBet: 30, stack: 970, lastAction: "raise 30" },
        5: { isCurrent: true },
      }),
    }),
  };

  const myTurn: DemoStep = {
    holdMs: 0,
    next: (action) => preflopContinuation(handNumber, action),
    snapshot: makeGameSnapshot({
      ...base,
      version: base.version + 2,
      street: "preflop",
      pot: 45,
      currentPlayer: 0,
      message: "Your action.",
      legalActions: myLegalActions(30, 1000),
      seats: buildSeats({
        0: { isCurrent: true },
        2: { streetBet: 5, stack: 995 },
        3: { streetBet: 10, stack: 990 },
        4: { streetBet: 30, stack: 970 },
        5: { status: "folded", lastAction: "fold" },
      }),
    }),
  };

  return [blinds, villainRaise, myTurn];
}

function foldOut(handNumber: number, pot: number, myTweak: SeatTweak): DemoStep[] {
  return [
    {
      holdMs: 3200,
      snapshot: makeGameSnapshot({
        handNumber,
        version: handNumber * 100 + 10,
        street: "preflop",
        status: "complete",
        pot,
        message: `${FIXTURE_NAMES[4]} takes it down.`,
        winners: [
          {
            seatId: "seat-4",
            name: FIXTURE_NAMES[4],
            amount: pot,
            hand: "Uncontested",
            bestFive: null,
          },
        ],
        seats: buildSeats({
          0: { status: "folded", lastAction: "fold", ...myTweak },
          1: { status: "folded" },
          2: { status: "folded", stack: 995 },
          3: { status: "folded", stack: 990 },
          4: { stack: 970 + pot, lastAction: null },
          5: { status: "folded" },
        }),
      }),
    },
  ];
}

function preflopContinuation(handNumber: number, action: DemoAction): DemoStep[] {
  if (action === "fold") {
    return foldOut(handNumber, 45, {});
  }
  // Call flat 30, or raise to 90 and the villain calls.
  const myBet = action === "call" ? 30 : 90;
  const villainBet = myBet;
  const potAfter = 15 + myBet + villainBet;
  const myStack = 1000 - myBet;
  const villainStack = 1000 - villainBet;
  const version = handNumber * 100 + 20;

  const myMove: DemoStep = {
    holdMs: 1300,
    snapshot: makeGameSnapshot({
      handNumber,
      version,
      street: "preflop",
      pot: 15 + myBet + 30,
      currentPlayer: 4,
      message: action === "call" ? "You call 30." : "You raise to 90.",
      seats: buildSeats({
        0: { streetBet: myBet, stack: myStack, lastAction: action },
        1: { status: "folded", lastAction: "fold" },
        2: { streetBet: 5, stack: 995, status: "folded", lastAction: "fold" },
        3: { streetBet: 10, stack: 990, status: "folded", lastAction: "fold" },
        4: { streetBet: 30, stack: 970, isCurrent: true },
        5: { status: "folded" },
      }),
    }),
  };

  // On the raise branch the villain's call gets its own step, so those
  // chips fly into their spot instead of teleporting into the pot at the
  // street turn.
  const villainCalls: DemoStep | null =
    action === "raise"
      ? {
          holdMs: 1200,
          snapshot: makeGameSnapshot({
            handNumber,
            version: version + 5,
            street: "preflop",
            pot: potAfter,
            currentPlayer: null,
            message: `${FIXTURE_NAMES[4]} calls.`,
            seats: buildSeats({
              0: { streetBet: myBet, stack: myStack },
              1: { status: "folded" },
              2: { streetBet: 5, stack: 995, status: "folded" },
              3: { streetBet: 10, stack: 990, status: "folded" },
              4: { streetBet: villainBet, stack: villainStack, lastAction: "call" },
              5: { status: "folded" },
            }),
          }),
        }
      : null;

  const flop: DemoStep = {
    holdMs: 1900,
    snapshot: makeGameSnapshot({
      handNumber,
      version: version + 1,
      street: "flop",
      pot: potAfter,
      community: FLOP,
      currentPlayer: 4,
      message: "Flop.",
      seats: buildSeats({
        0: { stack: myStack },
        1: { status: "folded" },
        2: { status: "folded", stack: 995 },
        3: { status: "folded", stack: 990 },
        4: { stack: villainStack, isCurrent: true },
        5: { status: "folded" },
      }),
    }),
  };

  const villainFlopBet = 60;
  const villainBets: DemoStep = {
    holdMs: 0,
    next: (flopAction) =>
      flopContinuation(handNumber, flopAction, potAfter, myStack, villainStack),
    snapshot: makeGameSnapshot({
      handNumber,
      version: version + 2,
      street: "flop",
      pot: potAfter + villainFlopBet,
      community: FLOP,
      currentPlayer: 0,
      message: `${FIXTURE_NAMES[4]} bets ${villainFlopBet}. Your action.`,
      legalActions: myLegalActions(villainFlopBet, myStack),
      seats: buildSeats({
        0: { stack: myStack, isCurrent: true },
        1: { status: "folded" },
        2: { status: "folded", stack: 995 },
        3: { status: "folded", stack: 990 },
        4: { streetBet: villainFlopBet, stack: villainStack - villainFlopBet, lastAction: "bet 60" },
        5: { status: "folded" },
      }),
    }),
  };

  return villainCalls
    ? [myMove, villainCalls, flop, villainBets]
    : [myMove, flop, villainBets];
}

function flopContinuation(
  handNumber: number,
  action: DemoAction,
  potAfterPreflop: number,
  myStack: number,
  villainStack: number
): DemoStep[] {
  const version = handNumber * 100 + 30;
  const villainFlopBet = 60;

  if (action === "fold") {
    const pot = potAfterPreflop + villainFlopBet;
    return [
      {
        holdMs: 3200,
        snapshot: makeGameSnapshot({
          handNumber,
          version,
          street: "flop",
          status: "complete",
          pot,
          community: FLOP,
          message: `${FIXTURE_NAMES[4]} takes it down.`,
          winners: [
            {
              seatId: "seat-4",
              name: FIXTURE_NAMES[4],
              amount: pot,
              hand: "Uncontested",
              bestFive: null,
            },
          ],
          seats: buildSeats({
            0: { stack: myStack, status: "folded", lastAction: "fold" },
            1: { status: "folded" },
        2: { status: "folded", stack: 995 },
            3: { status: "folded", stack: 990 },
            4: { stack: villainStack - villainFlopBet + pot },
            5: { status: "folded" },
          }),
        }),
      },
    ];
  }

  // Call (a raise plays out the same runout with a bigger pot).
  const myFlopPut = action === "call" ? villainFlopBet : villainFlopBet * 2.5;
  const villainPut = myFlopPut; // villain matches a raise
  const potAfterFlop = potAfterPreflop + myFlopPut + villainPut;
  const myStackAfter = myStack - myFlopPut;
  const villainAfter = villainStack - villainPut;

  const turn: DemoStep = {
    holdMs: 1800,
    snapshot: makeGameSnapshot({
      handNumber,
      version: version + 1,
      street: "turn",
      pot: potAfterFlop,
      community: [...FLOP, TURN],
      message: "Turn. Checked through.",
      seats: buildSeats({
        0: { stack: myStackAfter },
        1: { status: "folded" },
        2: { status: "folded", stack: 995 },
        3: { status: "folded", stack: 990 },
        4: { stack: villainAfter },
        5: { status: "folded" },
      }),
    }),
  };

  const river: DemoStep = {
    holdMs: 1800,
    snapshot: makeGameSnapshot({
      handNumber,
      version: version + 2,
      street: "river",
      pot: potAfterFlop,
      community: [...FLOP, TURN, RIVER],
      message: "River.",
      seats: buildSeats({
        0: { stack: myStackAfter },
        1: { status: "folded" },
        2: { status: "folded", stack: 995 },
        3: { status: "folded", stack: 990 },
        4: { stack: villainAfter },
        5: { status: "folded" },
      }),
    }),
  };

  const showdown: DemoStep = {
    holdMs: 4200,
    snapshot: makeGameSnapshot({
      handNumber,
      version: version + 3,
      street: "showdown",
      status: "complete",
      pot: potAfterFlop,
      community: [...FLOP, TURN, RIVER],
      message: "You win with two pair, aces and kings.",
      winners: [
        {
          seatId: "seat-0",
          name: FIXTURE_NAMES[0],
          amount: potAfterFlop,
          hand: "Two Pair, Aces and Kings",
          bestFive: [MY_HOLE[0], FLOP[0], MY_HOLE[1], FLOP[2], RIVER],
        },
      ],
      seats: buildSeats({
        0: { stack: myStackAfter + potAfterFlop, lastAction: null },
        1: { status: "folded" },
        2: { status: "folded", stack: 995 },
        3: { status: "folded", stack: 990 },
        4: { stack: villainAfter, holeCards: VILLAIN_HOLE, lastAction: "show" },
        5: { status: "folded" },
      }),
    }),
  };

  return [turn, river, showdown];
}
