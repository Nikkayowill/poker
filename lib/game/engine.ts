import { randomInt, randomUUID } from "crypto";
import { compareScores, describeHand, evaluateHand, evaluateHandDetailed, type HandScore } from "./evaluator";
import type {
  BotPersonality,
  Card,
  GameSnapshot,
  GameState,
  LegalActions,
  PlayerAction,
  Rank,
  Seat,
  Street,
  Winner,
} from "./types";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  botAvatarCosmetics,
  botCardBackFor,
  botChipDesignsFor,
  DEFAULT_AVATAR_COSMETIC,
  DEFAULT_CARD_BACK,
} from "@/lib/cosmetics/catalog";
import { CHEAPEST_TIER, clampBuyIn, isStakesTier, TIER_CONFIG, type StakesTier } from "./tiers";
import { DECK_TEMPLATE, makeDeck } from "./deck";
import { isSeatRebuyEligible } from "./rebuy";
import { blindLevelForHand, forfeitTournamentSeat } from "./tournament";
import { botProfiles } from "./bot-identities";

const streetOrder: Street[] = ["preflop", "flop", "turn", "river", "showdown"];
type TurnAction = Exclude<
  PlayerAction,
  { type: "next-hand" } | { type: "leave-seat" }
>;
// A table always has SEAT_COUNT total seats; any not claimed by a human are
// bot-controlled.
export const SEAT_COUNT = 6;

function botProfileFor(identity: number): (typeof botProfiles)[number] {
  const length = botProfiles.length;
  return botProfiles[((identity % length) + length) % length];
}

/**
 * How a bot plays, rolled independently of which name/face (`botIdentity`)
 * it happens to be wearing. Unlike identity, personality doesn't need to be
 * unique at a table; a real cash game has more than one loose-passive player
 * in it at once.
 *
 * The three that exist are the three worth having, and the names are
 * compatibility IDs rather than labels (`personalityProfiles` and the
 * preflop chart are both keyed on them):
 *
 *  - `MANIAC` ("Loose Cannon"): very aggressive, plays a wide range, shoves
 *    with merely-good equity rather than only the nuts.
 *  - `ROCK` ("Table Captain"): balanced-aggressive, plays a tighter range
 *    well and punishes limpers.
 *  - `CALLING_STATION` ("Whale"): very loose, very passive, wants to see
 *    almost every flop and rarely raises without a monster.
 *
 * Weighted 35/45/20 (Loose Cannon/Table Captain/Whale), rolled with
 * `randomInt` (not `Math.random`) to match every other source of table
 * randomness in this file.
 */
function pickBotPersonality(): BotPersonality {
  const roll = randomInt(100);
  if (roll < 35) return "MANIAC";
  if (roll < 80) return "ROCK";
  return "CALLING_STATION";
}

/**
 * A stable 32-bit hash (FNV-1a) of the string that identifies one replacement.
 *
 * Not Math.random. Two writers can reach a seat replacement for the same
 * hand (a human's action route and the server-timed advance), and only one
 * wins the version check. With a random draw the loser would recompute a
 * different name and the seat would appear to change identity again on
 * retry. Seeded on state both writers already agree about, they compute the
 * same answer and a retry is a no-op.
 */
function identityHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * An identity for a seat that is turning over, unique among the bots
 * currently sitting at this table: by tag (no two seats wearing the same
 * name), by avatarPreset (no two seats drawing the same icon, since the
 * preset cycles every 6 pool entries and would otherwise repeat well before
 * the tag does), and by seat-art face, which is the one a player actually
 * looks at on the racetrack table. `botAvatarFor` indexes the character
 * roster modulo its length, so whenever the pool is larger than the roster
 * some identities alias onto the same character (30 tags over 26 characters
 * aliases four of them), and two bots can turn up at one table wearing the
 * same face. Checking the face here rather than sizing one list against the
 * other keeps the two free to grow independently, the whole point of
 * deriving the cast from the catalog.
 *
 * Uniqueness is checked table-wide rather than per seat, since drawing
 * independently per seat is what seats the same tag or icon twice, the
 * exact thing rotation is meant to stop. Walking forward from the seeded
 * offset rather than re-drawing keeps it deterministic and bounded.
 */
function pickBotIdentity(state: GameState, position: number): number {
  const others = state.seats.filter(
    (seat) => seat.position !== position && !seat.isHuman && seat.botIdentity !== null,
  );
  const taken = new Set(others.map((seat) => seat.botIdentity));
  const takenPresets = new Set(others.map((seat) => botProfileFor(seat.botIdentity!).avatarPreset));
  const takenFaces = new Set(others.map((seat) => botAvatarFor(seat.botIdentity!)));
  const offset = identityHash(`${state.id}:${state.handNumber}:${position}`);
  for (let step = 0; step < botProfiles.length; step += 1) {
    const candidate = (offset + step) % botProfiles.length;
    if (
      !taken.has(candidate)
      && !takenPresets.has(botProfiles[candidate].avatarPreset)
      && !takenFaces.has(botAvatarFor(candidate))
    ) {
      return candidate;
    }
  }
  // Every preset or face already taken (a full table with fewer distinct
  // ones than seats): fall back to tag-uniqueness only.
  for (let step = 0; step < botProfiles.length; step += 1) {
    const candidate = (offset + step) % botProfiles.length;
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable while the pool is larger than SEAT_COUNT, but a table can
  // never be left without an identity to hand out.
  return offset % botProfiles.length;
}

/**
 * A bot's face, taken from whatever avatars the catalog currently holds
 * rather than naming ids. Adding or removing artwork changes the cast
 * automatically and can never leave a bot pointing at an item that no
 * longer exists.
 *
 * Keyed on the seat's identity rather than its position, so a rotated bot
 * brings its own face with it instead of inheriting the chair's.
 */
function botAvatarFor(identity: number): string {
  // botAvatarCosmetics is the character roster minus its earned tier -- same
  // reasoning as botCardBackFor, see that function's own comment.
  //
  // Used to matter for a second reason too: avatarCosmetics briefly also
  // held a separate WebGL-3D-only roster, and landing a bot on one of those
  // ids here would have given it a face the racetrack's seat-art lookup
  // could never resolve. That roster is gone along with the 3D room, so
  // avatarCosmetics is just the character roster now -- but botAvatarCosmetics
  // stays the deliberate filter to reach for here rather than avatarCosmetics
  // directly, since the earned-tier exclusion is still real.
  if (botAvatarCosmetics.length === 0) return DEFAULT_AVATAR_COSMETIC;
  return botAvatarCosmetics[identity % botAvatarCosmetics.length].id;
}

// Humans get a short decision clock plus three optional time-bank cards.
// Bot deadlines are also persisted so polling/realtime can pace decisions
// without trusting a browser timer.
//
// Overridable for tests only. tests/e2e/multiplayer.spec.ts drives six human
// seats through a hand over HTTP, and all of that has to finish inside one
// clock that starts when the hand is dealt, so as the suite grew it began
// losing the race and the server auto-folded the first actor out from under
// it. Timeout behaviour itself is covered deterministically by the unit
// tests, which inject time rather than waiting for it, so there's nothing to
// gain by also making the browser suite race a wall clock.
export const TURN_TIMEOUT_MS = Number(process.env.RIVER_TURN_TIMEOUT_MS) || 15_000;

/**
 * How long a finished hand stays on screen before the next one is dealt.
 *
 * Derived from the celebration rather than chosen: the longest animation on
 * a finished table is win-amount-rise, 1.4s from a .78s offset, so
 * everything is over at 2.18s and this leaves a beat after it.
 * app/styles/stylesheets.test.ts reads the stylesheets and fails if any
 * celebration animation grows past this, the only way to keep the two
 * honest since nothing else in the toolchain reads both a TypeScript
 * constant and a CSS keyframe.
 *
 * Shortened once the deal became automatic: with no button to press, the
 * wait is dead air rather than a chance to act.
 */
export const NEXT_HAND_DELAY_MS = 2_800;

/**
 * Consecutive expired clocks before a seat is given back to the table.
 *
 * Three, because two is a bad connection and three is a person who has gone.
 * At a 15s clock that's roughly 45 seconds of a seat folding itself while
 * five other players wait for it, about as long as a table should carry
 * someone. Not a wall-clock timer: a player who is present but slow is never
 * counted, since acting resets it.
 */
export const MAX_MISSED_TURNS = 3;

/**
 * How many funded seats the table tops itself back up to.
 *
 * Six: the whole table. A lower floor read as a worse trade than it looks:
 * a busted bot that refilled instantly, forever, made bot stacks read as a
 * renewable chip source, but two seats sitting empty indefinitely reads to
 * a real player as a shrinking tournament, not a cash table they can walk
 * back into. The actual guardrail lives in *when* a seat refills, not
 * *whether* it's allowed to: a bot that busts from losing its stack still
 * refills the same hand it always has, but a healthy bot's voluntary
 * departure (`BOT_VOLUNTARY_LEAVE_CHANCE` below) is staggered by
 * `BOT_REENTRY_DELAY_MIN_MS`/`MAX_MS` rather than instant, which is also
 * what keeps the table from pinning at six occupied seats all the time.
 *
 * Read through fundedFloor() rather than directly, and overridable by env
 * for the same reason TURN_TIMEOUT_MS is: the blind rules for a table that
 * has shrunk below the floor are still real rules worth testing, and the
 * tests that cover them need to be able to produce that table.
 */
export const TABLE_FUNDED_FLOOR = 6;

function fundedFloor(): number {
  const override = Number(process.env.RIVER_TABLE_FUNDED_FLOOR);
  return Number.isFinite(override) && override > 0 ? override : TABLE_FUNDED_FLOOR;
}

/**
 * Chance, per hand boundary, that a currently-funded bot seat decides it's
 * done and stands up on its own: what makes a table feel like real traffic
 * instead of a fixed cast that only ever turns over by losing.
 *
 * Zero whenever `process.env.VITEST` is set (the same guard `logTurn` in
 * `lib/server/game-store.ts` already uses), regardless of the env override
 * below. This rolls inside `releaseBustedSeats`, which hundreds of existing
 * tests reach directly or indirectly through `setupHand`/`dealNextHandIfDue`,
 * and none of them expect a seat count to change out from under a
 * deterministic assertion, so production gets real randomness and the test
 * suite gets none by default, unless a test explicitly opts in.
 *
 * `RIVER_BOT_LEAVE_CHANCE` is read manually rather than through the `|| `
 * idiom used elsewhere in this file: `Number("0") || 0.05` would silently
 * discard an explicit "disable this" override, and the tests that exercise
 * this feature need to set it to exactly `0` or `1` and have that stick.
 */
function botVoluntaryLeaveChance(): number {
  const raw = process.env.RIVER_BOT_LEAVE_CHANCE;
  if (raw !== undefined) {
    const override = Number(raw);
    if (Number.isFinite(override)) return override;
  }
  return process.env.VITEST ? 0 : 0.05;
}

/**
 * How long a bot seat that voluntarily left stays empty before it's eligible
 * to be refilled: the staggered "weird timing" a real table's traffic has,
 * versus an empty chair refilling itself the instant it empties. A seat
 * busted from losing its stack never sets this; only a voluntary departure
 * (see `releaseBustedSeats`) does.
 *
 * Functions, not top-level constants, for the same reason `fundedFloor()`
 * is: a plain `export const` reads its env override exactly once, at module
 * import, before any test's `vi.stubEnv` has run.
 */
function botReentryDelayMinMs(): number {
  return Number(process.env.RIVER_BOT_REENTRY_DELAY_MIN_MS) || 30_000;
}
function botReentryDelayMaxMs(): number {
  return Number(process.env.RIVER_BOT_REENTRY_DELAY_MAX_MS) || 180_000;
}

export const BOT_DECISION_MIN_MS = 600;
export const BOT_DECISION_MAX_MS = 5_000;

// Excludes visually ambiguous characters (0/O, 1/I/L) from shareable room codes.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function addLog(state: GameState, text: string, kind: "deal" | "action" | "win" = "action") {
  state.log.unshift({ id: randomUUID(), text, at: new Date().toISOString(), kind });
  state.log = state.log.slice(0, 18);
}

function nextSeat(
  state: GameState,
  from: number,
  predicate: (seat: Seat) => boolean,
): number | null {
  for (let offset = 1; offset <= state.seats.length; offset += 1) {
    const index = (from + offset) % state.seats.length;
    if (predicate(state.seats[index])) return index;
  }
  return null;
}

function inHand(seat: Seat) {
  return seat.status !== "out";
}

/**
 * A cheap, state-only stand-in for "is this an easy decision or a real one" —
 * NOT a peek at chooseBotAction's own fold/call/raise pick, which is stochastic
 * (Monte Carlo equity + a decision roll) and would draw different random
 * numbers if sampled twice for the same turn. Checking with nothing to call is
 * always a snap decision; facing a bet gets slower the more of the pot or the
 * bot's own stack that bet represents, same as a real player weighing pot odds.
 */
function botDecisionComplexity(state: GameState, seat: Seat): number {
  const toCall = Math.max(0, state.currentBet - seat.streetBet);
  if (toCall === 0) return 0.6;
  const potPressure = Math.min(1, toCall / Math.max(1, state.pot));
  const stackPressure = Math.min(1, toCall / Math.max(1, seat.stack));
  return 0.75 + 0.55 * Math.max(potPressure, stackPressure);
}

function setCurrentPlayer(state: GameState, index: number | null, now = Date.now()) {
  state.currentPlayer = index;
  if (index === null) {
    state.turnStartedAt = null;
    state.turnDeadlineAt = null;
    return;
  }
  state.turnStartedAt = new Date(now).toISOString();
  const seat = state.seats[index];
  // Ranges are per-personality (a maniac snaps, a rock stews) so a table never
  // settles into one shared cadence; botDecisionComplexity then stretches or
  // compresses that roll around how real the decision actually is.
  const botThinkRanges: Record<BotPersonality, [number, number]> = {
    MANIAC: [BOT_DECISION_MIN_MS, 2_600],
    ROCK: [1_400, BOT_DECISION_MAX_MS],
    CALLING_STATION: [1_000, 3_800],
  };
  const [minimum, maximum] = botThinkRanges[seat.personality ?? "ROCK"];
  const duration = seat.isHuman
    ? TURN_TIMEOUT_MS
    : Math.max(400, Math.round(randomInt(minimum, maximum + 1) * botDecisionComplexity(state, seat)));
  state.turnDeadlineAt = new Date(now + duration).toISOString();
}

function canAct(seat: Seat) {
  return seat.status === "active" && seat.stack > 0;
}

/**
 * Puts a bot in the seat, wearing `identity` from the pool.
 *
 * Callers pass an identity from pickBotIdentity so the replacement is
 * somebody new. It defaults to the seat's position, the identity that chair
 * has worn since the table was created, which is what the normalize path
 * wants when backfilling a table written before rotation existed.
 */
function restoreBotControl(seat: Seat, identity: number = seat.position) {
  const fallback = botProfileFor(identity);
  seat.isHuman = false;
  seat.ownerToken = null;
  // Clears with the token, never after it. A chair that keeps the departed
  // player's profile id is a seat the table can still address as them.
  seat.profileId = null;
  seat.botIdentity = identity;
  // Rolled fresh on every reseat, not carried over from whoever wore this
  // identity last: the bot that sits back down needn't play like the one
  // that left, and this decouples "which name/face" from "how it plays".
  seat.personality = pickBotPersonality();
  seat.name = fallback.name;
  seat.initials = fallback.initials;
  seat.accent = fallback.accent;
  seat.avatarUrl = fallback.avatarUrl;
  seat.avatarPreset = fallback.avatarPreset;
  seat.avatarCosmetic = botAvatarFor(identity);
  // The deck goes back with the seat. A player who leaves, or is released
  // for missing three turns, must not leave a 400,000 Gold card back behind
  // for a bot to keep playing with.
  seat.cardBackCosmetic = botCardBackFor(identity);
  // Same idea, one step further along the table: a bot's own chip colour,
  // not the house default every bot used to share -- see botChipDesignsFor.
  seat.chipDesigns = botChipDesignsFor(identity);
  seat.missedTurns = 0;
  // Cleared on every reseat, not just set by the voluntary-leave path that
  // uses it: a seat coming back under any circumstance is funded and playing
  // again, so a stale future timestamp must not linger.
  seat.reseatEligibleAt = null;
}

/**
 * How many seats will hold chips once releaseBustedSeats has run.
 *
 * The mirror of that function, and it has to stay one: a busted human keeps
 * their seat but not a stack, so they never count here. Only busted bots do,
 * topped up as far as the floor. Kept next to scheduleNextHand, its only
 * caller and the only reason it exists: the deadline is written before the
 * release happens.
 */
function fundedSeatsAfterRelease(state: GameState): number {
  const funded = state.seats.filter((seat) => seat.stack > 0).length;
  const bustedBots = state.seats.filter((seat) => !seat.isHuman && seat.stack <= 0).length;
  return funded + Math.min(bustedBots, Math.max(0, fundedFloor() - funded));
}

/**
 * Marks the table decided the moment a hand leaves only one seat funded,
 * instead of waiting for a later setupHand pass that might never come.
 *
 * A tournament seat never rebuys, so chip conservation guarantees at most one
 * seat has a positive stack once this fires -- whichever one does has just
 * won the whole table. Guarded on winnerProfileId so a stray extra call (a
 * setupHand pass that still finds funded.length < 2, or a second advance
 * racing in) never overwrites a result that's already decided.
 */
function finalizeTournamentIfDecided(state: GameState, survivor: Seat | undefined) {
  if (!state.tournament || state.tournament.winnerProfileId) return;
  if (!survivor?.profileId) return;
  state.tournament.winnerProfileId = survivor.profileId;
  state.tournament.finishedAtHand = state.handNumber;
  state.message = state.tournament.format === "heads_up"
    ? `${survivor.name} wins the match!`
    : `${survivor.name} wins the Sit & Go!`;
}

/**
 * Marks a finished hand as due to be replaced.
 *
 * Called only where a hand actually played out, never where setupHand gave up
 * for want of funded seats: a table that cannot deal must not advertise a
 * deadline, or every seated browser would wake at it, ask the server to
 * advance, and be told the same thing forever.
 */
export function scheduleNextHand(state: GameState, now = Date.now()) {
  // Counts seats that will be funded when the next hand is actually set up,
  // not seats funded right now. The two differ because releaseBustedSeats
  // runs at the head of setupHand, so a table whose bots have been ground
  // down below the floor is about to refill and deal; reading only current
  // stacks here would null the deadline, stall the table, and never reach
  // the refill that was going to fix it.
  const canContinue = fundedSeatsAfterRelease(state) >= 2;
  if (!canContinue) {
    state.nextHandAt = null;
    // A tournament's funded count can't be inflated by the bot-floor term
    // fundedSeatsAfterRelease adds for cash tables (tournaments have no
    // bots), so reading current stacks directly here is exact, not an
    // approximation of what setupHand will see later. Finalizing right here,
    // in the same call that ends the deciding hand, is what lets the very
    // same /actions or /advance response settle the match -- instead of
    // depending on some browser polling this game again after the match
    // visibly ended and both players have every reason to navigate away.
    if (state.tournament) {
      const survivor = state.seats.find((seat) => seat.stack > 0);
      finalizeTournamentIfDecided(state, survivor);
    }
    return;
  }
  // The same beat regardless of who busted or how many did. One player
  // running out of chips is never a reason for the table to make everyone
  // else wait; their own seat just sits out (see releaseBustedSeats) while
  // play continues at the normal pace around them.
  state.nextHandAt = new Date(now + NEXT_HAND_DELAY_MS).toISOString();
}

/**
 * Puts a freshly-identified, funded bot in a seat that was empty.
 *
 * Only ever called for a *bot* seat: a busted human keeps their own seat and
 * simply sits out (see releaseBustedSeats) rather than being handed to a
 * replacement, since real chips have no bot equivalent to mint. Minting the
 * bot's stack is not a conservation break: bot chips are not backed by Gold,
 * and the invariant that matters, that a human's chips and their Gold are
 * the same chips, never applies to this path.
 *
 * Status is set here rather than left to `setupHand`'s own recompute, even
 * though the only caller runs that recompute a few lines later: `setupHand`
 * bails out early when fewer than two seats are funded, and that branch
 * returns before the recompute, which would strand this seat on last hand's
 * `"folded"` status while holding a fresh stack. `"out"` would contradict a
 * funded seat either way.
 */
function reseat(state: GameState, seat: Seat) {
  restoreBotControl(seat, pickBotIdentity(state, seat.position));
  seat.stack = TIER_CONFIG[state.tier].minBuyIn;
  seat.status = "active";
}

/**
 * Hands every busted *bot* seat back to a freshly-identified, funded one,
 * and logs a busted human's seat once without touching it.
 *
 * A human who runs out of chips keeps their seat: no grace period, no bot
 * standing in for them, exactly like walking away from a real table broke.
 * `setupHand`'s own per-seat pass a few lines after this call already reads
 * their zero stack and sits them out for the next hand same as any other
 * unfunded seat, so there is nothing left for this function to do for them
 * beyond the log line, and that only once: `seat.status === "out"` is true
 * on every call after the first, since the per-seat pass set it there and
 * nothing refills it until they rebuy.
 *
 * Busted *bots* are a different problem: without a refill, a bot that lost
 * its last chip to a hot player would stay marked `"out"` forever, so a
 * table left running long enough would empty itself down to "Not enough
 * players with chips to continue." They refill up to the floor instead, and
 * this runs at the head of `setupHand`, before funded seats are counted and
 * before any card is dealt, which is what makes "the seats are refilled
 * before the next hand" a property of the deal rather than a race with it.
 */
function releaseBustedSeats(state: GameState, now: number = Date.now()) {
  state.seats.forEach((seat) => {
    if (!seat.isHuman || seat.stack > 0 || seat.status === "out") return;
    // A tournament seat never rebuys -- the funded-seat check a few lines
    // into setupHand ends the match (Sit & Go or heads-up alike) on this
    // same call, so this log line is this bust's only mention on its own
    // terms.
    addLog(
      state,
      state.tournament
        ? `${seat.name} busts out and is eliminated`
        : `${seat.name} is out of chips and sits out until they rebuy`,
    );
  });

  // A Sit & Go has no bot fill, ever: a busted seat is eliminated, not
  // waiting on a rebuy, and nobody voluntarily stands up to be replaced.
  // Everything below this line is cash-table-only bot machinery.
  if (state.tournament) return;

  // A healthy bot occasionally decides it's done and stands up on its own,
  // the main way a table's cast turns over now, since busted bots refill
  // the same hand they always have (below). Never below three funded seats
  // (itself plus at least two others), so this can never be what strands a
  // table for want of players.
  const leaveChance = botVoluntaryLeaveChance();
  if (leaveChance > 0) {
    for (const seat of state.seats) {
      if (seat.isHuman || seat.stack <= 0) continue;
      if (state.seats.filter((other) => other.stack > 0).length <= 2) break;
      if (secureBotRandom() >= leaveChance) continue;
      const departingName = seat.name;
      seat.status = "out";
      seat.stack = 0;
      // The one place this ever gets set. A seat that busts from losing its
      // stack (below) leaves it null and refills immediately.
      seat.reseatEligibleAt = new Date(
        now + randomInt(botReentryDelayMinMs(), botReentryDelayMaxMs() + 1),
      ).toISOString();
      addLog(state, `${departingName} cashes out and heads home`);
    }
  }

  // Busted bots, from losing their stack or from voluntarily leaving just
  // above, refill up to the floor, skipping any seat still waiting out its
  // own stagger. Refilling every one of them on the spot would pin the table
  // at six funded seats forever, which costs two things worth keeping:
  // short-handed play stops existing, and the bot stacks (minted, not
  // backed by Gold) become a renewable source of chips that a winning
  // player converts to Gold on cash-out. The floor (see TABLE_FUNDED_FLOOR)
  // plus the stagger above are what bound that instead.
  const floor = fundedFloor();
  for (const seat of state.seats) {
    if (seat.isHuman || seat.stack > 0) continue;
    if (seat.reseatEligibleAt && Date.parse(seat.reseatEligibleAt) > now) continue;
    if (state.seats.filter((other) => other.stack > 0).length >= floor) break;
    const departingName = seat.name;
    reseat(state, seat);
    addLog(state, `${departingName} busts out — ${seat.name} takes the seat`);
  }
}

function blindPositions(state: GameState) {
  if (state.seats.filter(inHand).length === 2) {
    // Heads-up: the button also posts the small blind and acts first
    // preflop, the standard heads-up convention and the reverse of what
    // the general n-player rule below would produce with only two players.
    const small = state.buttonPosition;
    const big = nextSeat(state, small, inHand);
    return { small, big };
  }
  const small = nextSeat(state, state.buttonPosition, inHand);
  const big = small === null ? null : nextSeat(state, small, inHand);
  return { small, big };
}

function commit(seat: Seat, amount: number) {
  const paid = Math.max(0, Math.min(amount, seat.stack));
  seat.stack -= paid;
  seat.streetBet += paid;
  seat.committed += paid;
  if (seat.stack === 0) seat.status = "all-in";
  return paid;
}

function dealToCommunity(state: GameState, count: number) {
  state.deck.pop(); // burn
  for (let index = 0; index < count; index += 1) {
    const card = state.deck.pop();
    if (!card) throw new Error("The deck ran out of cards.");
    state.community.push(card);
  }
}

/** Exported for createTournamentGame below, which deals the opening hand the same way createGame does. */
export function setupHand(state: GameState, firstHand = false, now: number = Date.now()) {
  if (!firstHand) releaseBustedSeats(state, now);
  // Cleared before the funded check, so the dead-table branch below leaves
  // it null rather than inheriting the deadline that brought us here, which
  // would have every browser retry an advance that can never succeed.
  state.nextHandAt = null;
  const funded = state.seats.filter((seat) => seat.stack > 0);
  if (funded.length < 2) {
    state.status = "complete";
    state.street = "showdown";
    setCurrentPlayer(state, null);
    state.message = "Not enough players with chips to continue.";
    // Normally already finalized by scheduleNextHand at the moment the
    // deciding hand ended (see finalizeTournamentIfDecided); this is the
    // fallback for a table that reaches here some other way (e.g. a table
    // that was never funded to begin with). Guarded internally on
    // winnerProfileId, so this is a no-op once the match is already decided.
    finalizeTournamentIfDecided(state, funded[0]);
    return;
  }

  if (!firstHand) {
    state.buttonPosition = nextSeat(state, state.buttonPosition, (seat) => seat.stack > 0) ?? 0;
    state.handNumber += 1;
  }
  // Only a Sit & Go's blinds escalate. A heads-up match's stay exactly what
  // createHeadsUpGame fixed them at for the whole match -- a real cash-style
  // heads-up battle, not a turbo format.
  if (state.tournament?.format === "sit_and_go") {
    const level = blindLevelForHand(state.handNumber, TIER_CONFIG[state.tier]);
    state.smallBlind = level.smallBlind;
    state.bigBlind = level.bigBlind;
    state.tournament.blindLevel = level.level;
  }
  state.deck = makeDeck(randomInt);
  state.community = [];
  state.winners = [];
  state.street = "preflop";
  state.status = "playing";
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.pot = 0;
  state.rake = 0;
  state.message = "Cards are in the air";

  state.seats.forEach((seat) => {
    seat.status = seat.stack > 0 ? "active" : "out";
    seat.holeCards = [];
    seat.streetBet = 0;
    seat.committed = 0;
    seat.acted = false;
    seat.actedAtBet = null;
    seat.lastAction = null;
    seat.vpip = false;
  });

  for (let round = 0; round < 2; round += 1) {
    let cursor = state.buttonPosition;
    for (let dealt = 0; dealt < funded.length; dealt += 1) {
      const position = nextSeat(state, cursor, inHand);
      if (position === null) break;
      const card = state.deck.pop();
      if (!card) throw new Error("The deck ran out of cards.");
      state.seats[position].holeCards.push(card);
      cursor = position;
    }
  }

  const { small, big } = blindPositions(state);
  if (small === null || big === null) throw new Error("Not enough players for blinds.");
  const smallPaid = commit(state.seats[small], state.smallBlind);
  const bigPaid = commit(state.seats[big], state.bigBlind);
  state.seats[small].lastAction = `Small blind · ${smallPaid}`;
  state.seats[big].lastAction = `Big blind · ${bigPaid}`;
  // A short-stacked big blind may post less than the blind, but every player
  // with enough chips still faces the full big blind as the minimum bring-in.
  // The short blind's actual contribution remains correct for side pots.
  state.currentBet = state.bigBlind;
  state.pot = state.seats.reduce((sum, seat) => sum + seat.committed, 0);
  setCurrentPlayer(state, nextSeat(state, big, canAct));
  addLog(state, `Hand ${state.handNumber} dealt · blinds ${state.smallBlind}/${state.bigBlind}`, "deal");
}

/**
 * How deep a bot's starting stack can run, as a multiple of the table's
 * fixed buy-in.
 *
 * TIER_CONFIG's minBuyIn === maxBuyIn: a human always buys in for exactly
 * the tier's number, see tiers.ts. That invariant is about what a player
 * pays, not what a bot happens to be carrying when the table is first
 * drawn, so giving the six bot chairs a spread of stacks doesn't touch it.
 * A fresh table reading as new money sitting at 1x next to a grinder up to
 * 3x is what a table that has actually been running looks like; a row of
 * six identical stacks is the tell that it hasn't.
 */
const BOT_STACK_DEEP_MULTIPLE = 3;

/**
 * A bot's starting stack: uniform in [buyIn, buyIn * BOT_STACK_DEEP_MULTIPLE],
 * snapped to the nearest big blind so it reads as a real stack rather than a
 * random integer. buyIn is always an exact multiple of bigBlind (100 of them,
 * for every tier in TIER_CONFIG), and so is the ceiling, so rounding here can
 * never land outside the intended range.
 */
function randomBotStack(buyIn: number, bigBlind: number): number {
  const ceiling = buyIn * BOT_STACK_DEEP_MULTIPLE;
  const raw = buyIn + randomInt(ceiling - buyIn + 1);
  return Math.round(raw / bigBlind) * bigBlind;
}

export function createGame(
  hostToken: string,
  playerName = "You",
  appearance?: Pick<
    PlayerProfile,
    "id" | "isRegistered" | "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped"
  >,
  options?: { isPrivate?: boolean; tier?: StakesTier; buyIn?: number },
): GameState {
  const now = new Date().toISOString();
  const tier = options?.tier ?? CHEAPEST_TIER;
  const config = TIER_CONFIG[tier];
  // Defaults to 1000 (not the tier's own range) so every existing caller
  // that doesn't pass a buyIn, every test and any not-yet-updated route,
  // keeps getting exactly the stack size the app has always started with.
  // A real buy-in choice (the lobby/quick-play flow) always passes one
  // explicitly and gets clamped into the tier's actual bounds.
  const buyIn = options?.buyIn === undefined ? 1000 : clampBuyIn(tier, options.buyIn);
  const seats: Seat[] = [
    {
      id: randomUUID(),
      name: playerName.slice(0, 18) || "You",
      initials: appearance?.initials ?? (playerName || "You").slice(0, 2).toUpperCase(),
      accent: appearance?.accent ?? "#e7c66a",
      avatarUrl: appearance?.avatarUrl ?? null,
      avatarPreset: appearance?.avatarPreset ?? "ace",
      avatarCosmetic: appearance?.equipped?.avatar2d ?? DEFAULT_AVATAR_COSMETIC,
      cardBackCosmetic: appearance?.equipped?.cardBack ?? DEFAULT_CARD_BACK,
      chipDesigns: appearance?.equipped?.chipDesigns ?? {},
      position: 0,
      isHuman: true,
      ownerToken: hostToken,
      // Guests get null, so the host seat of a guest-created table carries
      // no durable identity; see Seat.profileId.
      profileId: appearance?.isRegistered ? appearance.id : null,
      botIdentity: null,
      personality: null,
      stack: buyIn,
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
    },
    // Bounded by SEAT_COUNT, not by the pool: the pool is longer than the
    // table so rotation has somewhere to draw from, and slicing it
    // open-ended would seat one player per identity.
    ...botProfiles.slice(1, SEAT_COUNT).map((bot, index): Seat => ({
      id: randomUUID(),
      ...bot,
      avatarCosmetic: botAvatarFor(index + 1),
      cardBackCosmetic: botCardBackFor(index + 1),
      chipDesigns: botChipDesignsFor(index + 1),
      position: index + 1,
      isHuman: false,
      ownerToken: null,
      profileId: null,
      botIdentity: index + 1,
      personality: pickBotPersonality(),
      stack: randomBotStack(buyIn, config.bigBlind),
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
    })),
  ];

  const isPrivate = options?.isPrivate ?? false;
  const state: GameState = {
    id: randomUUID(),
    hostToken,
    isPrivate,
    roomCode: isPrivate ? generateRoomCode() : null,
    tier,
    version: 1,
    status: "playing",
    street: "preflop",
    handNumber: 1,
    buttonPosition: 0,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    currentPlayer: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    nextHandAt: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    pot: 0,
    rake: 0,
    deck: [],
    community: [],
    seats,
    winners: [],
    log: [],
    message: "",
    createdAt: now,
    updatedAt: now,
    tournament: null,
  };
  // Rotate the starting cast per table instead of always seating the same
  // first SEAT_COUNT-1 pool entries in the same order. The seats above are
  // built from a fixed slice of botProfiles, so without this every fresh
  // table would open on the identical five bots (maya_ontilt, theo_wit_it,
  // riverrat_rj, priyapushes, wrenzo_44), which is why "priya" and "river"
  // used to show up at every table a player loaded into. pickBotIdentity is
  // seeded off state.id, so reusing it here varies the opening lineup per
  // table the same way a mid-game reseat already varies who sits back down.
  for (const seat of state.seats) {
    if (!seat.isHuman) restoreBotControl(seat, pickBotIdentity(state, seat.position));
  }
  setupHand(state, true);
  return state;
}

/** A heads-up match is always exactly two human seats, never bot-fillable. */
export const HEADS_UP_SEAT_COUNT = 2;

/**
 * Builds a fresh heads-up match: two human seats, no bots, fixed blinds for
 * the tier, and a `tournament` record that ends the table the instant one
 * seat runs out of chips (see `setupHand`'s funded-seat check). Both
 * entrants buy in for exactly the tier's stack -- there is no separate
 * buy-in choice the way the cash lobby offers one, since the entry fee and
 * the eventual winner-take-all payout both have to agree on a single fixed
 * number (see `TournamentState`'s own comment on why the payout is computed
 * from `entryFee`, not read off the live stack).
 */
export function createHeadsUpGame(
  entrants: Array<{
    token: string;
    profile: Pick<
      PlayerProfile,
      "id" | "isRegistered" | "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped"
    >;
  }>,
  tier: StakesTier,
): GameState {
  if (entrants.length !== HEADS_UP_SEAT_COUNT) {
    throw new Error(`A heads-up match needs exactly ${HEADS_UP_SEAT_COUNT} entrants.`);
  }
  const now = new Date().toISOString();
  const config = TIER_CONFIG[tier];
  const startingStack = config.minBuyIn;

  const seats: Seat[] = entrants.map((entrant, index) => ({
    id: randomUUID(),
    name: entrant.profile.displayName.slice(0, 18) || "Player",
    initials: entrant.profile.initials,
    accent: entrant.profile.accent,
    avatarUrl: entrant.profile.avatarUrl,
    avatarPreset: entrant.profile.avatarPreset,
    avatarCosmetic: entrant.profile.equipped?.avatar2d ?? DEFAULT_AVATAR_COSMETIC,
    cardBackCosmetic: entrant.profile.equipped?.cardBack ?? DEFAULT_CARD_BACK,
    chipDesigns: entrant.profile.equipped?.chipDesigns ?? {},
    position: index,
    isHuman: true,
    ownerToken: entrant.token,
    // Unconditionally, guest or not -- a deliberate exception to the normal
    // "guests get null" rule (see Seat.profileId's own comment), the same
    // one createTournamentGame makes for a Sit & Go: a guest can win a
    // heads-up match too, and settlement has to be able to credit them.
    profileId: entrant.profile.id,
    botIdentity: null,
    personality: null,
    stack: startingStack,
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
  }));

  const state: GameState = {
    id: randomUUID(),
    // Auditing only, same contract as createGame's hostToken -- never an
    // authorization check. There is no single "host" in a matched heads-up
    // table, so this is just whichever entrant was listed first.
    hostToken: entrants[0].token,
    // Never surfaced by findOpenPublicGame's cash-table matchmaking; heads-up
    // has its own quick-play/invite matchmaking that never reads this flag.
    isPrivate: true,
    roomCode: null,
    tier,
    version: 1,
    status: "playing",
    street: "preflop",
    handNumber: 1,
    buttonPosition: 0,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    currentPlayer: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    nextHandAt: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    pot: 0,
    rake: 0,
    deck: [],
    community: [],
    seats,
    winners: [],
    log: [],
    message: "",
    createdAt: now,
    updatedAt: now,
    tournament: {
      format: "heads_up",
      entryFee: startingStack,
      startingStack,
      // Unused for heads-up -- see TournamentState's own comment. Zero
      // rather than omitted, since every tournament shares the one shape.
      blindLevel: 0,
      finishedAtHand: null,
      winnerProfileId: null,
    },
  };
  setupHand(state, true);
  return state;
}

/**
 * Builds a fresh Sit & Go table: exactly SEAT_COUNT human seats, every one
 * funded at the tier's own buy-in, and deals hand 1 immediately -- the
 * tournament equivalent of createGame, called once by
 * lib/server/sit-and-go-service.ts the instant a table's last seat fills.
 *
 * Unlike createGame there are no bot seats to fill out and no per-seat buy-in
 * choice: every entrant already paid the same fixed entry fee to register
 * (lib/server/sit-and-go-service.ts), so every seat gets the same starting
 * stack, and every seat needs a real, non-null profileId (unlike claimSeat,
 * which leaves a guest's profileId null) since a Sit & Go settles Gold to
 * this id once the table is decided.
 */
export function createTournamentGame(
  entrants: Array<{
    token: string;
    profile: Pick<
      PlayerProfile,
      "id" | "isRegistered" | "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped"
    >;
  }>,
  tier: StakesTier,
): GameState {
  if (entrants.length !== SEAT_COUNT) {
    throw new Error(`A Sit & Go needs exactly ${SEAT_COUNT} entrants.`);
  }
  const now = new Date().toISOString();
  const config = TIER_CONFIG[tier];
  const startingStack = config.minBuyIn;

  const seats: Seat[] = entrants.map(({ token, profile }, position) => ({
    id: randomUUID(),
    name: profile.displayName.slice(0, 18) || "Player",
    initials: profile.initials,
    accent: profile.accent,
    avatarUrl: profile.avatarUrl,
    avatarPreset: profile.avatarPreset,
    avatarCosmetic: profile.equipped.avatar2d,
    cardBackCosmetic: profile.equipped.cardBack,
    chipDesigns: profile.equipped.chipDesigns,
    position,
    isHuman: true,
    ownerToken: token,
    profileId: profile.id,
    botIdentity: null,
    personality: null,
    stack: startingStack,
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
  }));

  const state: GameState = {
    id: randomUUID(),
    hostToken: entrants[0].token,
    // True even though there's no join-by-room-code flow for this table at
    // all: it keeps a Sit & Go table invisible to findOpenPublicGame/quick
    // play, which would otherwise see six human seats and just find nothing
    // open, but there's no reason to make that path reason about a format it
    // was never built for.
    isPrivate: true,
    roomCode: null,
    tier,
    version: 1,
    status: "playing",
    street: "preflop",
    handNumber: 1,
    buttonPosition: 0,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    currentPlayer: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    nextHandAt: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    pot: 0,
    rake: 0,
    deck: [],
    community: [],
    seats,
    winners: [],
    log: [],
    message: "",
    createdAt: now,
    updatedAt: now,
    tournament: {
      format: "sit_and_go",
      entryFee: startingStack,
      startingStack,
      blindLevel: 0,
      finishedAtHand: null,
      winnerProfileId: null,
    },
  };
  // setupHand's own tournament branch recomputes smallBlind/bigBlind from
  // blindLevelForHand(1, ...) immediately, so the placeholder level-0 values
  // set above only matter for the instant between object construction and
  // this call -- there is no special-cased "hand 1" blind logic anywhere.
  setupHand(state, true);
  return state;
}

/**
 * Seats a player at an open (bot-controlled) seat, converting it to a human
 * seat under their session token. If they already own a seat here (e.g.
 * revisiting a room-code link), returns that seat instead of claiming a new
 * one. A seat a previous occupant busted out of gets a fresh buy-in.
 *
 * Claiming a seat mid-hand does not buy into the hand already in progress:
 * the new occupant sits out (see `takingOverLiveHand` below) and joins at the
 * next deal, same as sitting down between hands at a real table.
 */
export function claimSeat(
  state: GameState,
  token: string,
  profile: Pick<
    PlayerProfile,
    "id" | "isRegistered" | "displayName" | "initials" | "accent" | "avatarUrl" | "avatarPreset" | "equipped"
  >,
  buyIn?: number,
): { state: GameState; seatIndex: number } {
  const existing = state.seats.findIndex((seat) => seat.ownerToken === token);
  if (existing !== -1) return { state, seatIndex: existing };

  const seatIndex = state.seats.findIndex((seat) => seat.ownerToken === null);
  if (seatIndex === -1) throw new Error("This table is full.");

  const seat = state.seats[seatIndex];
  const paidBuyIn = buyIn === undefined ? 1000 : clampBuyIn(state.tier, buyIn);
  if (seat.committed > paidBuyIn) {
    throw new Error("Choose a buy-in that covers this seat's committed chips.");
  }
  // The bot in this seat can be mid-hand (dealt in, maybe already acted or
  // folded) the instant a human claims it. Those hole cards and that
  // position were never this player's to inherit: without this, they'd take
  // over the bot's actual hand, which could hand them a live turn (or even
  // an uncontested win) on cards they never saw dealt. `status !== "out"`
  // excludes the seat that was already sitting out this hand for want of
  // funding at the table floor; there's nothing to neutralize there.
  const takingOverLiveHand = state.status === "playing" && seat.status !== "out";
  const wasCurrentTurn = state.currentPlayer === seatIndex;

  seat.isHuman = true;
  seat.ownerToken = token;
  // The one place a profile id enters a seat. Guests stay null: a guest
  // profile dies with its cookie, and a friend request addressed to one can
  // never be accepted. See Seat.profileId.
  seat.profileId = profile.isRegistered ? profile.id : null;
  // The chair stops wearing a pool identity the moment a person is in it, so
  // the normalize path cannot re-derive a bot's face over the top of theirs.
  seat.botIdentity = null;
  seat.personality = null;
  // Whoever sat here before does not follow the new occupant into the seat.
  seat.missedTurns = 0;
  seat.name = profile.displayName.slice(0, 18) || "Player";
  seat.initials = profile.initials;
  seat.accent = profile.accent;
  seat.avatarUrl = profile.avatarUrl;
  seat.avatarPreset = profile.avatarPreset;
  seat.avatarCosmetic = profile.equipped.avatar2d;
  seat.cardBackCosmetic = profile.equipped.cardBack;
  seat.chipDesigns = profile.equipped.chipDesigns;
  // A claimed seat owns exactly the buy-in the player paid for, including chips
  // this seat already committed before the bot was replaced. Resetting the
  // behind-stack to the full buy-in would mint every posted blind/bet again.
  seat.stack = paidBuyIn - seat.committed;
  // Never inherited, live hand or not: stale hole cards left over from
  // whoever or whatever sat here before are not this occupant's to see.
  seat.holeCards = [];

  if (takingOverLiveHand) {
    // Sat out for the rest of this hand: the same status setupHand already
    // gives a seat with no stake in the current hand, and the one it will
    // overwrite back to "active" at the very next deal. The seat keeps
    // whatever it already committed to this pot; that's now contested
    // chips, exactly as when any other seat leaves mid-hand.
    seat.status = "out";
    seat.acted = false;
    seat.actedAtBet = null;
    seat.lastAction = null;
    const contenders = remaining(state);
    if (contenders.length === 1) {
      awardUncontested(state, contenders[0]);
    } else if (wasCurrentTurn) {
      // It was this seat's turn the moment it changed hands. Nobody can act
      // in its place, so play moves on exactly as it would if this seat had
      // just folded.
      if (bettingComplete(state)) {
        advanceStreet(state);
      } else {
        setCurrentPlayer(state, nextSeat(state, seatIndex, canAct));
        if (state.currentPlayer === null) advanceStreet(state);
      }
    }
  }

  state.version += 1;
  state.updatedAt = new Date().toISOString();
  return { state, seatIndex };
}

/**
 * Gives up a seat, handing control back to a bot under the seat's original
 * identity. If it happens to be this seat's turn right now, the seat is no
 * longer human-controlled, so the ordinary timed-turn advance
 * (`advanceTimedTurn`, driven by `resolveTimedAdvance` in game-store.ts)
 * resolves it on its own paced deadline: no separate "resolve their
 * pending turn" step needed.
 *
 * Returns the chips the departing player still had in front of them, which
 * the caller cashes back out to Gold. Chips already committed to the
 * current pot are excluded: once they're in the middle they're contested,
 * exactly as at a real table.
 */
export function vacateSeat(state: GameState, token: string): { state: GameState; cashedOut: number } {
  const seatIndex = state.seats.findIndex((seat) => seat.ownerToken === token);
  if (seatIndex === -1) throw new Error("You are not seated at this table.");

  const seat = state.seats[seatIndex];
  const cashedOut = seat.stack;
  restoreBotControl(seat, pickBotIdentity(state, seat.position));
  // Those chips leave the table with the player, so the seat must not keep
  // them too, or every departure would mint the stack a second time. The
  // replacement bot sits down fresh for the table minimum.
  seat.stack = TIER_CONFIG[state.tier].minBuyIn;
  if (state.currentPlayer === seatIndex) setCurrentPlayer(state, seatIndex);

  return { state, cashedOut };
}

export function getLegalActions(state: GameState, seatIndex: number): LegalActions {
  const seat = state.seats[seatIndex];
  const isTurn = state.status === "playing" && state.currentPlayer === seatIndex && canAct(seat);
  const toCall = Math.max(0, state.currentBet - seat.streetBet);
  const maxRaiseTo = seat.streetBet + seat.stack;
  const minRaiseTo = state.currentBet + state.minRaise;
  const raiseReopened = !seat.acted
    || seat.actedAtBet === null
    || state.currentBet - seat.actedAtBet >= state.minRaise;
  const canMakeAggressiveAction = raiseReopened || maxRaiseTo <= state.currentBet;
  return {
    // Folding when a check is available is strategically unusual but legal,
    // and players expect the control to remain available on every street.
    canFold: isTurn,
    canCheck: isTurn && toCall === 0,
    canCall: isTurn && toCall > 0 && seat.stack > 0,
    canRaise: isTurn
      && raiseReopened
      && maxRaiseTo > state.currentBet
      && maxRaiseTo >= minRaiseTo,
    // An all-in button cannot bypass the reopening rule. When action has not
    // reopened, shoving is available only if it is no more than a call.
    canAllIn: isTurn && seat.stack > 0 && canMakeAggressiveAction,
    toCall,
    callAmount: Math.min(toCall, seat.stack),
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
  };
}

function bettingComplete(state: GameState) {
  return state.seats.every(
    (seat) =>
      seat.status === "folded" ||
      seat.status === "out" ||
      seat.status === "all-in" ||
      (seat.acted && seat.streetBet === state.currentBet),
  );
}

function remaining(state: GameState) {
  return state.seats.filter((seat) => seat.status !== "folded" && seat.status !== "out");
}

/**
 * The house's cut of each pot, and the Gold economy's primary structural
 * sink. Tables are populated by bots, so every pot a human wins from an AI
 * seat would otherwise mint Gold from nothing; rake is the counterweight.
 *
 * Two things hold rake off a pot. The minimum-pot floor keeps the house out
 * of small pots entirely. Separately, and regardless of size, nothing is
 * taken from a hand that never saw a flop, the standard "no flop, no drop"
 * rule, enforced in deductRake below.
 *
 * The floor alone isn't enough to cover that: it's tempting to reason that a
 * preflop steal of the blinds never clears ten big blinds, but that's true
 * only of a steal, not of the hand it stands in for. At 5/10 an open to 30
 * and a three-bet to 100 leaves a 135 pot, which clears the floor and gets
 * raked. Raising, taking it down uncontested, and still losing chips to the
 * house is the single worst-feeling outcome a poker client can produce.
 */
const RAKE_RATE = 0.04;
const RAKE_CAP_BB = 3;
const RAKE_MIN_POT_BB = 10;

function rakeFor(pot: number, bigBlind: number): number {
  if (pot < bigBlind * RAKE_MIN_POT_BB) return 0;
  return Math.min(Math.floor(pot * RAKE_RATE), bigBlind * RAKE_CAP_BB);
}

/**
 * Removes rake from a hand's winnings in place and returns the amount taken.
 * Split across winners in proportion to what each is owed, so a chopped pot
 * charges both players evenly instead of billing whoever sorts first; the
 * last winner absorbs the rounding remainder so the books always balance.
 */
function deductRake(state: GameState, winnings: Map<string, number>): number {
  // Neither tournament format is raked. A Sit & Go's prize pool is a fixed
  // entryFee * seat count with no house edge to skim from; a heads-up
  // match's settlement pays the winner exactly entryFee * 2 on the
  // assumption that nothing ever left the two stacks along the way -- both
  // are PvP between funded humans, not a bot-populated cash table, and the
  // "winner-take-all, no rake" rule already holds for every other PvP
  // format (duels, cribbage). No flop, no drop applies only to the cash
  // path below: only reachable from awardUncontested, since showdown() runs
  // the board out to five cards before it rakes, so a hand that got all-in
  // preflop and was dealt a run-out is still raked (a flop was dealt, and
  // the house did provide the pot) -- this guard is for the hand that ended
  // before any board existed at all.
  if (state.tournament || state.community.length === 0) return 0;
  const total = [...winnings.values()].reduce((sum, amount) => sum + amount, 0);
  const rake = rakeFor(total, state.bigBlind);
  if (rake <= 0) return 0;

  const ordered = [...winnings.entries()].sort((a, b) => b[1] - a[1]);
  let outstanding = rake;
  ordered.forEach(([seatId, amount], index) => {
    const isLast = index === ordered.length - 1;
    const share = isLast
      ? Math.min(outstanding, amount)
      : Math.min(outstanding, Math.floor((rake * amount) / total));
    outstanding -= share;
    winnings.set(seatId, amount - share);
  });
  return rake - outstanding;
}

function awardUncontested(state: GameState, seat: Seat) {
  const potTotal = state.seats.reduce((sum, candidate) => sum + candidate.committed, 0);
  const winnings = new Map([[seat.id, potTotal]]);
  state.rake = deductRake(state, winnings);
  const amount = winnings.get(seat.id)!;

  seat.stack += amount;
  state.pot = potTotal;
  state.winners = [{ seatId: seat.id, name: seat.name, amount, hand: "Uncontested", bestFive: null }];
  state.street = "showdown";
  state.status = "complete";
  // advanceStreet clears every seat's streetBet when a street turns over --
  // that's what tells the frontend a standing bet has been swept to the pot
  // (optimistic-action.ts's pot - Σ streetBet invariant) and lets the
  // .table-bet pill (player-seat.tsx) disappear. An uncontested win never
  // goes through advanceStreet's normal path, so without this the last
  // street's bettors kept a stale nonzero streetBet after the chips had
  // already been paid out -- a bet-amount pill floating on empty felt with
  // no pile under it.
  state.seats.forEach((candidate) => {
    candidate.streetBet = 0;
    candidate.acted = false;
    candidate.actedAtBet = null;
  });
  setCurrentPlayer(state, null);
  scheduleNextHand(state);
  state.message = `${seat.name} wins ${amount}`;
  addLog(state, `${seat.name} wins ${amount} uncontested`, "win");
}

function sidePotWinners(
  eligible: Seat[],
  scores: Map<string, HandScore>,
): Seat[] {
  let best: HandScore | null = null;
  let winners: Seat[] = [];
  eligible.forEach((seat) => {
    const score = scores.get(seat.id)!;
    const comparison = best ? compareScores(score, best) : 1;
    if (comparison > 0) {
      best = score;
      winners = [seat];
    } else if (comparison === 0) winners.push(seat);
  });
  return winners;
}

function showdown(state: GameState) {
  while (state.community.length < 5) {
    dealToCommunity(state, state.community.length === 0 ? 3 : 1);
  }
  const contenders = remaining(state);
  // One pass per contender captures both the score (for comparing hands) and
  // the winning five-card combination (for the win message): evaluateHand
  // and bestFiveCards each run the same C(7,5) search independently, so
  // calling both back to back would search the same cards twice.
  const evaluations = new Map(
    contenders.map((seat) => [seat.id, evaluateHandDetailed([...seat.holeCards, ...state.community])]),
  );
  const scores = new Map([...evaluations].map(([seatId, evaluation]) => [seatId, evaluation.score]));
  const levels = [...new Set(state.seats.map((seat) => seat.committed).filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  const winnings = new Map<string, number>();

  levels.forEach((level) => {
    const contributors = state.seats.filter((seat) => seat.committed >= level);
    const potAmount = (level - previous) * contributors.length;
    const eligible = contributors.filter((seat) => seat.status !== "folded" && seat.status !== "out");
    if (eligible.length > 0) {
      const winners = sidePotWinners(eligible, scores);
      const share = Math.floor(potAmount / winners.length);
      let remainder = potAmount - share * winners.length;
      const ordered = [...winners].sort(
        (a, b) =>
          ((a.position - state.buttonPosition - 1 + state.seats.length) % state.seats.length) -
          ((b.position - state.buttonPosition - 1 + state.seats.length) % state.seats.length),
      );
      ordered.forEach((winner) => {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        winnings.set(winner.id, (winnings.get(winner.id) ?? 0) + share + extra);
      });
    }
    previous = level;
  });

  state.rake = deductRake(state, winnings);

  const winners: Winner[] = [...winnings.entries()].map(([seatId, amount]) => {
    const seat = state.seats.find((candidate) => candidate.id === seatId)!;
    seat.stack += amount;
    return {
      seatId,
      name: seat.name,
      amount,
      hand: scores.get(seatId)!.name,
      // Safe here and only here: this is the showdown path, so these hole
      // cards are already revealed to everyone by toSnapshot.
      // awardUncontested leaves this null; see the field's comment in
      // types.ts.
      bestFive: evaluations.get(seatId)!.cards,
    };
  });
  state.winners = winners.sort((a, b) => b.amount - a.amount);
  state.pot = state.seats.reduce((sum, seat) => sum + seat.committed, 0);
  state.street = "showdown";
  state.status = "complete";
  // Same reset advanceStreet does on every other street turn, and for the
  // same reason -- see the matching comment in awardUncontested. Reaching
  // showdown from the river skips advanceStreet's own reset entirely (its
  // "next === showdown" branch calls straight into this function), so
  // river bettors otherwise keep a stale streetBet after their chips have
  // already been paid out at the table.
  state.seats.forEach((candidate) => {
    candidate.streetBet = 0;
    candidate.acted = false;
    candidate.actedAtBet = null;
  });
  setCurrentPlayer(state, null);
  scheduleNextHand(state);
  state.message = winners.map((winner) => `${winner.name} wins ${winner.amount} · ${winner.hand}`).join(" / ");
  addLog(state, state.message, "win");
}

function advanceStreet(state: GameState) {
  const next = streetOrder[streetOrder.indexOf(state.street) + 1];
  if (!next || next === "showdown") {
    showdown(state);
    return;
  }
  state.street = next;
  dealToCommunity(state, next === "flop" ? 3 : 1);
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.seats.forEach((seat) => {
    seat.streetBet = 0;
    seat.acted = false;
    seat.actedAtBet = null;
    seat.lastAction = null;
  });
  addLog(state, `${next[0].toUpperCase()}${next.slice(1)} dealt`, "deal");

  const first = nextSeat(state, state.buttonPosition, canAct);
  setCurrentPlayer(state, first);
  state.message = `${next[0].toUpperCase()}${next.slice(1)}`;
  if (first === null || state.seats.filter(canAct).length <= 1) {
    advanceStreet(state);
  }
}

function progressAfterAction(state: GameState, actorIndex: number) {
  state.pot = state.seats.reduce((sum, seat) => sum + seat.committed, 0);
  const contenders = remaining(state);
  if (contenders.length === 1) {
    awardUncontested(state, contenders[0]);
    return;
  }
  if (bettingComplete(state)) {
    advanceStreet(state);
    return;
  }
  setCurrentPlayer(state, nextSeat(state, actorIndex, canAct));
  if (state.currentPlayer === null) advanceStreet(state);
}

function applyTurnAction(state: GameState, action: TurnAction) {
  const actorIndex = state.currentPlayer;
  if (actorIndex === null) throw new Error("There is no active turn.");
  const seat = state.seats[actorIndex];
  const legal = getLegalActions(state, actorIndex);
  const toCall = legal.toCall;

  // VPIP: every path below except fold and check commits chips, and a check
  // preflop only exists when toCall is 0 (nobody raised), so "not fold, not
  // check, preflop" already means "chose to put money in beyond the blind."
  if (state.street === "preflop" && action.type !== "fold" && action.type !== "check") {
    seat.vpip = true;
  }

  if (action.type === "fold") {
    if (!legal.canFold) throw new Error("Folding is not available.");
    seat.status = "folded";
    seat.acted = true;
    seat.lastAction = "Fold";
    addLog(state, `${seat.name} folds`);
  } else if (action.type === "check") {
    if (!legal.canCheck) throw new Error(`There is ${toCall} to call.`);
    seat.acted = true;
    seat.lastAction = "Check";
    addLog(state, `${seat.name} checks`);
  } else if (action.type === "call") {
    if (!legal.canCall) throw new Error("Calling is not available.");
    const paid = commit(seat, toCall);
    seat.acted = true;
    seat.lastAction = paid < toCall ? `All-in · ${paid}` : `Call · ${paid}`;
    addLog(state, `${seat.name} ${paid < toCall ? "is all-in for" : "calls"} ${paid}`);
  } else {
    if (action.type === "raise" && !legal.canRaise) {
      throw new Error("Raising is not available.");
    }
    if (action.type === "all-in" && !legal.canAllIn) {
      throw new Error("Going all-in would be an illegal raise.");
    }
    if (action.type !== "all-in" && !Number.isFinite(action.amount)) {
      throw new Error("Raise amount must be a finite number.");
    }
    const raiseTo = action.type === "all-in" ? legal.maxRaiseTo : Math.floor(action.amount);
    if (raiseTo <= state.currentBet) {
      if (action.type === "all-in") {
        const paid = commit(seat, toCall);
        seat.acted = true;
        seat.lastAction = `All-in · ${paid}`;
        addLog(state, `${seat.name} is all-in for ${paid}`);
      } else throw new Error("Raise must exceed the current bet.");
    } else {
      if (raiseTo > legal.maxRaiseTo) throw new Error("That raise exceeds your stack.");
      const openingBet = state.currentBet === 0;
      const raiseSize = raiseTo - state.currentBet;
      const isShortAllIn = raiseTo === legal.maxRaiseTo && raiseSize < state.minRaise;
      if (raiseSize < state.minRaise && !isShortAllIn) {
        throw new Error(`Minimum raise is to ${state.currentBet + state.minRaise}.`);
      }
      commit(seat, raiseTo - seat.streetBet);
      if (!isShortAllIn) {
        state.minRaise = raiseSize;
        state.seats.forEach((candidate) => {
          if (candidate.id !== seat.id && canAct(candidate)) candidate.acted = false;
        });
      }
      state.currentBet = raiseTo;
      seat.acted = true;
      seat.lastAction = seat.status === "all-in"
        ? `All-in · ${raiseTo}`
        : openingBet ? `Bet · ${raiseTo}` : `Raise to · ${raiseTo}`;
      addLog(
        state,
        `${seat.name} ${
          seat.status === "all-in" ? "is all-in for" : openingBet ? "bets" : "raises to"
        } ${raiseTo}`,
      );
    }
  }
  seat.actedAtBet = state.currentBet;
  progressAfterAction(state, actorIndex);
}

type BotRandom = () => number;

const secureBotRandom: BotRandom = () => randomInt(1_000_000) / 1_000_000;

const personalityProfiles: Record<
  BotPersonality,
  {
    aggression: number;
    callTolerance: number;
    equityAdjustment: number;
    slowPlayFrequency: number;
    postflopBetSizes: number[];
    /**
     * Chance to ignore the tier chart's hard preflop fold on a "trash" hand
     * and fall through to the normal call/raise/fold cascade instead, same
     * as the personality-independent `BOT_BLUFF_FREQUENCY` gate already does
     * at 5%. This is the actual VPIP knob per personality; everything else
     * here only shapes what happens once a hand is already being played.
     */
    trashContinueChance: number;
    /**
     * Shaves this many percentage points off the equity bar a shove needs to
     * clear postflop (see `postflopShove` in `chooseBotAction`). Zero for
     * everyone but the Loose Cannon, who reaches for all-in with merely-good
     * equity/a strong draw rather than only the nuts.
     */
    shoveEquityDiscount: number;
    /**
     * Added to the raise-decision threshold when at least one seat has
     * already limped in preflop. Zero for everyone but the Table Captain,
     * whose whole thing is punishing a limp with a raise.
     */
    limperPunishBonus: number;
  }
> = {
  // "Loose Cannon": very aggressive, wide range, shoves early.
  MANIAC: {
    aggression: 0.72,
    callTolerance: 0.08,
    equityAdjustment: 0.02,
    slowPlayFrequency: 0.06,
    postflopBetSizes: [0.6, 0.75, 0.9, 1.25],
    trashContinueChance: 0.38,
    shoveEquityDiscount: 0.08,
    limperPunishBonus: 0,
  },
  // "Table Captain": balanced-aggressive, plays a tighter range well.
  ROCK: {
    aggression: 0.5,
    callTolerance: 0,
    equityAdjustment: -0.005,
    slowPlayFrequency: 0.18,
    postflopBetSizes: [0.33, 0.5, 0.66, 0.75, 1],
    trashContinueChance: 0.14,
    shoveEquityDiscount: 0,
    limperPunishBonus: 0.18,
  },
  // "Whale": very loose, very passive, wants to see almost every flop.
  CALLING_STATION: {
    aggression: 0.14,
    callTolerance: 0.18,
    equityAdjustment: 0,
    slowPlayFrequency: 0.12,
    postflopBetSizes: [0.4, 0.5, 0.66],
    trashContinueChance: 0.55,
    shoveEquityDiscount: 0,
    limperPunishBonus: 0,
  },
};

export type PreflopHandTier = "premium" | "strong" | "playable" | "speculative" | "trash";

const rankOrder: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const premiumPreflopHands = new Set(["AA", "KK", "QQ", "JJ", "AKs", "AKo"]);
const strongPreflopHands = new Set(["TT", "99", "AQs", "AQo", "AJs", "KQs"]);
const playablePreflopHands = new Set([
  "88", "77", "66", "55", "44", "33", "22",
  "ATs", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s",
  "KJs", "KTs", "QJs", "QTs", "JTs", "T9s", "98s", "87s", "76s",
  "AJo", "KQo",
]);
const speculativePreflopHands = new Set([
  "K9s", "Q9s", "J9s", "T8s", "97s", "86s", "75s", "65s", "54s",
  "ATo", "KJo", "QJo", "JTo",
]);

function preflopKey([first, second]: Card[]): string {
  if (!first || !second) return "";
  if (first.rank === second.rank) return `${first.rank}${second.rank}`;
  const [high, low] = rankOrder[first.rank] >= rankOrder[second.rank]
    ? [first, second]
    : [second, first];
  return `${high.rank}${low.rank}${first.suit === second.suit ? "s" : "o"}`;
}

/**
 * A compact six-max starting-hand chart. Sklansky-Chubukov numbers are
 * heads-up open-shove limits rather than a general cash-game opening chart,
 * so the bot uses their core idea (starting-hand discipline) without turning
 * a 100-BB six-max table into push/fold poker.
 */
export function preflopHandTier(holeCards: Card[]): PreflopHandTier {
  const key = preflopKey(holeCards);
  if (premiumPreflopHands.has(key)) return "premium";
  if (strongPreflopHands.has(key)) return "strong";
  if (playablePreflopHands.has(key)) return "playable";
  if (speculativePreflopHands.has(key)) return "speculative";
  return "trash";
}

const cardKey = (card: Card) => `${card.rank}:${card.suit}`;
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
const BOT_BLUFF_FREQUENCY = 0.05;

function drawUnknownCard(pool: Card[], random: BotRandom): Card {
  const roll = clampUnit(random());
  const index = Math.min(pool.length - 1, Math.floor(roll * pool.length));
  return pool.splice(index, 1)[0];
}

/**
 * Estimates showdown equity using only information the bot is entitled to:
 * its own cards, the public board, and the number of live opponents. Actual
 * opponent cards and the server's remaining deck are ignored.
 */
export function estimateBotEquity(
  state: GameState,
  seatIndex: number,
  simulations = 56,
  random: BotRandom = secureBotRandom,
): number {
  const seat = state.seats[seatIndex];
  if (seat.holeCards.length !== 2) return 0;

  const opponents = state.seats.filter(
    (candidate, index) =>
      index !== seatIndex
      && candidate.status !== "folded"
      && candidate.status !== "out",
  ).length;
  if (opponents === 0) return 1;

  const known = new Set([...seat.holeCards, ...state.community].map(cardKey));
  const unknown = DECK_TEMPLATE.filter((card) => !known.has(cardKey(card)));
  let equity = 0;

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const pool = [...unknown];
    const opponentHands = Array.from({ length: opponents }, () => [
      drawUnknownCard(pool, random),
      drawUnknownCard(pool, random),
    ]);
    const board = [...state.community];
    while (board.length < 5) board.push(drawUnknownCard(pool, random));

    const heroScore = evaluateHand([...seat.holeCards, ...board]);
    let tiedWinners = 1;
    let beaten = false;
    opponentHands.forEach((hand) => {
      const comparison = compareScores(evaluateHand([...hand, ...board]), heroScore);
      if (comparison > 0) beaten = true;
      else if (comparison === 0) tiedWinners += 1;
    });
    if (!beaten) equity += 1 / tiedWinners;
  }

  return equity / Math.max(1, simulations);
}

function positionAdvantage(state: GameState, seatIndex: number): number {
  const order: number[] = [];
  let cursor = state.buttonPosition;
  for (let count = 0; count < state.seats.length; count += 1) {
    const next = nextSeat(
      state,
      cursor,
      (seat) => seat.status !== "folded" && seat.status !== "out",
    );
    if (next === null || order.includes(next)) break;
    order.push(next);
    cursor = next;
  }
  const position = order.indexOf(seatIndex);
  return position < 0 || order.length < 2 ? 0.5 : position / (order.length - 1);
}

// Normal bot bets stop at one pot and leave at least one big blind behind.
// Committing the stack is a separate, tightly gated decision; a rounded
// raise must never accidentally turn into another shove. Shared by
// botRaiseTarget (what to raise to) and chooseBotAction (whether raising at
// all is even legal within that ceiling) so the two caps can't drift.
function botRaiseCaps(state: GameState, legal: LegalActions): { potSizedCap: number; nonAllInCap: number } {
  const potSizedCap = state.currentBet === 0
    ? Math.max(state.bigBlind, state.pot)
    : state.currentBet + state.pot + legal.toCall;
  const nonAllInCap = legal.maxRaiseTo - Math.min(state.bigBlind, legal.maxRaiseTo);
  return { potSizedCap, nonAllInCap };
}

function botRaiseTarget(
  state: GameState,
  legal: LegalActions,
  style: (typeof personalityProfiles)[BotPersonality],
  random: BotRandom,
): number {
  let target: number;
  if (state.street === "preflop") {
    const limpers = state.seats.filter(
      (seat) => seat.vpip && seat.streetBet === state.currentBet,
    ).length;
    target = state.currentBet <= state.bigBlind
      ? state.bigBlind * (2.25 + random() * 0.9 + limpers)
      : state.currentBet * (2.35 + random() * 0.75);
  } else {
    const sizes = style.postflopBetSizes;
    const fraction = sizes[Math.min(sizes.length - 1, Math.floor(clampUnit(random()) * sizes.length))];
    const potAfterCall = Math.max(state.bigBlind, state.pot + legal.toCall);
    target = state.currentBet === 0
      ? potAfterCall * fraction
      : state.currentBet + Math.max(state.minRaise, potAfterCall * fraction);
  }

  const rounded = Math.max(
    legal.minRaiseTo,
    Math.round(target / state.bigBlind) * state.bigBlind,
  );
  const { potSizedCap, nonAllInCap } = botRaiseCaps(state, legal);
  return Math.min(potSizedCap, nonAllInCap, rounded);
}

/**
 * Mixed, equity-aware bot strategy. The random source is injectable so rule
 * and strategy tests can exercise exact branches without flaky outcomes.
 */
export function chooseBotAction(
  state: GameState,
  seatIndex: number,
  random: BotRandom = secureBotRandom,
): TurnAction {
  const legal = getLegalActions(state, seatIndex);
  const seat = state.seats[seatIndex];
  const style = personalityProfiles[seat.personality ?? "ROCK"];
  const liveOpponents = state.seats.filter(
    (candidate, index) =>
      index !== seatIndex
      && candidate.status !== "folded"
      && candidate.status !== "out",
  );
  const opponents = Math.max(1, liveOpponents.length);
  const allInOpponents = liveOpponents.filter((candidate) => candidate.status === "all-in").length;
  const baselineEquity = 1 / (opponents + 1);
  const rawEquity = estimateBotEquity(state, seatIndex, 56, random);
  const position = positionAdvantage(state, seatIndex);
  const effectiveEquity = clampUnit(
    rawEquity
      + style.equityAdjustment
      + (position - 0.5) * (state.street === "preflop" ? 0.08 : 0.045),
  );
  const potOdds = legal.toCall / Math.max(1, state.pot + legal.toCall);
  const decisionRoll = random();
  const startingTier = preflopHandTier(seat.holeCards);
  const tierStrength: Record<PreflopHandTier, number> = {
    premium: 4,
    strong: 3,
    playable: 2,
    speculative: 1,
    trash: 0,
  };
  const preflopStrength = tierStrength[startingTier];
  const multiwayRiskPremium = Math.min(
    0.24,
    Math.max(0, opponents - 1) * 0.025 + allInOpponents * 0.065,
  );
  const valueRaiseThreshold = Math.max(
    baselineEquity + 0.12 - style.aggression * 0.035,
    potOdds + 0.12 + multiwayRiskPremium,
  );
  const hasValueRaise = effectiveEquity >= valueRaiseThreshold;
  const bluffWindow = position >= 0.58
    && effectiveEquity < baselineEquity + 0.04
    && decisionRoll < BOT_BLUFF_FREQUENCY;
  // The actual VPIP knob: a personality-specific chance to play a "trash"
  // hand anyway rather than being blocked from ever trying, on the same
  // `decisionRoll` the bluff gate above already reads. No extra random()
  // call, so this doesn't shift any downstream draw a seeded test depends
  // on.
  const trashContinueRoll = decisionRoll < style.trashContinueChance;
  const preflopLimpers = state.street === "preflop"
    ? state.seats.filter((candidate) => candidate.vpip && candidate.streetBet === state.currentBet).length
    : 0;
  const { potSizedCap, nonAllInCap } = botRaiseCaps(state, legal);
  const shouldRaise = legal.canRaise
    && (hasValueRaise || bluffWindow)
    && legal.minRaiseTo <= Math.min(potSizedCap, nonAllInCap)
    && decisionRoll < Math.min(
      0.96,
      style.aggression
        + Math.max(0, effectiveEquity - baselineEquity)
        + (preflopLimpers > 0 ? style.limperPunishBonus : 0),
    );

  if (legal.toCall > 0) {
    // Weak offsuit holdings mostly do not drift into multiway pots because a
    // Monte Carlo roll happened to land high. The bluff gate and the
    // personality's own looseness are the two ways in.
    if (
      state.street === "preflop"
      && startingTier === "trash"
      && !bluffWindow
      && !trashContinueRoll
    ) {
      return { type: "fold" };
    }

    const stackInBigBlinds = seat.stack / Math.max(1, state.bigBlind);
    const criticallyShort = stackInBigBlinds < 10;
    const potIsMassive = state.pot >= seat.stack;
    const preflopShove = state.street === "preflop"
      && (
        (criticallyShort && preflopStrength >= (stackInBigBlinds < 6 ? 2 : 3))
        || (potIsMassive && startingTier === "premium")
      );
    const postflopShove = state.street !== "preflop"
      && (
        (
          criticallyShort
          && effectiveEquity >= potOdds + multiwayRiskPremium + 0.18 - style.shoveEquityDiscount
        )
        || (
          potIsMassive
          && effectiveEquity >= (opponents > 1 ? 0.9 : 0.82) - style.shoveEquityDiscount
        )
      );
    if (
      legal.canAllIn
      && (preflopShove || postflopShove)
      && decisionRoll < Math.min(0.9, style.aggression + 0.08)
    ) {
      return { type: "all-in" };
    }
    if (shouldRaise && decisionRoll >= style.slowPlayFrequency) {
      return { type: "raise", amount: botRaiseTarget(state, legal, style, random) };
    }
    if (
      effectiveEquity + style.callTolerance < potOdds + multiwayRiskPremium
      || (
        state.street === "preflop"
        && allInOpponents > 0
        && preflopStrength < (allInOpponents > 1 ? 4 : 3)
      )
    ) {
      return { type: "fold" };
    }
    return legal.canCall ? { type: "call" } : { type: "fold" };
  }

  if (
    state.street === "preflop"
    && startingTier === "trash"
    && !bluffWindow
    && !trashContinueRoll
  ) {
    return legal.canCheck ? { type: "check" } : { type: "fold" };
  }
  if (shouldRaise && decisionRoll >= style.slowPlayFrequency) {
    return { type: "raise", amount: botRaiseTarget(state, legal, style, random) };
  }
  return legal.canCheck ? { type: "check" } : { type: "fold" };
}

/**
 * Makes aggregates created before turn clocks/time cards forward-compatible.
 * The normalized fields are persisted with the next ordinary state update.
 */
export function normalizeGameState(state: GameState): GameState {
  if (!isStakesTier(state.tier)) {
    // Games created before stakes tiers existed (stale in-memory dev state,
    // or Supabase rows persisted before this field was added) have no tier.
    // Fall back to the cheapest tier rather than letting
    // TIER_CONFIG[undefined] crash every reader downstream.
    state.tier = CHEAPEST_TIER;
  }
  // Hands dealt before rake existed carry no rake figure; treat them as unraked.
  if (!Number.isFinite(state.rake)) state.rake = 0;
  // Every table persisted before Sit & Go existed has no such field at all;
  // undefined must become null, not stay undefined, since every tournament
  // branch below tests this with a plain truthiness check.
  if (state.tournament === undefined) state.tournament = null;
  // Tables persisted before continuous play carry no next-hand deadline. Null
  // is the safe reading: the table waits for someone to press Deal, exactly
  // as it did when that row was written.
  if (typeof state.nextHandAt !== "string") state.nextHandAt = null;
  // One pass backfilling every field below: they're independent migrations
  // with no ordering requirement between them, just each seat visited once
  // rather than three times.
  state.seats.forEach((seat) => {
    // Seats persisted before inactivity was tracked have missed nothing
    // that anyone recorded, so they start from zero rather than from
    // undefined, which would make every comparison below NaN and release
    // nobody, silently.
    if (!Number.isInteger(seat.missedTurns) || seat.missedTurns < 0) seat.missedTurns = 0;
    // Tables persisted before staggered bot re-entry existed carry no
    // eligibility timestamp at all. Null reads as "immediately eligible,"
    // which is exactly how every seat already behaved before this existed.
    if (typeof seat.reseatEligibleAt !== "string") seat.reseatEligibleAt = null;
    // Which identity this bot is wearing, for tables persisted before seats
    // carried one. `position` is the right backfill and not merely a safe
    // one: it is the identity that seat has been showing all along, so a
    // table in flight keeps its cast across the deploy instead of renaming
    // every bot at once under its players.
    //
    // Reading a persisted value here rather than recomputing from position
    // is the whole mechanism. Deriving the face from the chair on every
    // load instead would mean a rotated bot reverts to the old identity on
    // the very next snapshot: the rotation would be real in memory and
    // invisible in production.
    if (seat.isHuman) {
      seat.botIdentity = null;
    } else if (!Number.isInteger(seat.botIdentity)) {
      seat.botIdentity = seat.position;
    }
    // Seats persisted before profile ids existed carry undefined, which
    // would reach the client as a missing key and read as "no id" anyway,
    // but only by accident. Null is the same answer said on purpose.
    //
    // Forcing non-humans to null is the load-bearing half. Unlike
    // botIdentity this is never re-derived, so the only way a bot seat
    // could hold an id is if a release path failed to clear one; pinning it
    // here means a stale id cannot survive a single round trip through the
    // store.
    if (!seat.isHuman || typeof seat.profileId !== "string") {
      seat.profileId = null;
    }
    // Tables dealt before avatars existed have seats with no avatar at all,
    // which reaches the renderer as undefined and takes the whole page down.
    // Bots recover their own face from their identity rather than every seat
    // collapsing to one default, which is most of what makes a table look
    // occupied.
    if (!seat.avatarCosmetic) {
      seat.avatarCosmetic = seat.isHuman
        ? DEFAULT_AVATAR_COSMETIC
        : botAvatarFor(seat.botIdentity ?? seat.position);
    }
    // Same story for the deck: every table dealt before this milestone has
    // seats with no card back, and an id of undefined reaches an SVG fill and
    // draws nothing at all where a hidden card should be.
    if (!seat.cardBackCosmetic) {
      seat.cardBackCosmetic = seat.isHuman
        ? DEFAULT_CARD_BACK
        : botCardBackFor(seat.botIdentity ?? seat.position);
    }
    // Same story again: tables dealt before bot chip designs existed have
    // bot seats with no chipDesigns at all, which read as the house default
    // on every denomination -- the exact "all bots look generic" gap this
    // backfills, same as the two checks above.
    if (!seat.isHuman && !seat.chipDesigns) {
      seat.chipDesigns = botChipDesignsFor(seat.botIdentity ?? seat.position);
    }
    // Hands in flight before VPIP existed have no opinion either way; treat
    // as false rather than let `undefined` leak into a stats comparison.
    seat.vpip = Boolean(seat.vpip);
    // Covers both a stored NaN and forward compatibility for hands persisted
    // before betting-reopening tracked the amount each player had already
    // faced (actedAtBet undefined). A legitimate `null` (no bet faced yet
    // this street) is left alone by the `!== null` guard.
    if (seat.actedAtBet !== null && !Number.isFinite(seat.actedAtBet)) {
      seat.actedAtBet = seat.acted ? seat.streetBet : null;
    }
  });
  if (state.currentPlayer === null || state.status !== "playing") {
    state.turnStartedAt = null;
    state.turnDeadlineAt = null;
    return state;
  }
  const startedAt = Date.parse(state.turnStartedAt ?? "");
  if (!Number.isFinite(startedAt)) {
    setCurrentPlayer(state, state.currentPlayer);
    return state;
  }
  if (!state.turnDeadlineAt || !Number.isFinite(Date.parse(state.turnDeadlineAt))) {
    const duration = state.seats[state.currentPlayer].isHuman
      ? TURN_TIMEOUT_MS
      : BOT_DECISION_MIN_MS;
    state.turnDeadlineAt = new Date(startedAt + duration).toISOString();
  }
  return state;
}

export interface TimedTurnAdvance {
  state: GameState;
  actorSeatId: string | null;
  action: TurnAction | null;
  timedOut: boolean;
}

/**
 * Advances at most one due turn. Humans auto-check when checking is free and
 * otherwise auto-fold. Bots make exactly one decision after their persisted
 * think deadline; the next bot receives a fresh deadline, which creates
 * visible pacing instead of resolving a whole table in one request.
 */
/**
 * Replaces a finished hand with the next one, once its deadline has passed.
 *
 * The whole of continuous play. Kept separate from advanceTimedTurn rather
 * than folded into it: that function's contract is "an action and an actor,
 * or nothing happened," and its caller in game-store.ts stops on a null
 * action without persisting anything. A hand dealt inside it would be dealt
 * in memory and thrown away, exactly what happened when it was written that
 * way: the browser sat on a finished table forever because every advance
 * re-dealt a hand nobody ever saved.
 */
/** A seat handed back to the table, and what its occupant is owed for it. */
export interface ReleasedSeat {
  ownerToken: string;
  name: string;
  /** Chips that left the table with them, to be credited as Gold. */
  cashedOut: number;
}

/**
 * Hands back every seat whose occupant has stopped acting.
 *
 * Returns what it released rather than settling it, because settling isn't
 * something the engine can do: chips become Gold through creditGold, which
 * talks to the profile store. vacateSeat has the same split (it returns
 * `cashedOut` and the actions route pays it), and this is the same contract
 * for the path where nobody pressed anything.
 *
 * Getting that wrong would be quiet and expensive: restoreBotControl leaves
 * the stack where it is, so releasing a seat without reporting the balance
 * would simply hand a player's chips to the bot that replaced them.
 *
 * Between hands only. Releasing mid-hand would drop a bot into a seat with
 * chips already committed to the pot and a hand it never chose to play.
 */
export function releaseInactiveSeats(state: GameState): ReleasedSeat[] {
  // No bot fill in a Sit & Go: an AFK tournament seat keeps timing out
  // through the ordinary advanceTimedTurn path (auto-check/auto-fold) until
  // blinds eat its stack, rather than being handed to a bot after three
  // missed turns the way a cash seat is.
  if (state.tournament) return [];
  const released: ReleasedSeat[] = [];
  state.seats.forEach((seat) => {
    if (!seat.isHuman || !seat.ownerToken) return;
    if (seat.missedTurns < MAX_MISSED_TURNS) return;

    const record: ReleasedSeat = {
      ownerToken: seat.ownerToken,
      name: seat.name,
      cashedOut: Math.max(0, seat.stack),
    };
    addLog(state, `${seat.name} is away and gives up the seat`);
    restoreBotControl(seat, pickBotIdentity(state, seat.position));
    // Same reasoning as vacateSeat: those chips leave with the player, so the
    // seat must not keep them as well or every departure mints a stack.
    seat.stack = TIER_CONFIG[state.tier].minBuyIn;
    released.push(record);
  });
  return released;
}

export function dealNextHandIfDue(
  state: GameState,
  now = Date.now(),
): { state: GameState; dealt: boolean; released: ReleasedSeat[] } {
  normalizeGameState(state);
  if (state.status !== "complete") return { state, dealt: false, released: [] };
  const due = Date.parse(state.nextHandAt ?? "");
  if (!Number.isFinite(due) || now < due) return { state, dealt: false, released: [] };

  // Before the deal, so the next hand is dealt to whoever is actually here.
  const released = releaseInactiveSeats(state);
  setupHand(state, false, now);
  state.version += 1;
  state.updatedAt = new Date(now).toISOString();
  return { state, dealt: true, released };
}

export function advanceTimedTurn(state: GameState, now = Date.now()): TimedTurnAdvance {
  normalizeGameState(state);
  if (state.status !== "playing" || state.currentPlayer === null || !state.turnDeadlineAt) {
    return { state, actorSeatId: null, action: null, timedOut: false };
  }
  if (now < Date.parse(state.turnDeadlineAt)) {
    return { state, actorSeatId: null, action: null, timedOut: false };
  }

  const seatIndex = state.currentPlayer;
  const seat = state.seats[seatIndex];
  const timedOut = seat.isHuman;
  const legal = getLegalActions(state, seatIndex);
  const action: TurnAction = timedOut
    ? legal.canCheck ? { type: "check" } : { type: "fold" }
    : chooseBotAction(state, seatIndex);
  const actorSeatId = seat.id;

  applyTurnAction(state, action);
  if (timedOut) {
    // Only a human's expired clock counts. A bot has no attention to lose,
    // and its deadline is a pacing device rather than a decision timer.
    seat.missedTurns += 1;
    seat.lastAction = action.type === "check" ? "Timed out · Check" : "Timed out · Fold";
    addLog(
      state,
      seat.missedTurns >= MAX_MISSED_TURNS
        ? // A tournament seat is never actually released at this threshold --
          // releaseInactiveSeats short-circuits to a no-op for one (no bot
          // fill, ever) -- so "forfeits the seat" would be a standing lie,
          // repeated on every hand for as long as the seat stays AFK.
          state.tournament
          ? `${seat.name} keeps missing turns (${seat.missedTurns} in a row) and is auto-folding`
          : `${seat.name} ran out of time and forfeits the seat`
        : `${seat.name} ran out of time (${seat.missedTurns}/${MAX_MISSED_TURNS})`,
    );
  }
  state.version += 1;
  state.updatedAt = new Date(now).toISOString();
  return { state, actorSeatId, action, timedOut };
}

export function applyPlayerAction(state: GameState, action: PlayerAction, callerToken: string): GameState {
  normalizeGameState(state);
  const seatIndex = state.seats.findIndex((seat) => seat.ownerToken === callerToken);
  if (seatIndex === -1) throw new Error("You are not seated at this table.");
  if (action.type === "leave-seat") {
    if (state.tournament) {
      // Standing up mid-hand would drop this seat's cards and any chips it
      // already committed with no one left to act for it -- the same reason
      // a cash seat can't be reclaimed by a bot mid-hand either. Between
      // hands, forfeit rather than vacateSeat: no bot takeover, no credit.
      if (state.status === "playing") {
        throw new Error(
          state.tournament.format === "heads_up"
            ? "Finish this hand before leaving a heads-up match."
            : "Finish this hand before leaving a Sit & Go table.",
        );
      }
      const leavingSeat = state.seats[seatIndex];
      const otherFundedSeats = state.seats.filter(
        (candidate, index) => index !== seatIndex && candidate.stack > 0,
      );
      if (state.tournament.winnerProfileId) {
        // Already decided -- e.g. the winner clicking "Leave table" off the
        // win screen. A plain exit, not a forfeit: forfeitTournamentSeat
        // would zero a stack that already reflects a paid-out win.
        leavingSeat.status = "out";
      } else if (leavingSeat.stack > 0 && otherFundedSeats.length === 0) {
        // Every other seat is already forfeited or busted out and nobody
        // has been named winner yet -- this seat IS the survivor, not a
        // forfeiter. Finalizing with its funded stack intact is what
        // actually decides the match; zeroing it first (the old
        // unconditional forfeit below) is exactly how a match used to end
        // "complete" with no winner ever named -- see
        // sweepUndecidedTournaments's own comment in game-store.ts, the
        // safety net that now catches this state if anything still reaches
        // it despite this guard.
        leavingSeat.status = "out";
        finalizeTournamentIfDecided(state, leavingSeat);
      } else {
        forfeitTournamentSeat(state, seatIndex);
        // Closes the same race finalizeTournamentIfDecided closes for a
        // natural bust: a voluntary forfeit that leaves only one funded seat
        // (the last two players at a Sit & Go, or either heads-up seat) must
        // decide the match right here, not wait on a next-hand pass that only
        // the surviving seat has any reason left to trigger. A Sit & Go with
        // three or more players still funded must NOT be decided off whichever
        // seat this find happens to hit first, so the funded count -- computed
        // before this seat's own forfeit above -- is checked before ever
        // reading a "survivor".
        if (otherFundedSeats.length <= 1) finalizeTournamentIfDecided(state, otherFundedSeats[0]);
      }
    } else {
      vacateSeat(state, callerToken);
    }
  } else if (action.type === "next-hand") {
    if (state.status !== "complete") throw new Error("Finish the current hand first.");
    setupHand(state);
  } else if (action.type === "rebuy") {
    if (state.tournament) {
      throw new Error(
        state.tournament.format === "heads_up"
          ? "There are no rebuys in a heads-up match."
          : "This is a Sit & Go -- there's no rebuy.",
      );
    }
    const seat = state.seats[seatIndex];
    if (seat.stack > 0) throw new Error("Your seat still has chips.");
    // No "between hands" restriction: a busted seat sits out for as many
    // hands as it takes, same as any other unfunded seat, so there's no
    // reason to make the player wait for a lull before they can even submit
    // this. The one thing still guarded against is rebuying a seat that is
    // *currently* live in a hand in progress: a stack that lost its last
    // chip this same hand reads status "all-in", not "out", until that hand
    // finishes deciding it, and rebuying it early would un-lose it mid-deal.
    // isSeatRebuyEligible is shared with action-bar.tsx, which now uses the
    // same check to decide whether to even show the button; see its own
    // comment for the bug this used to be when the two copies disagreed.
    if (!isSeatRebuyEligible(state.status, seat.status)) {
      throw new Error("Wait for this hand to finish deciding your seat.");
    }
    seat.stack = clampBuyIn(state.tier, action.amount);
    if (state.status === "complete") {
      // Refill and immediately deal, in one action: refilling first means
      // setupHand's own per-seat funding check leaves this seat alone
      // rather than sitting it out again.
      seat.status = "active";
      setupHand(state);
    } else {
      // Mid-hand: this seat is already sitting out (checked above), so the
      // hand in progress for everyone else is untouched. The chips just sit
      // in front of it until the next deal picks it up as funded.
      seat.status = "out";
    }
  } else {
    if (state.status !== "playing") throw new Error("This hand is complete.");
    if (state.currentPlayer !== seatIndex) throw new Error("Wait for your turn.");
    // Present, by definition. Reset before the action rather than after, so a
    // throw inside applyTurnAction cannot leave the count wrong either way.
    state.seats[seatIndex].missedTurns = 0;
    applyTurnAction(state, action);
  }
  state.version += 1;
  state.updatedAt = new Date().toISOString();
  return state;
}

/**
 * Whether this hand reached a real showdown: the street is `showdown` and
 * 2+ players actually got there.
 *
 * An uncontested win (everyone else folded) lets the winner muck without
 * showing, exactly like a real showdown never happened. Anyone who folded
 * earlier keeps their cards hidden from other seats forever.
 */
export function handReachedShowdown(state: GameState): boolean {
  return state.street === "showdown" && remaining(state).length > 1;
}

/**
 * Whether a seat's hole cards became public knowledge at the table.
 *
 * The one place this rule is written down. `toSnapshot` reads it for the
 * live table and lib/server/hand-archive-store.ts reads it when persisting
 * a finished hand, because a second copy of the rule is a second place for
 * it to drift, and the drift is silent in the direction that matters, since
 * replaying a hand with an opponent's mucked cards visible looks like a
 * feature rather than a leak.
 *
 * This is about the table, not about any one viewer: a player always sees
 * their own cards, which is the caller's business to add, not this
 * function's.
 */
export function seatCardsWereShown(state: GameState, seat: Seat): boolean {
  return handReachedShowdown(state) && seat.status !== "folded" && seat.status !== "out";
}

export function toSnapshot(state: GameState, callerToken: string): GameSnapshot {
  const mySeatIndex = state.seats.findIndex((seat) => seat.ownerToken === callerToken);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the three private fields
  const { deck, hostToken, seats, ...publicState } = state;
  const { small, big } = blindPositions(state);
  return {
    ...publicState,
    isSeated: mySeatIndex !== -1,
    seats: state.seats.map((seat, index) => {
      const isMine = index === mySeatIndex;
      const revealed = isMine || seatCardsWereShown(state, seat);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping ownerToken, never sent to clients
      const { ownerToken, ...publicSeat } = seat;
      return {
        ...publicSeat,
        holeCards: seat.holeCards.map((card) => (revealed ? card : null)),
        /**
         * Gated on `revealed`, the same flag the cards themselves use, not
         * on a rule of its own.
         *
         * A made-hand label is a lossy description of exactly the cards
         * beside it, so tying the two together makes it impossible for the
         * label to say more than the hand already shows: mid-hand you get
         * your own, and at a genuine showdown everyone still in gets
         * theirs. Any separate condition here would be a second place for
         * the redaction rule to drift out of step with the first, and the
         * failure mode is silent, since "Full house" next to two face-down
         * cards looks like a feature rather than a leak.
         */
        handLabel: revealed && seat.holeCards.length > 0
          ? describeHand([...seat.holeCards, ...state.community])
          : null,
        isDealer: seat.position === state.buttonPosition,
        isCurrent: seat.position === state.currentPlayer,
        isSmallBlind: seat.position === small,
        isBigBlind: seat.position === big,
        isMine,
        isOpen: seat.ownerToken === null,
      };
    }),
    legalActions:
      mySeatIndex !== -1 && state.currentPlayer === mySeatIndex ? getLegalActions(state, mySeatIndex) : null,
  };
}
