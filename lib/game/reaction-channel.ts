/**
 * Wire contract for table reactions: cosmetic emoji a seated player can send
 * that show up beside their seat for everyone else for a couple of seconds,
 * then disappear. Never game state: no engine action, no version bump,
 * nothing durable written anywhere.
 *
 * This gets its own channel, `table:<gameId>:reactions`, rather than piggy-
 * backing on table-channel.ts's `table:<gameId>`. That channel says right in
 * its header comment that exactly one thing publishes to it (the
 * game_signals trigger) and its payload is just the version counter. A
 * reaction is neither of those things: it's sent straight from an API route
 * with nothing durable behind it, and it's meant to be shown as-is rather
 * than treated as "go re-fetch." Same public/no-RLS reasoning as that
 * channel though: StackChips' main player is a cookie-authenticated guest
 * with no JWT, and the cost is the same here too, a table UUID is 122 bits,
 * so all a guesser gets is which seat sent which emoji.
 */

export const REACTIONS = [
  { id: "angry", label: "Angry" },
  { id: "facepalm", label: "SMH" },
  { id: "tired", label: "Tired" },
  { id: "confused", label: "Why is this happening?" },
  { id: "nice_hand", label: "Nice hand" },
  { id: "lucky", label: "Got lucky" },
] as const;

export type ReactionId = (typeof REACTIONS)[number]["id"];

const REACTION_IDS: ReadonlySet<string> = new Set(REACTIONS.map((reaction) => reaction.id));

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === "string" && REACTION_IDS.has(value);
}

export function reactionLabel(id: ReactionId): string {
  return REACTIONS.find((reaction) => reaction.id === id)?.label ?? "Reaction";
}

export const PLAYER_REACTION = "PLAYER_REACTION";

/**
 * The server's per-seat cooldown window (enforced in the route, not here).
 * Shared so the client button's own cooldown can never be shorter than what
 * the server will actually accept, or a second tap would just silently
 * fail instead of doing anything.
 */
export const REACTION_COOLDOWN_MS = 2500;

/** How long a bubble stays on screen: fade in, hold, drift up, fade out. */
export const REACTION_BUBBLE_MS = 2200;

export function reactionChannelName(gameId: string): string {
  return `table:${gameId}:reactions`;
}

export interface PlayerReactionEvent {
  seatId: string;
  reactionId: ReactionId;
  sentAt: number;
}

/** Reads a broadcast payload into the envelope, or null if it isn't one. */
export function parsePlayerReaction(payload: unknown): PlayerReactionEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { seatId?: unknown; reactionId?: unknown; sentAt?: unknown };
  if (typeof body.seatId !== "string" || body.seatId === "") return null;
  if (!isReactionId(body.reactionId)) return null;
  const sentAt = typeof body.sentAt === "number" && Number.isFinite(body.sentAt)
    ? body.sentAt
    : Date.now();
  return { seatId: body.seatId, reactionId: body.reactionId, sentAt };
}
