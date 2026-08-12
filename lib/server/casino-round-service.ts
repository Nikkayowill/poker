import "server-only";
import { NextResponse } from "next/server";
import { isRetiredArcadeGame, RETIRED_GAME_MESSAGE } from "@/lib/arcade/retired";
import { TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  ActiveArcadeRoundExists,
  advanceArcadeRound,
  createArcadeRound,
  getActiveArcadeRound,
  type StoredArcadeRound,
} from "./arcade-round-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { creditGold, ensureProfile, spendGold } from "./profile-store";

/**
 * The wallet path every staked arcade game shares: debit, deal, act, credit.
 *
 * ## Why this is one module and not six
 *
 * Blackjack and Hi-Lo each carry their own copy of this sequence, and each
 * restates the ordering rules in a header comment because -- as those files
 * say -- breaking one is a silent money bug. That was the right call at two
 * games. At six it stops being documentation and becomes six chances to get
 * the same thing wrong, which is exactly the argument lib/server/arcade-
 * request.ts already won here: four copies of one contract had drifted before
 * anyone noticed.
 *
 * So the rules are not restated below. They are *implemented* below, once, and
 * a game supplies only the parts that are genuinely its own:
 *
 *   1. **The stake leaves the wallet before the round exists.** A deal that
 *      fails to persist refunds; a debit that fails never deals. The reverse
 *      order hands out a hand nobody paid for. See `openCasinoRound`.
 *   2. **A payout is credited only after the version-guarded write is
 *      confirmed.** `advanceArcadeRound` returns null when it loses that race,
 *      and null must never pay. That guard -- and only that guard -- is what
 *      makes a settlement happen exactly once under a double-click, a retried
 *      request or two open tabs. See `settleCasinoRound`.
 *   3. **Settlement is a single credit of what comes back, never a second
 *      debit.** The stake already left in step 1, so a game's `payout` returns
 *      gross: 0 on a loss, the stake on a push, more than the stake on a win.
 *      A game that returned a *net* here would charge losers twice.
 *
 * Blackjack and Hi-Lo are deliberately left on their own copies. They are
 * live, they move real Gold, and restacking their storage under a module whose
 * first four callers are all unshipped would be piling one unproven thing on
 * another -- the same reasoning arcade-round-store.ts gives for leaving
 * blackjack on its own table. Folding them in is a clean follow-up once these
 * four have settled some real rounds.
 */

/**
 * A rejection a player can act on, carrying the true state of their round.
 *
 * One class for all four games rather than a subclass each. The per-game
 * subclasses in the older services exist so `instanceof` narrows to that
 * game's snapshot type -- but these four share this service, so what a caller
 * actually needs to narrow on is "did the casino path reject this", and the
 * snapshot type comes back through the generic.
 */
export class CasinoRequestError<TSnapshot> extends ArcadeRequestError<TSnapshot> {
  readonly name = "CasinoRequestError";
}

/** What every casino route returns: where the round stands, and the wallet after it. */
export interface CasinoView<TSnapshot> {
  round: TSnapshot | null;
  profile: PlayerProfile;
}

/**
 * The result of a player's action on a live round.
 *
 * `reject` is an action the rules do not allow -- holding a sixth card,
 * spinning a wheel that has already stopped. It becomes a 409 carrying the
 * real state rather than an exception, because the client is not broken, it is
 * behind. Returning the round unchanged instead would let a no-op look like a
 * played round.
 */
export type CasinoAction<TRound> =
  | { next: TRound; settled: boolean }
  | { reject: string };

/**
 * Everything about a game that this module cannot know.
 *
 * Note what is absent: no wallet, no store, no ordering. A game supplies pure
 * functions over its own round type and gets the money handling for free,
 * which is the only way to be sure six games handle it the same way.
 */
export interface CasinoGame<TRound, TSnapshot, TInput = undefined> {
  /** The `game` discriminator in arcade_rounds. Free text there, so this is the whole registration. */
  id: string;
  /** How the game is named in a sentence: "You do not have a Roulette round in progress." */
  label: string;
  /** The redaction boundary. Must drop the deck, the wheel result, or whatever else decides the round. */
  snapshot(stored: StoredArcadeRound<TRound>): TSnapshot;
  /**
   * Opens a round for a stake that has already been debited.
   *
   * `input` is whatever the player chose along with the stake -- roulette's
   * bet, baccarat's side. Games that choose nothing up front take `undefined`.
   * It arrives already validated by the route's schema, but a game must still
   * treat it as a claim rather than an instruction: nothing here has checked
   * that the chosen bet is one the game actually offers.
   */
  deal(stake: number, input: TInput): TRound;
  /**
   * Why `input` is not something this game offers, or null if it is fine.
   *
   * Runs before the wallet is touched, so a bet off the layout costs nothing
   * and needs no refund. The route's schema has already checked the *shape*;
   * this is where a game checks the meaning -- and it is not optional
   * belt-and-braces, because `deal` is reached with whatever survives here.
   */
  validate?(input: TInput): string | null;
  /**
   * What a settled round pays back into the wallet, GROSS -- see rule 3. Only
   * ever called on a round the game itself reported as settled.
   */
  payout(round: TRound): number;
  /** True when `deal` already produced a finished round. Defaults to never. */
  settledOnDeal?(round: TRound): boolean;
}

/**
 * The half of a game definition that reading and settling need: everything
 * except how a round is opened. Spelled out so those two paths do not have to
 * name an input type they never touch.
 */
export type CasinoRoundOps<TRound, TSnapshot> = Omit<
  CasinoGame<TRound, TSnapshot, never>,
  "deal" | "settledOnDeal"
>;

function view<TRound, TSnapshot>(
  game: Pick<CasinoRoundOps<TRound, TSnapshot>, "snapshot">,
  stored: StoredArcadeRound<TRound> | null,
  profile: PlayerProfile,
): CasinoView<TSnapshot> {
  return { round: stored ? game.snapshot(stored) : null, profile };
}

/**
 * Pays a settled round out. Never throws.
 *
 * The round is already durably settled by the time this runs, so letting a
 * credit failure bubble would turn a finished hand into an error response and
 * cost the player their result on top of their Gold. Logged loudly instead --
 * this is the one way an arcade game can quietly cost real currency, and it is
 * exactly the failure mode the credit_gold migration incident produced when
 * the RPC did not exist in production.
 */
async function payOut<TRound, TSnapshot>(
  game: Pick<CasinoRoundOps<TRound, TSnapshot>, "id" | "payout">,
  token: string,
  stored: StoredArcadeRound<TRound>,
  fallback: PlayerProfile,
): Promise<PlayerProfile> {
  const payout = game.payout(stored.round);
  if (payout <= 0) return fallback;
  try {
    return await creditGold(token, payout);
  } catch (error) {
    console.error("arcade.payout_credit_failed", {
      game: game.id,
      roundId: stored.id,
      profileId: stored.profileId,
      payout,
      error,
    });
    return fallback;
  }
}

/** The caller's live round, or null. What restores the felt after a refresh. */
export async function readCasinoRound<TRound, TSnapshot>(
  game: CasinoRoundOps<TRound, TSnapshot>,
  token: string,
): Promise<CasinoView<TSnapshot>> {
  const profile = await ensureProfile(token);
  const stored = await getActiveArcadeRound<TRound>(profile.id, game.id);
  return view(game, stored, profile);
}

/**
 * Opens a round at the tier's stake. Rule 1 lives here.
 *
 * A caller who already has a live round gets it back untouched: a refresh, a
 * back button or a second tab is a resume, not a second wager. Dealing again
 * would debit twice for one round and -- worse -- would replace the cards or
 * the bet the player was in the middle of acting on.
 */
export async function openCasinoRound<TRound, TSnapshot, TInput = undefined>(
  game: CasinoGame<TRound, TSnapshot, TInput>,
  token: string,
  tier: StakesTier,
  input: TInput,
): Promise<CasinoView<TSnapshot> & { resumed: boolean }> {
  let profile = await ensureProfile(token);

  const existing = await getActiveArcadeRound<TRound>(profile.id, game.id);
  if (existing) return { ...view(game, existing, profile), resumed: true };

  // Retirement is enforced HERE rather than on the routes, and after the
  // resume above rather than before it: a player holding a live round paid for
  // it, so they get it back and settle it out normally. What is refused is
  // opening a new one. See lib/arcade/retired.ts for why a catalog edit alone
  // would not have closed this path.
  if (isRetiredArcadeGame(game.id)) {
    throw new CasinoRequestError<TSnapshot>(RETIRED_GAME_MESSAGE, 410);
  }

  const stake = TIER_CONFIG[tier].minBuyIn;
  if (!profile.unlimitedGold && profile.goldBalance < stake) {
    throw new CasinoRequestError<TSnapshot>(
      `You need ${stake.toLocaleString()} Gold to play this stake.`,
      400,
    );
  }

  // Everything a player got wrong is settled BEFORE the wallet is touched.
  // Refusing after the debit would be correct only as long as the refund below
  // never fails, and there is no reason to take that bet: a bet the layout
  // does not offer is not a round that half-happened, it is a round that never
  // started.
  const rejection = game.validate?.(input);
  if (rejection) throw new CasinoRequestError<TSnapshot>(rejection, 400);

  // Rule 1: the stake leaves first. spendGold is the authority on whether the
  // player can afford it -- the check above is only ever a stale read, and is
  // here to produce a sentence about the stake rather than a bare refusal.
  profile = await spendGold(token, stake);

  let stored: StoredArcadeRound<TRound>;
  try {
    // `deal` is inside the try, not above it. It can throw -- an engine
    // guarding its own preconditions is the whole reason those guards exist --
    // and outside this block a throw would leave the stake debited with no
    // round and no refund, which is the exact failure rule 1 is written to
    // prevent.
    const round = game.deal(stake, input);
    stored = await createArcadeRound<TRound>({
      profileId: profile.id,
      game: game.id,
      tier,
      baseStake: stake,
      round,
      settled: game.settledOnDeal?.(round) ?? false,
    });
  } catch (error) {
    // The round never came into existence, so the player must not have paid
    // for it. Same make-them-whole shape as app/api/games/route.ts.
    profile = await creditGold(token, stake).catch(() => profile);
    if (error instanceof ActiveArcadeRoundExists) {
      // Lost a race with the player's own second tab. Theirs is the real
      // round; hand it back rather than reporting a conflict they cannot act on.
      const live = await getActiveArcadeRound<TRound>(profile.id, game.id);
      if (live) return { ...view(game, live, profile), resumed: true };
      throw new CasinoRequestError<TSnapshot>(error.message, 409);
    }
    throw error;
  }

  // Rule 2 applies to a deal that settles on the spot too: the write is
  // confirmed above before anything is credited here. Asked of the *stored*
  // round rather than the one just built, so a resume-shaped path can never
  // pay out on a round the database did not accept.
  if (game.settledOnDeal?.(stored.round) ?? false) {
    profile = await payOut(game, token, stored, profile);
  }

  return { ...view(game, stored, profile), resumed: false };
}

/**
 * Applies a player's action to their live round, and pays it if it finished.
 *
 * `roundId` and `version` are both required and both checked. The version pins
 * the action to the exact state the player was looking at, so a replayed or
 * double-fired request cannot draw a second card from the same deck or spin a
 * wheel twice on one bet.
 */
export async function settleCasinoRound<TRound, TSnapshot>(
  game: CasinoRoundOps<TRound, TSnapshot>,
  token: string,
  input: { roundId: string; version: number },
  apply: (round: TRound) => CasinoAction<TRound>,
): Promise<CasinoView<TSnapshot>> {
  let profile = await ensureProfile(token);

  const current = await getActiveArcadeRound<TRound>(profile.id, game.id);
  if (!current) {
    throw new CasinoRequestError<TSnapshot>(
      `You do not have a ${game.label} round in progress.`,
      404,
    );
  }

  if (current.id !== input.roundId || current.version !== input.version) {
    throw new CasinoRequestError<TSnapshot>(
      "That round moved on. Here is where it actually stands.",
      409,
      { round: game.snapshot(current) },
    );
  }

  const action = apply(current.round);
  if ("reject" in action) {
    throw new CasinoRequestError<TSnapshot>(action.reject, 409, { round: game.snapshot(current) });
  }

  const stored = await advanceArcadeRound<TRound>(current, action.next, action.settled);
  if (!stored) {
    // Rule 2: a lost race did not happen, so it does not pay.
    const live = await getActiveArcadeRound<TRound>(profile.id, game.id);
    throw new CasinoRequestError<TSnapshot>(
      "That round moved on. Here is where it actually stands.",
      409,
      { round: live ? game.snapshot(live) : undefined },
    );
  }

  if (action.settled) profile = await payOut(game, token, stored, profile);
  return view(game, stored, profile);
}

/** Maps a thrown error to the response every casino route sends. */
export function toCasinoErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That round could not be played.");
}
