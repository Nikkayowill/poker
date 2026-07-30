import "server-only";
import {
  advanceTimedTurn,
  applyPlayerAction,
  normalizeGameState,
} from "@/lib/game/engine";
import { DEFAULT_AVATAR_COSMETIC } from "@/lib/cosmetics/catalog";
import type {
  BotPersonality,
  GameState,
  PlayerAction,
  Seat as EngineSeat,
} from "@/lib/game/types";
import type {
  PlayerObject,
  SeatId,
  TableEnginePort,
  TablePhase,
} from "./types";

export interface RiverRoomPublicEventState {
  version: number;
  handNumber: number;
  status: GameState["status"];
  street: GameState["street"];
  phase: TablePhase;
  updatedAt: string;
}

const personalities: BotPersonality[] = [
  "ROCK",
  "MANIAC",
  "CALLING_STATION",
  "ROCK",
  "MANIAC",
  "CALLING_STATION",
];
const botAvatarPresets = [
  "lucky",
  "diamond",
  "bolt",
  "river",
  "ace",
  "crown",
] as const;

function seatIndex(seatId: SeatId): number {
  return seatId - 1;
}

function touch(state: GameState): GameState {
  state.version += 1;
  state.updatedAt = new Date().toISOString();
  return state;
}

function resetTransientSeatFields(seat: EngineSeat): void {
  seat.holeCards = [];
  seat.streetBet = 0;
  seat.committed = 0;
  seat.acted = false;
  seat.actedAtBet = null;
  seat.lastAction = null;
  seat.vpip = false;
}

function applyHumanIdentity(seat: EngineSeat, player: PlayerObject): void {
  seat.isHuman = true;
  seat.ownerToken = player.sessionToken;
  seat.personality = null;
  seat.name = player.displayName.slice(0, 18) || "Player";
  seat.initials = player.displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "P";
  seat.avatarUrl = null;
  seat.avatarPreset = "ace";
  seat.avatarCosmetic = DEFAULT_AVATAR_COSMETIC;
  seat.timeCardsRemaining = 3;
}

/**
 * Adapts the existing Texas Hold'em rules engine to the event-driven table
 * lifecycle. Each timer callback advances at most one action.
 */
export const riverRoomEngineAdapter: TableEnginePort<
  GameState,
  PlayerAction,
  RiverRoomPublicEventState
> = {
  isHandActive(state) {
    return state.status === "playing";
  },

  currentTurn(state) {
    normalizeGameState(state);
    if (
      state.status !== "playing" ||
      state.currentPlayer === null ||
      !state.turnDeadlineAt
    ) {
      return null;
    }
    const deadlineAt = Date.parse(state.turnDeadlineAt);
    if (!Number.isFinite(deadlineAt)) return null;
    return {
      seatId: (state.currentPlayer + 1) as SeatId,
      isHuman: state.seats[state.currentPlayer]?.isHuman ?? false,
      deadlineAt,
    };
  },

  applyHumanAction(state, player, action) {
    if (
      action.type === "next-hand" ||
      action.type === "leave-seat" ||
      action.type === "rebuy"
    ) {
      throw new Error("The table lifecycle owns that action.");
    }
    return applyPlayerAction(state, action, player.sessionToken);
  },

  applyTimedAction(state, now) {
    const result = advanceTimedTurn(state, now);
    return {
      state: result.state,
      applied: result.action !== null,
    };
  },

  startNextHand(state, humans) {
    const caller = humans.find((player) =>
      state.seats.some((seat) => seat.ownerToken === player.sessionToken),
    );
    if (!caller) throw new Error("A funded human must own a seat before dealing.");
    return applyPlayerAction(state, { type: "next-hand" }, caller.sessionToken);
  },

  seatHuman(state, seatId, player, waitForNextHand) {
    const seat = state.seats[seatIndex(seatId)];
    if (!seat) throw new Error(`Seat ${seatId} does not exist.`);
    applyHumanIdentity(seat, player);
    seat.stack = player.currentChips;
    if (waitForNextHand) {
      // Preserve any chips already committed by the departed occupant until
      // payout, but keep the incoming human out of the in-flight hand.
      seat.status = "folded";
      seat.holeCards = [];
      seat.acted = true;
      seat.lastAction = "Waiting for next hand";
    } else {
      seat.status = player.currentChips > 0 ? "active" : "out";
      resetTransientSeatFields(seat);
    }
    return touch(state);
  },

  removeHuman(state, seatId, player, handActive) {
    const index = seatIndex(seatId);
    let seat = state.seats[index];
    if (!seat || seat.ownerToken !== player.sessionToken) return state;

    if (
      handActive &&
      state.currentPlayer === index &&
      seat.status === "active"
    ) {
      state = applyPlayerAction(state, { type: "fold" }, player.sessionToken);
      seat = state.seats[index];
    } else if (handActive && seat.status === "active") {
      seat.status = "folded";
      seat.acted = true;
      seat.lastAction = "Left table · Fold";
    } else {
      seat.status = "out";
      resetTransientSeatFields(seat);
    }

    seat.isHuman = false;
    seat.ownerToken = null;
    seat.personality = personalities[index] ?? "ROCK";
    seat.stack = 0;
    seat.timeCardsRemaining = 0;
    return touch(state);
  },

  seatBot(state, seatId, bot) {
    const index = seatIndex(seatId);
    const seat = state.seats[index];
    if (!seat) throw new Error(`Seat ${seatId} does not exist.`);
    seat.isHuman = false;
    seat.ownerToken = null;
    seat.personality = personalities[index] ?? "ROCK";
    seat.name = bot.displayName.slice(0, 18);
    seat.initials = bot.displayName.slice(0, 2).toUpperCase();
    seat.avatarUrl = null;
    seat.avatarPreset = botAvatarPresets[index] ?? "ace";
    seat.avatarCosmetic = DEFAULT_AVATAR_COSMETIC;
    seat.stack = bot.currentChips;
    seat.status = bot.currentChips > 0 ? "active" : "out";
    seat.timeCardsRemaining = 0;
    resetTransientSeatFields(seat);
    return touch(state);
  },

  removeBot(state, seatId) {
    const seat = state.seats[seatIndex(seatId)];
    if (!seat) return state;
    seat.stack = 0;
    seat.status = "out";
    resetTransientSeatFields(seat);
    return touch(state);
  },

  currentChips(state, seatId) {
    return Math.max(0, state.seats[seatIndex(seatId)]?.stack ?? 0);
  },

  winningSeatIds(state) {
    const winners = new Set(state.winners.map((winner) => winner.seatId));
    return state.seats.flatMap((seat, index) =>
      winners.has(seat.id) ? [((index + 1) as SeatId)] : [],
    );
  },

  handKey(state) {
    return `${state.id}:${state.handNumber}`;
  },

  publicState(state, phase) {
    return {
      version: state.version,
      handNumber: state.handNumber,
      status: state.status,
      street: state.street,
      phase,
      updatedAt: state.updatedAt,
    };
  },
};
