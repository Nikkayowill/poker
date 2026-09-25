import "server-only";
import { randomInt as cryptoRandomInt, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  answerBrainStreakRound,
  brainStreakPayout,
  resignBrainStreakAttempt,
  startBrainStreakAttempt,
  tickBrainStreakAttempt,
  toBrainStreakSnapshot,
  type BrainStreakAttempt,
  type BrainStreakConfig,
  type BrainStreakGame,
  type BrainStreakSnapshot,
} from "@/lib/arcade/brain-streak";
import { anteUpWagerCeilingProblem } from "@/lib/arcade/ante-up-stakes";
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
 * Everything between a Brain Games "streak" request and the wallet, shared by
 * Sequence Recall, Quick Math Sprint, Pattern Predictor and Trivia Blitz --
 * one factory instead of four near-identical files, because the money code
 * is the one part of this that must not drift between copies. Same three
 * ordering rules as ante-up-service.ts's header (wager leaves first, a
 * payout is credited only after a version-guarded settle, settlement is a
 * single credit never a second debit); this is just those rules written
 * once and bound to `game`/`config` instead of restated per game.
 *
 * The per-game wiring (lib/server/brain-sequence-recall-service.ts and its
 * three siblings) is deliberately thin: it exists so each API route imports
 * a name that says which game it is, the same reason ante-up-memory-service
 * exists as its own file rather than being inlined into its route.
 */

export class BrainStreakRequestError extends ArcadeRequestError<BrainStreakSnapshot, never> {
  readonly name = "BrainStreakRequestError";
}

/** node:crypto's randomInt takes (min, max); RandomInt is (maxExclusive) => number. */
const randomInt = (max: number) => cryptoRandomInt(0, max);

export const BRAIN_STREAK_DAILY_WAGERED_LIMIT = 10;

export interface BrainStreakService {
  read(token: string, now?: Date): Promise<{ attempt: BrainStreakSnapshot | null; profile: PlayerProfile }>;
  open(
    token: string,
    wagerInput: number,
    now?: Date,
  ): Promise<{ attempt: BrainStreakSnapshot; profile: PlayerProfile }>;
  answer(
    token: string,
    input: { version: number; given: string },
    now?: Date,
  ): Promise<{ attempt: BrainStreakSnapshot; profile: PlayerProfile }>;
  resign(token: string, now?: Date): Promise<{ attempt: BrainStreakSnapshot | null; profile: PlayerProfile }>;
  toErrorResponse(error: unknown): NextResponse;
}

export function createBrainStreakService(game: BrainStreakGame, config: BrainStreakConfig): BrainStreakService {
  function snapshot(stored: StoredAnteUpAttempt<BrainStreakAttempt>, now: Date): BrainStreakSnapshot {
    return toBrainStreakSnapshot(stored.state, { id: stored.id, version: stored.version }, now);
  }

  /** Never throws; see ante-up-service.ts's payOutWin for why. */
  async function payOutWin(
    profileId: string,
    attempt: Pick<BrainStreakAttempt, "wager" | "score" | "ladder" | "status">,
  ): Promise<void> {
    const payout = brainStreakPayout(attempt);
    if (payout <= 0) return;
    try {
      await creditGoldByProfile(profileId, payout);
    } catch (error) {
      console.error(`brain-streak.${game}.payout_credit_failed`, { profileId, payout, error });
    }
    await applyMissionEvent(profileId, { kind: "puzzle_completed" });
    await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
  }

  async function settleIfExpired(
    stored: StoredAnteUpAttempt<BrainStreakAttempt>,
    now: Date,
  ): Promise<StoredAnteUpAttempt<BrainStreakAttempt>> {
    const ticked = tickBrainStreakAttempt(stored.state, now);
    if (ticked === null) return stored;
    const advanced = await advanceAnteUpAttempt(stored, ticked);
    const settled = advanced ?? (await getAnteUpAttemptById<BrainStreakAttempt>(stored.id)) ?? stored;
    if (advanced && settled.state.status === "finished") await payOutWin(settled.profileId, settled.state);
    return settled;
  }

  async function read(
    token: string,
    now = new Date(),
  ): Promise<{ attempt: BrainStreakSnapshot | null; profile: PlayerProfile }> {
    const profile = await ensureProfile(token);
    const stored = await getActiveAnteUpAttempt<BrainStreakAttempt>(profile.id, game);
    if (!stored) return { attempt: null, profile };
    const settled = await settleIfExpired(stored, now);
    return { attempt: snapshot(settled, now), profile };
  }

  async function open(
    token: string,
    wagerInput: number,
    now = new Date(),
  ): Promise<{ attempt: BrainStreakSnapshot; profile: PlayerProfile }> {
    const profile = await ensureProfile(token);

    if (!Number.isInteger(wagerInput) || wagerInput < 0) {
      throw new BrainStreakRequestError("That is not a wager.", 400);
    }
    if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
      throw new BrainStreakRequestError(
        `Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`,
        400,
      );
    }
    const overCeiling = anteUpWagerCeilingProblem(game, null, wagerInput);
    if (overCeiling) throw new BrainStreakRequestError(overCeiling, 400);

    if (wagerInput > 0) {
      const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const wageredToday = await countWageredAttemptsSince(profile.id, game, sinceYesterday);
      if (wageredToday >= BRAIN_STREAK_DAILY_WAGERED_LIMIT) {
        throw new BrainStreakRequestError(
          `You've wagered ${game.replace(/-/g, " ")} ${BRAIN_STREAK_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
          429,
        );
      }
    }

    // Rule 1: the wager leaves first. Null is "cannot afford".
    const wagerCorrelationId = `brain_${game}_wager:${randomUUID()}`;
    const debited =
      wagerInput > 0 ? await spendStakeLedgered(profile, wagerInput, wagerCorrelationId, `brain_${game}_wager`) : profile;
    if (!debited) {
      throw new BrainStreakRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
    }

    const state = startBrainStreakAttempt(game, config, wagerInput, randomInt, now);

    let stored: StoredAnteUpAttempt<BrainStreakAttempt>;
    try {
      stored = await createAnteUpAttempt({
        profileId: profile.id,
        game,
        tier: null,
        wager: wagerInput,
        multiplier: 1, // placeholder; the real payout is score-ladder-scored at settlement.
        state,
      });
    } catch (error) {
      if (wagerInput > 0) {
        await creditGoldByProfileLedgered(profile.id, wagerInput, wagerCorrelationId, `brain_${game}_wager_refund`).catch(
          (refundError) => {
            console.error(`brain-streak.${game}.open_refund_failed`, {
              profileId: profile.id,
              wager: wagerInput,
              error: refundError,
            });
          },
        );
      }
      if (error instanceof ActiveAnteUpAttemptExists) throw new BrainStreakRequestError(error.message, 409);
      throw error;
    }

    if (wagerInput > 0) {
      await confirmGoldDebitLedgered(wagerCorrelationId).catch((confirmError) => {
        console.error(`brain-streak.${game}.open_confirm_failed`, {
          profileId: profile.id,
          wagerCorrelationId,
          error: confirmError,
        });
      });
      await awardWager(profile.id, token, wagerInput, now);
    }

    return { attempt: snapshot(stored, now), profile: debited };
  }

  async function answer(
    token: string,
    input: { version: number; given: string },
    now = new Date(),
  ): Promise<{ attempt: BrainStreakSnapshot; profile: PlayerProfile }> {
    const profile = await ensureProfile(token);
    const current = await getActiveAnteUpAttempt<BrainStreakAttempt>(profile.id, game);
    if (!current) throw new BrainStreakRequestError("Start a run first.", 404);

    const ticked = tickBrainStreakAttempt(current.state, now);
    if (ticked !== null) {
      const advanced = await advanceAnteUpAttempt(current, ticked);
      const settled = advanced ?? (await getAnteUpAttemptById<BrainStreakAttempt>(current.id)) ?? current;
      if (advanced) await payOutWin(profile.id, settled.state);
      throw new BrainStreakRequestError("Time's up.", 409, { round: snapshot(settled, now) });
    }

    if (current.version !== input.version) {
      throw new BrainStreakRequestError("That run moved on.", 409, { round: snapshot(current, now) });
    }
    if (current.state.status !== "active") {
      throw new BrainStreakRequestError("This run is already over.", 409, { round: snapshot(current, now) });
    }

    const { attempt: next, correct } = answerBrainStreakRound(current.state, config, input.given, randomInt, now);
    const stored = await advanceAnteUpAttempt(current, next);
    if (!stored) {
      const live = (await getAnteUpAttemptById<BrainStreakAttempt>(current.id)) ?? current;
      throw new BrainStreakRequestError("That run moved on.", 409, { round: snapshot(live, now) });
    }

    if (stored.state.status === "finished") await payOutWin(profile.id, stored.state);

    if (!correct && stored.state.status === "finished") {
      throw new BrainStreakRequestError("That ended the run.", 409, { round: snapshot(stored, now) });
    }

    return { attempt: snapshot(stored, now), profile };
  }

  async function resign(
    token: string,
    now = new Date(),
  ): Promise<{ attempt: BrainStreakSnapshot | null; profile: PlayerProfile }> {
    const profile = await ensureProfile(token);
    const current = await getActiveAnteUpAttempt<BrainStreakAttempt>(profile.id, game);
    if (!current) return { attempt: null, profile };

    const next = resignBrainStreakAttempt(current.state, now);
    const advanced = await advanceAnteUpAttempt(current, next);
    const stored = advanced ?? (await getAnteUpAttemptById<BrainStreakAttempt>(current.id)) ?? current;
    // Unlike a board game's forfeit, stopping here still pays: score is
    // progress already banked, not a stake that only a win releases (see
    // brainStreakPayout -- it keys on the ladder alone, not on a win/lose
    // flag). Resigning is how a player cashes out a streak rather than
    // risking the next round on a survival-mode game, or a sprint run they
    // no longer want to keep playing out.
    if (advanced && stored.state.status === "finished") await payOutWin(profile.id, stored.state);
    return { attempt: snapshot(stored, now), profile };
  }

  function toErrorResponse(error: unknown): NextResponse {
    return toArcadeErrorResponse(error, "That run could not be played.");
  }

  return { read, open, answer, resign, toErrorResponse };
}
