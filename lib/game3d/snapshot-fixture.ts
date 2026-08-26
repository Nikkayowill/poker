/**
 * Builders for fully-formed `GameSnapshot` objects without a server.
 *
 * Typed against the real wire types in lib/game/types.ts, so if the engine's
 * snapshot shape moves, these break at compile time — that is the guarantee
 * that the demo page and the scene-model tests exercise the same contract
 * the live bridge will receive. No engine runtime code is imported (the
 * engine pulls in node:crypto, which a client bundle must not).
 */

import type { Card, GameSnapshot, PublicSeat } from "../game/types";

export const FIXTURE_NAMES = [
  "You",
  "Marisol",
  "Dutch",
  "Kess",
  "Ambrose",
  "Tallulah",
];

const ACCENTS = ["#db9c0b", "#983fe0", "#dc1413", "#2f9a63", "#5b82c0", "#c96f1d"];

/**
 * Real catalogue character ids (public/table2d5/seats/<id>/0.webp via
 * avatarFigure/avatarFace), one per seat, so the demo renders six distinct
 * characters. Exported for the artifact bundle, which inlines exactly these
 * files as data URIs.
 */
export const FIXTURE_AVATARS = [
  "character4",
  "character5",
  "character6",
  "character7",
  "character8",
  "character9",
] as const;

export function makePublicSeat(overrides: Partial<PublicSeat> = {}): PublicSeat {
  const position = overrides.position ?? 0;
  return {
    id: `seat-${position}`,
    name: FIXTURE_NAMES[position % FIXTURE_NAMES.length],
    initials: "P?",
    accent: ACCENTS[position % ACCENTS.length],
    avatarUrl: null,
    avatarPreset: "classic",
    avatarCosmetic: FIXTURE_AVATARS[position % FIXTURE_AVATARS.length],
    cardBackCosmetic: "default",
    position,
    isHuman: position === 0,
    profileId: null,
    botIdentity: position === 0 ? null : position,
    personality: position === 0 ? null : "ROCK",
    stack: 1000,
    status: "active",
    holeCards: [],
    streetBet: 0,
    committed: 0,
    acted: false,
    actedAtBet: null,
    lastAction: null,
    missedTurns: 0,
    vpip: false,
    reseatEligibleAt: null,
    handLabel: null,
    isDealer: position === 1,
    isCurrent: false,
    isSmallBlind: position === 2,
    isBigBlind: position === 3,
    isMine: position === 0,
    isOpen: position !== 0,
    ...overrides,
  };
}

export function makeSixSeats(
  perSeat: (position: number) => Partial<PublicSeat> = () => ({})
): PublicSeat[] {
  return Array.from({ length: 6 }, (_, position) =>
    makePublicSeat({ position, ...perSeat(position) })
  );
}

export function makeGameSnapshot(
  overrides: Partial<GameSnapshot> = {}
): GameSnapshot {
  return {
    id: "demo-table",
    isPrivate: false,
    roomCode: null,
    tier: "1k",
    rake: 0,
    version: 1,
    status: "playing",
    street: "preflop",
    handNumber: 1,
    buttonPosition: 1,
    smallBlind: 5,
    bigBlind: 10,
    currentPlayer: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    nextHandAt: null,
    currentBet: 10,
    minRaise: 10,
    pot: 0,
    community: [],
    seats: makeSixSeats(),
    winners: [],
    log: [],
    message: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    legalActions: null,
    isSeated: true,
    tournament: null,
    ...overrides,
  };
}

export const card = (rank: Card["rank"], suit: Card["suit"]): Card => ({
  rank,
  suit,
});
