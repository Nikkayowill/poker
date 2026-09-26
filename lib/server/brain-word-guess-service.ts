import "server-only";
import { randomInt, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  brainWordGuessPayout,
  brainWordGuessProblem,
  guessBrainWordLetter,
  resignBrainWordGuess,
  startBrainWordGuess,
  toBrainWordGuessSnapshot,
  type BrainWordGuessAttempt,
  type BrainWordGuessSnapshot,
} from "@/lib/arcade/brain-word-guess";
import { pickWordGuessWords } from "@/lib/arcade/brain-word-guess-words";
import { anteUpStakeProblem } from "@/lib/arcade/ante-up-stakes";
import { stakePressure } from "@/lib/arcade/stake-pressure";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  ActiveAnteUpAttemptExists,
  advanceAnteUpAttempt,
  countWageredAttemptsSince,
  createAnteUpAttempt,
  getActiveAnteUpAttempt,
  getAnteUpAttemptById,
  type StoredAnteUpAttempt,
} from "./ante-up-store";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";
import { applyAchievementEvent } from "./achievement-store";
import { applyMissionEvent } from "./mission-store";
import {
  confirmGoldDebitLedgered,
  creditGoldByProfile,
  creditGoldByProfileLedgered,
  ensureProfile,
  spendStakeLedgered,
} from "./profile-store";
import { awardWager } from "./progression-store";

/**
 * Everything between a Word Guess request and the wallet. Same shape, same
 * three ordering rules as ante-up-memory-service.ts; see that file's header.
 */

export class BrainWordGuessRequestError extends ArcadeRequestError<BrainWordGuessSnapshot, never> {
  readonly name = "BrainWordGuessRequestError";
}

const GAME = "word-guess";
export const BRAIN_WORD_GUESS_DAILY_WAGERED_LIMIT = 10;

function snapshot(stored: StoredAnteUpAttempt<BrainWordGuessAttempt>): BrainWordGuessSnapshot {
  return toBrainWordGuessSnapshot(stored.state, { id: stored.id, version: stored.version });
}

/** Returns the credited profile, or null when nothing was paid, so the reply shows the new balance. */
async function payOutWin(profileId: string, attempt: Pick<BrainWordGuessAttempt, "wager" | "status" | "misses" | "ladder">): Promise<PlayerProfile | null> {
  const payout = brainWordGuessPayout(attempt);
  if (payout <= 0) return null;
  let credited: PlayerProfile | null = null;
  try {
    credited = await creditGoldByProfile(profileId, payout);
  } catch (error) {
    console.error("brain-word-guess.payout_credit_failed", { profileId, payout, error });
  }
  await applyMissionEvent(profileId, { kind: "puzzle_completed" });
  await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
  return credited;
}

export async function readBrainWordGuess(
  token: string,
): Promise<{ attempt: BrainWordGuessSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt<BrainWordGuessAttempt>(profile.id, GAME);
  return { attempt: stored ? snapshot(stored) : null, profile };
}

export async function openBrainWordGuess(
  token: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: BrainWordGuessSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new BrainWordGuessRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new BrainWordGuessRequestError(`Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`, 400);
  }
  const stakeProblem = anteUpStakeProblem(GAME, null, wagerInput);
  if (stakeProblem) throw new BrainWordGuessRequestError(stakeProblem, 400);

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, GAME, sinceYesterday);
    if (wageredToday >= BRAIN_WORD_GUESS_DAILY_WAGERED_LIMIT) {
      throw new BrainWordGuessRequestError(
        `You've wagered Word Guess ${BRAIN_WORD_GUESS_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  const wagerCorrelationId = `brain_word_guess_wager:${randomUUID()}`;
  const debited =
    wagerInput > 0 ? await spendStakeLedgered(profile, wagerInput, wagerCorrelationId, "brain_word_guess_wager") : profile;
  if (!debited) {
    throw new BrainWordGuessRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
  }

  const words = pickWordGuessWords((max) => randomInt(0, max), stakePressure(wagerInput));
  const state = startBrainWordGuess(words, wagerInput, now);

  let stored: StoredAnteUpAttempt<BrainWordGuessAttempt>;
  try {
    stored = await createAnteUpAttempt({
      profileId: profile.id,
      game: GAME,
      tier: null,
      wager: wagerInput,
      multiplier: 1,
      state,
    });
  } catch (error) {
    if (wagerInput > 0) {
      await creditGoldByProfileLedgered(profile.id, wagerInput, wagerCorrelationId, "brain_word_guess_wager_refund").catch(
        (refundError) => {
          console.error("brain-word-guess.open_refund_failed", { profileId: profile.id, wager: wagerInput, error: refundError });
        },
      );
    }
    if (error instanceof ActiveAnteUpAttemptExists) throw new BrainWordGuessRequestError(error.message, 409);
    throw error;
  }

  if (wagerInput > 0) {
    await confirmGoldDebitLedgered(wagerCorrelationId).catch((confirmError) => {
      console.error("brain-word-guess.open_confirm_failed", { profileId: profile.id, wagerCorrelationId, error: confirmError });
    });
    await awardWager(profile.id, token, wagerInput, now);
  }

  return { attempt: snapshot(stored), profile: debited };
}

export async function guessBrainWordGuessLetter(
  token: string,
  input: { version: number; letter: string },
  now = new Date(),
): Promise<{ attempt: BrainWordGuessSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<BrainWordGuessAttempt>(profile.id, GAME);
  if (!current) throw new BrainWordGuessRequestError("Start a word first.", 404);

  if (current.version !== input.version) {
    throw new BrainWordGuessRequestError("That word moved on.", 409, { round: snapshot(current) });
  }

  const letter = input.letter.toLowerCase();
  const problem = brainWordGuessProblem(current.state, letter);
  if (problem) {
    throw new BrainWordGuessRequestError(
      problem === "finished"
        ? "This word is already over."
        : problem === "already-guessed"
          ? "Already guessed that one."
          : "Guess a single letter.",
      409,
      { round: snapshot(current) },
    );
  }

  const next = guessBrainWordLetter(current.state, letter, now);
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    const live = (await getAnteUpAttemptById<BrainWordGuessAttempt>(current.id)) ?? current;
    throw new BrainWordGuessRequestError("That word moved on.", 409, { round: snapshot(live) });
  }

  const paid = stored.state.status === "won" ? await payOutWin(profile.id, stored.state) : null;

  return { attempt: snapshot(stored), profile: paid ?? profile };
}

export async function resignBrainWordGuessAttempt(
  token: string,
  now = new Date(),
): Promise<{ attempt: BrainWordGuessSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<BrainWordGuessAttempt>(profile.id, GAME);
  if (!current) return { attempt: null, profile };

  const next = resignBrainWordGuess(current.state, now);
  const stored =
    (await advanceAnteUpAttempt(current, next)) ?? (await getAnteUpAttemptById<BrainWordGuessAttempt>(current.id)) ?? current;
  return { attempt: snapshot(stored), profile };
}

export function toBrainWordGuessErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That word could not be played.");
}
