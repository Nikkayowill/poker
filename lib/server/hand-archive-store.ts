import "server-only";
import { handReachedShowdown, seatCardsWereShown } from "@/lib/game/engine";
import type { Card, GameState, Winner } from "@/lib/game/types";
import { ensureProfile } from "./profile-store";
import { adminClient } from "./supabase-admin";

/** How much of a hand's log a replay keeps. Mirrors the migration's check constraint. */
const MAX_ARCHIVED_ACTIONS = 200;

/** One page of "my recent hands". Deliberately small: this is a review screen, not an export. */
export const HISTORY_PAGE_SIZE = 20;
const MAX_HISTORY_PAGE_SIZE = 50;

export interface ArchivedAction {
  at: string;
  text: string;
  kind: string;
}

export interface ArchivedPlayer {
  seatId: string;
  seatPosition: number;
  profileId: string | null;
  displayName: string;
  isHuman: boolean;
  /**
   * Null when this seat's cards are not the caller's to see. An empty array
   * means the seat was dealt in but holds no cards; the two are different
   * and the client renders them differently.
   */
  holeCards: Card[] | null;
  cardsWereShown: boolean;
  committed: number;
  amountWon: number;
  netProfit: number;
  isMine: boolean;
}

export interface ArchivedHand {
  gameId: string;
  handNumber: number;
  tier: string;
  community: Card[];
  pot: number;
  rake: number;
  winners: Winner[];
  reachedShowdown: boolean;
  finalVersion: number;
  endedAt: string;
}

export interface ArchivedHandDetail extends ArchivedHand {
  actions: ArchivedAction[];
  players: ArchivedPlayer[];
}

/** A row in the caller's history list: the hand, plus how it went for them. */
export interface HandHistoryEntry extends ArchivedHand {
  seatId: string;
  amountWon: number;
  netProfit: number;
  won: boolean;
}

export interface HandHistoryPage {
  entries: HandHistoryEntry[];
  /** Pass back as `cursor` for the next page; null when the list is exhausted. */
  nextCursor: string | null;
}

/**
 * A keyset cursor, not a timestamp.
 *
 * `ended_at` alone is not unique: two tables finishing a hand in the same
 * millisecond is ordinary, and a `< timestamp` cursor would then skip every
 * hand that tied with the last one on the page -- silently dropping hands
 * out of a player's history rather than failing visibly. The full sort key
 * is (ended_at desc, game_id, hand_number), so the cursor carries all three.
 */
interface HistoryCursor {
  endedAt: string;
  gameId: string;
  handNumber: number;
}

function encodeCursor(entry: HandHistoryEntry): string {
  return `${entry.endedAt}|${entry.gameId}|${entry.handNumber}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A timestamp as either Postgres or JS renders one, and nothing else.
 *
 * Matched rather than re-serialized through Date: Postgres timestamptz keeps
 * microseconds and a JS Date does not, so round-tripping the value would
 * truncate the cursor below the row it points at -- which reads as "skip
 * every hand in that microsecond window", the exact silent data loss the
 * keyset cursor exists to prevent. Notably contains no comma or parenthesis,
 * which is what makes it safe to interpolate into a PostgREST filter.
 */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;

/**
 * Parses a cursor, or returns null to mean "start from the top".
 *
 * Strict on purpose. These three values are interpolated into a PostgREST
 * `or(...)` filter, whose grammar is commas and parentheses -- so a cursor
 * is attacker-controlled filter syntax unless every field is checked against
 * a shape that cannot contain any. A malformed cursor is treated as absent
 * rather than as an error: the worst it costs is a first page.
 */
function decodeCursor(cursor: string | null): HistoryCursor | null {
  if (!cursor) return null;
  const parts = cursor.split("|");
  if (parts.length !== 3) return null;
  const [endedAt, gameId, handNumber] = parts;

  if (!UUID_PATTERN.test(gameId)) return null;
  if (!TIMESTAMP_PATTERN.test(endedAt)) return null;
  const parsedHand = Number(handNumber);
  if (!Number.isInteger(parsedHand) || parsedHand <= 0) return null;

  return { endedAt, gameId, handNumber: parsedHand };
}

/** Strictly after the cursor in (ended_at desc, game_id, hand_number) order. */
function isAfterCursor(entry: { endedAt: string; gameId: string; handNumber: number }, cursor: HistoryCursor) {
  if (entry.endedAt !== cursor.endedAt) return entry.endedAt < cursor.endedAt;
  if (entry.gameId !== cursor.gameId) return entry.gameId > cursor.gameId;
  return entry.handNumber > cursor.handNumber;
}

// ---- memory-mode mirror --------------------------------------------------
//
// Same twin-branch shape as lib/server/stats-store.ts: a real deployment
// writes through the archive_hand RPC, and local/dev/test runs against an
// in-process approximation so neither the app nor its tests need a live
// project. globalThis so it survives Next.js dev-mode module reloads.

/**
 * A seat row as stored: hole cards always present and never yet redacted.
 * Redaction is a property of a read by a particular caller, not of the row.
 */
type StoredPlayer = Omit<ArchivedPlayer, "isMine" | "holeCards"> & { holeCards: Card[] };

interface MemoryArchive {
  hand: ArchivedHand;
  actions: ArchivedAction[];
  players: StoredPlayer[];
}

declare global {
  var __riverRoomHandArchives: Map<string, MemoryArchive> | undefined;
}

const memoryArchives = globalThis.__riverRoomHandArchives ?? new Map<string, MemoryArchive>();
globalThis.__riverRoomHandArchives = memoryArchives;

function archiveKey(gameId: string, handNumber: number) {
  return `${gameId}:${handNumber}`;
}

// ---- writing ---------------------------------------------------------------

/**
 * Reduces a finished hand to the rows that outlive it.
 *
 * Everything here is read from the completed state, never re-derived later:
 * the live aggregate this came from is overwritten by the very next deal, so
 * anything not captured now is gone. That includes `cardsWereShown`, which
 * has to be decided while the seat statuses that justify it still exist.
 */
function buildArchiveRows(state: GameState, profileIdBySeatId: Map<string, string>) {
  const reachedShowdown = handReachedShowdown(state);
  const players = state.seats
    // Only seats actually dealt into this hand. A seat that busted before it
    // started, or was taken after it ended, was not in this hand at all.
    .filter((seat) => seat.holeCards.length > 0)
    .map((seat) => ({
      seatId: seat.id,
      seatPosition: seat.position,
      profileId: profileIdBySeatId.get(seat.id) ?? null,
      displayName: seat.name,
      isHuman: seat.isHuman,
      holeCards: seat.holeCards,
      cardsWereShown: seatCardsWereShown(state, seat),
      committed: seat.committed,
      amountWon: state.winners.find((winner) => winner.seatId === seat.id)?.amount ?? 0,
      netProfit: (state.winners.find((winner) => winner.seatId === seat.id)?.amount ?? 0) - seat.committed,
    }));

  const hand: ArchivedHand = {
    gameId: state.id,
    handNumber: state.handNumber,
    tier: state.tier,
    community: state.community,
    pot: state.pot,
    rake: state.rake,
    winners: state.winners,
    reachedShowdown,
    finalVersion: state.version,
    endedAt: new Date().toISOString(),
  };

  // Newest entries are the ones worth keeping if a pathological hand ever
  // overruns the cap -- the end of a hand is what a replay is about.
  const actions: ArchivedAction[] = state.log
    .slice(-MAX_ARCHIVED_ACTIONS)
    .map((entry) => ({ at: entry.at, text: entry.text, kind: entry.kind }));

  return { hand, actions, players };
}

/**
 * Archives one completed hand. Idempotent per (game, hand): the two
 * hand-completion paths can race, and a retry must be a no-op.
 *
 * Best-effort in the same sense as the other post-hand siblings -- see
 * lib/server/hand-completion.ts. A hand that fails to archive is a hand the
 * player cannot review later, which is worth logging and not worth failing a
 * poker action over.
 */
export async function archiveCompletedHand(state: GameState): Promise<void> {
  // Resolve every seated human to a profile first. Guests get a profile too;
  // whether they may *read* history is a separate question the API answers.
  const profileIdBySeatId = new Map<string, string>();
  for (const seat of state.seats) {
    if (!seat.isHuman || !seat.ownerToken || seat.holeCards.length === 0) continue;
    const profile = await ensureProfile(seat.ownerToken);
    profileIdBySeatId.set(seat.id, profile.id);
  }

  const { hand, actions, players } = buildArchiveRows(state, profileIdBySeatId);
  if (players.length === 0) return;

  const supabase = adminClient();
  if (!supabase) {
    const key = archiveKey(hand.gameId, hand.handNumber);
    if (memoryArchives.has(key)) return;
    memoryArchives.set(key, { hand, actions, players });
    return;
  }

  const { error } = await supabase.rpc("archive_hand", {
    p_game_id: hand.gameId,
    p_hand_number: hand.handNumber,
    p_tier: hand.tier,
    p_community: hand.community,
    p_pot: hand.pot,
    p_rake: hand.rake,
    p_winners: hand.winners,
    p_actions: actions,
    p_reached_showdown: hand.reachedShowdown,
    p_final_version: hand.finalVersion,
    p_players: players.map((player) => ({
      seat_id: player.seatId,
      seat_position: player.seatPosition,
      profile_id: player.profileId,
      display_name: player.displayName,
      is_human: player.isHuman,
      hole_cards: player.holeCards,
      cards_were_shown: player.cardsWereShown,
      committed: player.committed,
      amount_won: player.amountWon,
      net_profit: player.netProfit,
    })),
  });
  if (error) throw new Error(`Could not archive hand: ${error.message}`);
}

// ---- reading ---------------------------------------------------------------

/**
 * The redaction gate, and the only place hole cards leave this module.
 *
 * A caller always gets their own cards back. Anyone else's are returned only
 * if the table genuinely saw them -- `cardsWereShown`, decided at archive
 * time by lib/game/engine.ts's seatCardsWereShown. Replay must never show
 * what the felt did not: a hand folded to a river bet keeps its secret
 * permanently, and "it was ages ago" is not a reason to unmuck it.
 */
function redactPlayer(player: StoredPlayer, callerProfileId: string): ArchivedPlayer {
  const isMine = player.profileId !== null && player.profileId === callerProfileId;
  return {
    ...player,
    isMine,
    holeCards: isMine || player.cardsWereShown ? player.holeCards : null,
  };
}

export async function listHandHistory(
  profileId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<HandHistoryPage> {
  const limit = Math.min(Math.max(options.limit ?? HISTORY_PAGE_SIZE, 1), MAX_HISTORY_PAGE_SIZE);
  const cursor = decodeCursor(options.cursor ?? null);

  const supabase = adminClient();
  if (!supabase) {
    const rows = [...memoryArchives.values()]
      .flatMap((archive) =>
        archive.players
          .filter((player) => player.profileId === profileId)
          .map((player) => ({ archive, player })),
      )
      .sort((a, b) =>
        b.archive.hand.endedAt.localeCompare(a.archive.hand.endedAt)
        || a.archive.hand.gameId.localeCompare(b.archive.hand.gameId)
        || a.archive.hand.handNumber - b.archive.hand.handNumber)
      .filter(({ archive }) => (cursor ? isAfterCursor(archive.hand, cursor) : true));

    // One extra row tells us whether another page exists, without a count.
    const page = rows.slice(0, limit + 1);
    const entries = page.slice(0, limit).map(({ archive, player }): HandHistoryEntry => ({
      ...archive.hand,
      seatId: player.seatId,
      amountWon: player.amountWon,
      netProfit: player.netProfit,
      won: player.amountWon > 0,
    }));
    const last = entries[entries.length - 1];
    return {
      entries,
      nextCursor: page.length > limit && last ? encodeCursor(last) : null,
    };
  }

  // Two plain queries rather than one embedded select. hand_archive_players
  // references its parent on a *composite* key, and relying on PostgREST to
  // detect and embed that relationship is a dependency on schema-cache
  // behaviour for something a keyed lookup does plainly. The page is bounded
  // by `limit`, so this is two round trips, not N+1.
  let query = supabase
    .from("hand_archive_players")
    .select("game_id, hand_number, seat_id, amount_won, net_profit, ended_at")
    .eq("profile_id", profileId)
    .order("ended_at", { ascending: false })
    .order("game_id", { ascending: true })
    .order("hand_number", { ascending: true })
    .limit(limit + 1);
  if (cursor) {
    // The SQL keyset predicate, spelled in PostgREST: strictly past the
    // cursor on the leading column, or tied on it and past the next one.
    query = query.or(
      [
        `ended_at.lt.${cursor.endedAt}`,
        `and(ended_at.eq.${cursor.endedAt},game_id.gt.${cursor.gameId})`,
        `and(ended_at.eq.${cursor.endedAt},game_id.eq.${cursor.gameId},hand_number.gt.${cursor.handNumber})`,
      ].join(","),
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load hand history: ${error.message}`);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const pageRows = rows.slice(0, limit);
  if (pageRows.length === 0) return { entries: [], nextCursor: null };

  // Over-fetches slightly when a page spans several tables -- the cross
  // product of the ids, not the pairs -- which for a page of at most 50 is
  // cheaper than building a 50-clause or(...).
  const { data: archiveData, error: archiveError } = await supabase
    .from("hand_archives")
    .select("game_id, hand_number, tier, community, pot, rake, winners, reached_showdown, final_version")
    .in("game_id", [...new Set(pageRows.map((row) => String(row.game_id)))])
    .in("hand_number", [...new Set(pageRows.map((row) => Number(row.hand_number)))]);
  if (archiveError) throw new Error(`Could not load hand history: ${archiveError.message}`);

  const archivesByHand = new Map<string, Record<string, unknown>>();
  for (const archive of (archiveData ?? []) as unknown as Record<string, unknown>[]) {
    archivesByHand.set(`${String(archive.game_id)}:${Number(archive.hand_number)}`, archive);
  }

  const entries = pageRows.flatMap((row): HandHistoryEntry[] => {
    const gameId = String(row.game_id);
    const handNumber = Number(row.hand_number);
    const archive = archivesByHand.get(`${gameId}:${handNumber}`);
    // A seat row whose parent is gone should not happen -- the FK cascades
    // -- but dropping it beats rendering a hand with no board or pot.
    if (!archive) return [];
    return [{
      gameId,
      handNumber,
      tier: String(archive.tier),
      community: (archive.community ?? []) as Card[],
      pot: Number(archive.pot),
      rake: Number(archive.rake),
      winners: (archive.winners ?? []) as Winner[],
      reachedShowdown: Boolean(archive.reached_showdown),
      finalVersion: Number(archive.final_version),
      endedAt: String(row.ended_at),
      seatId: String(row.seat_id),
      amountWon: Number(row.amount_won),
      netProfit: Number(row.net_profit),
      won: Number(row.amount_won) > 0,
    }];
  });
  const last = entries[entries.length - 1];
  return {
    entries,
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

/**
 * One archived hand, redacted for this caller.
 *
 * Returns null when the hand does not exist *or* when the caller was not in
 * it. Those are deliberately the same answer: "that hand exists but is none
 * of yours" is itself information about a table the caller never sat at.
 */
export async function getArchivedHand(
  profileId: string,
  gameId: string,
  handNumber: number,
): Promise<ArchivedHandDetail | null> {
  const supabase = adminClient();
  if (!supabase) {
    const archive = memoryArchives.get(archiveKey(gameId, handNumber));
    if (!archive) return null;
    if (!archive.players.some((player) => player.profileId === profileId)) return null;
    return {
      ...archive.hand,
      actions: archive.actions,
      players: archive.players.map((player) => redactPlayer(player, profileId)),
    };
  }

  const { data: handRow, error: handError } = await supabase
    .from("hand_archives")
    .select("*")
    .eq("game_id", gameId)
    .eq("hand_number", handNumber)
    .maybeSingle();
  if (handError) throw new Error(`Could not load the hand: ${handError.message}`);
  if (!handRow) return null;

  const { data: playerRows, error: playerError } = await supabase
    .from("hand_archive_players")
    .select("*")
    .eq("game_id", gameId)
    .eq("hand_number", handNumber)
    .order("seat_position", { ascending: true });
  if (playerError) throw new Error(`Could not load the hand's players: ${playerError.message}`);

  const players = (playerRows ?? []).map((row) => ({
    seatId: String(row.seat_id),
    seatPosition: Number(row.seat_position),
    profileId: row.profile_id ? String(row.profile_id) : null,
    displayName: String(row.display_name),
    isHuman: Boolean(row.is_human),
    holeCards: (row.hole_cards ?? []) as Card[],
    cardsWereShown: Boolean(row.cards_were_shown),
    committed: Number(row.committed),
    amountWon: Number(row.amount_won),
    netProfit: Number(row.net_profit),
  }));

  // Authorization, and it has to happen before any redaction: a caller who
  // was not in this hand gets nothing, not a fully-mucked view of it.
  if (!players.some((player) => player.profileId === profileId)) return null;

  return {
    gameId: String(handRow.game_id),
    handNumber: Number(handRow.hand_number),
    tier: String(handRow.tier),
    community: (handRow.community ?? []) as Card[],
    pot: Number(handRow.pot),
    rake: Number(handRow.rake),
    winners: (handRow.winners ?? []) as Winner[],
    reachedShowdown: Boolean(handRow.reached_showdown),
    finalVersion: Number(handRow.final_version),
    endedAt: String(handRow.ended_at),
    actions: (handRow.actions ?? []) as ArchivedAction[],
    players: players.map((player) => redactPlayer(player, profileId)),
  };
}
