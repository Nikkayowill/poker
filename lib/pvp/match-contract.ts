/**
 * The contract every duel implements, and the only thing the money layer knows
 * about a game.
 *
 * A duel is 1v1, staked, winner-take-all: both players ante the same amount,
 * the winner takes both, a draw returns each their own. lib/server/
 * pvp-match-service.ts implements that once, for every game, rather than once
 * per game: four (now five, with cribbage generalized to N) copies of one
 * money sequence is four chances to get it wrong instead of one.
 *
 * What a game supplies, and what it must not: a game supplies pure functions
 * over its own state type. Note what is absent from this interface: no
 * wallet, no store, no stake, no notion of who is paying. An engine cannot
 * pay anyone out, cannot read a balance, and cannot decide what a match is
 * worth. It answers exactly one question the money layer cares about,
 * `result()`, and everything else is presentation.
 *
 * On determinism: `createState` takes a seed rather than calling
 * Math.random(), for the reason lib/scene and lib/arcade/puzzles both give:
 * a game whose setup cannot be reproduced cannot be tested, and a shuffle a
 * client could predict is a shuffle a client will predict. The server draws
 * the seed from node:crypto and hands it in.
 *
 * `applyMove` takes `now` for the same reason. Trivia and Word Race are timed,
 * and an engine that read the clock itself could not be tested and would let
 * the client's clock decide a real payout.
 *
 * On hidden information: `snapshot` is a redaction boundary and a real one.
 * The stored state holds a trivia question's correct answer and a word
 * race's solution; the snapshot must not, until the round that used it is
 * over. It takes the viewer's seat because the two players may legitimately
 * see different things: your own submitted answer is yours to see, theirs
 * is not until the reveal. A game that returns the same object to both
 * seats is either symmetric by nature (chess, checkers) or has a bug.
 */

/** Which chair. Seat 0 moved first, holds white, was the challenger. */
export type DuelSeat = 0 | 1;

/**
 * The floor for a player-chosen wager.
 *
 * A duel used to price itself off the poker stakes ladder (TIER_CONFIG); now
 * the challenger names any amount, and this is the only limit: low enough
 * that a duel is not gated behind a table buy-in, high enough that it is
 * still a real stake against a friend rather than a rounding error.
 */
export const MIN_DUEL_STAKE = 500;

/**
 * How a match ended.
 *
 * `winner: null` is a draw, not "unfinished": an unfinished match returns
 * null from `result()` entirely rather than an outcome with no winner. The
 * money layer pays a draw by returning each player their own stake, so
 * conflating the two would pay out a game still in progress.
 */
export interface DuelOutcome {
  winner: DuelSeat | null;
  /**
   * One short line naming how it ended, for the result card: "Checkmate",
   * "Timeout", "Resigned", "3 - 2". Constants, not composed prose: the same
   * rule lib/arcade/dealer.ts's dealerLine follows, and for the same reason,
   * variable-length text on a fixed card clips.
   */
  reason: string;
}

/** An engine's answer to a move: the next state, or why it was refused. */
export type DuelMoveResult<TState> =
  | { next: TState }
  /**
   * The move is not legal. Becomes a 409 carrying the true state rather than
   * an exception, because the client is not broken, it is behind, and
   * returning the state unchanged instead would let a no-op look like a move.
   */
  | { reject: string };

export interface DuelGame<TState, TMove, TSnapshot> {
  /**
   * The `game` discriminator in pvp_matches and pvp_challenges. Free text
   * there, so this is the whole registration.
   */
  id: string;
  /** How the game is named in a sentence: "You have no Chess match in progress." */
  label: string;

  /**
   * The opening position.
   *
   * `seed` is a non-negative integer from the server's CSPRNG. A game with no
   * randomness in its setup (chess, checkers) ignores it; one that shuffles
   * questions or picks a word must use only this and never Math.random().
   */
  createState(seed: number, now: number): TState;

  /**
   * Applies one player's move.
   *
   * The engine owns turn order: a turn-based game rejects a move from the seat
   * that is not to act, and a simultaneous game (trivia, word race) accepts
   * either seat at any time. That is why the money layer never checks whose
   * turn it is: it does not know, and games disagree about whether the
   * question is even meaningful.
   *
   * `move` arrives shape-checked by the route's schema but is otherwise a
   * claim, not an instruction. Nothing before this has checked that the move
   * is legal, or that this player is allowed to make it.
   */
  applyMove(state: TState, seat: DuelSeat, move: TMove, now: number): DuelMoveResult<TState>;

  /**
   * Advances anything that happens on the clock rather than on a move: a
   * chess flag falling, a trivia question timing out.
   *
   * Returns null when nothing changed, which is the common case: the poll
   * calls this on every read, so a game that returns a fresh object each time
   * would bump the version on every client's every poll and livelock the
   * optimistic concurrency guard for both players.
   */
  tick?(state: TState, now: number): TState | null;

  /**
   * Whether the match is over, and how. Null means still playing.
   *
   * This is the only thing the money layer asks a game. It is called on the
   * state that has already been durably written, never on one just computed,
   * so a pot cannot be paid on a move the database refused.
   */
  result(state: TState): DuelOutcome | null;

  /**
   * What this viewer may see. The redaction boundary; see the header.
   *
   * `seat` is null for a spectator or an unauthenticated read, which must be
   * the most restrictive view, not the most permissive: defaulting an unknown
   * viewer to "sees everything" is how a second tab becomes a cheat.
   */
  snapshot(state: TState, seat: DuelSeat | null, now: number): TSnapshot;

  /**
   * What a player who abandons the match concedes.
   *
   * Defaults to a loss for the resigning seat, which is right for every game
   * shipped so far. It is overridable because a game where quitting mid-round
   * is not obviously a loss (a simultaneous game already tied on points) may
   * want to say otherwise.
   */
  resign?(state: TState, seat: DuelSeat, now: number): TState;
}

/**
 * The registry's view of a game with its type parameters erased.
 *
 * The service handles a match without knowing which game it is, so it needs a
 * shape it can hold in a Map. `unknown` rather than `any` throughout: every
 * call site here has already been type-checked against the real interface at
 * registration, and `any` would silently switch that checking off for the one
 * module where a wrong state type reaches the money.
 */
export type AnyDuelGame = DuelGame<unknown, unknown, unknown>;

/**
 * Registers a game, checking its types once, and hands back the erased form.
 *
 * The cast is confined to this one function on purpose. Every engine goes
 * through it, so each is checked against the real generic interface exactly
 * where it is written, and the registry holds only erased values, rather
 * than each of four engines casting itself and none of them being checked.
 */
export function defineDuelGame<TState, TMove, TSnapshot>(
  game: DuelGame<TState, TMove, TSnapshot>,
): AnyDuelGame {
  return game as AnyDuelGame;
}

/** The other chair. */
export function otherSeat(seat: DuelSeat): DuelSeat {
  return seat === 0 ? 1 : 0;
}
