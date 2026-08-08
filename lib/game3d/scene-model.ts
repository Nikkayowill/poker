/**
 * The bridge's pure half: derive everything the 3D room needs from one
 * redacted `GameSnapshot`. This is the entire coupling between the existing
 * engine and the 3D layer — the scene renders a `SceneModel` and never
 * touches engine state, so the engine stays read-only and the 3D layer can
 * be deleted without a trace.
 */

import type { Card, GameSnapshot, PublicSeat, Street } from "../game/types";
import type { StakesTier } from "../game/tiers";
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
  /** Equipped avatar cosmetic id — the illustrated character at this seat. */
  avatarCosmetic: string;
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
  /** This table's stakes rung — fixes every seat's buy-in, and the
   * bankroll props' baseline pile size (see lib/game3d/chip-props.ts). */
  tier: StakesTier;
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

/**
 * True when a seat is holding live cards nobody has seen yet — both
 * entries redacted to null. This is the one predicate the modelled
 * face-down prop (components/game3d/props/hole-card-prop.tsx) and the
 * atlas card renderer (scene/cards-instanced.tsx) both key off, so which
 * of the two owns a given seat can never drift out of step: the prop
 * draws exactly the seats this returns true for (never the local
 * player's own, which is DOM — see hud/own-hole-cards.tsx), and the atlas
 * draws every other in-hand seat, i.e. a revealed showdown hand.
 */
export function seatHoleCardsHidden(seat: SeatModel): boolean {
  return (
    seat.inHand &&
    seat.holeCards.length > 0 &&
    seat.holeCards.every((card) => card === null)
  );
}

/**
 * Does this seat have a pair lying ON THE CLOTH?
 *
 * The local player's does not: their hand is DOM, drawn large and upright in
 * front of the rail (hud/own-hole-cards.tsx), and nothing of it touches the
 * felt. Every other in-hand seat's does — face-down as the modelled prop, or
 * face-up through the atlas once a showdown reveals it.
 *
 * This exists because THREE files had to agree on that and only two of them
 * did. The two renderers each excluded the local seat in their own way, while
 * scene/fake-shadows.tsx looped over every in-hand seat and grounded one — so
 * slot 0 got a soft dark decal painted on the felt under cards that were never
 * there, sitting in the middle of the player's own view. `seatHoleCardsHidden`
 * above answers "which of the two renderers owns this seat"; this answers the
 * prior question of whether the felt has anything to draw or shade at all, so
 * a fourth consumer cannot reintroduce the same disagreement.
 */
export function seatHasFeltCards(seat: SeatModel): boolean {
  return !seat.isMine && seat.inHand && seat.holeCards.length > 0;
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
      avatarCosmetic: seat.avatarCosmetic,
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
    tier: game.tier,
    seats: seatModels,
    community: game.community,
    pot: game.pot,
    potResting: Math.max(0, game.pot - standingBets),
    activeSlot,
    hasWinners: game.winners.length > 0,
  };
}
