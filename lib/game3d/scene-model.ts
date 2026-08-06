/**
 * The bridge's pure half: derive everything the 3D room needs from one
 * redacted `GameSnapshot`. This is the entire coupling between the existing
 * engine and the 3D layer — the scene renders a `SceneModel` and never
 * touches engine state, so the engine stays read-only and the 3D layer can
 * be deleted without a trace.
 */

import type { Card, GameSnapshot, PublicSeat, Street } from "../game/types";
import { SEAT_COUNT_3D } from "./seat-layout";

/**
 * Sustained avatar moods. "Toss" is deliberately absent: it is a transient
 * triggered by a chip launch, owned by the scene's diffing layer, not
 * derivable from one snapshot in isolation.
 */
export type AvatarMood = "idle" | "thinking" | "celebrate";

export interface SeatModel {
  /** Spatial slot: 0 is the local player, nearest the camera. */
  slot: number;
  id: string;
  name: string;
  accent: string;
  stack: number;
  streetBet: number;
  status: PublicSeat["status"];
  isMine: boolean;
  isCurrent: boolean;
  isDealer: boolean;
  isWinner: boolean;
  winAmount: number;
  /** Redacted hole cards: null entries render as card backs. */
  holeCards: Array<Card | null>;
  /** True when this seat still holds live cards this hand. */
  inHand: boolean;
  mood: AvatarMood;
}

export interface SceneModel {
  gameId: string;
  handNumber: number;
  street: Street;
  status: GameSnapshot["status"];
  seats: SeatModel[];
  community: Card[];
  pot: number;
  /**
   * Chips resting in the centre pile: the pot minus every seat's standing
   * street bet. The felt's chips must always sum to the pot the HUD states —
   * the same invariant the 2D room pins with a unit test.
   */
  potResting: number;
  /** Slot of the seat currently acting, for head tracking; null between turns. */
  activeSlot: number | null;
  hasWinners: boolean;
}

function moodFor(seat: PublicSeat, isWinner: boolean, isCurrent: boolean): AvatarMood {
  if (isWinner) return "celebrate";
  if (isCurrent && seat.status === "active") return "thinking";
  return "idle";
}

/**
 * Derive the scene model. Seats are rotated so the requesting player's seat
 * lands in slot 0 (nearest the camera); a spectator sees the table from
 * seat order as-is.
 */
export function deriveSceneModel(game: GameSnapshot): SceneModel {
  const seats = game.seats.slice(0, SEAT_COUNT_3D);
  const mineIndex = seats.findIndex((seat) => seat.isMine);
  const rotateBy = mineIndex >= 0 ? mineIndex : 0;

  const winnersBySeat = new Map(game.winners.map((w) => [w.seatId, w.amount]));

  let activeSlot: number | null = null;
  const seatModels: SeatModel[] = seats.map((_, slot) => {
    const seat = seats[(slot + rotateBy) % seats.length];
    const winAmount = winnersBySeat.get(seat.id) ?? 0;
    const isWinner = winnersBySeat.has(seat.id);
    if (seat.isCurrent) activeSlot = slot;
    return {
      slot,
      id: seat.id,
      name: seat.name,
      accent: seat.accent,
      stack: seat.stack,
      streetBet: seat.streetBet,
      status: seat.status,
      isMine: seat.isMine,
      isCurrent: seat.isCurrent,
      isDealer: seat.isDealer,
      isWinner,
      winAmount,
      holeCards: seat.holeCards,
      inHand: seat.status === "active" || seat.status === "all-in",
      mood: moodFor(seat, isWinner, seat.isCurrent),
    };
  });

  const standingBets = seatModels.reduce((sum, seat) => sum + seat.streetBet, 0);

  return {
    gameId: game.id,
    handNumber: game.handNumber,
    street: game.street,
    status: game.status,
    seats: seatModels,
    community: game.community,
    pot: game.pot,
    potResting: Math.max(0, game.pot - standingBets),
    activeSlot,
    hasWinners: game.winners.length > 0,
  };
}
