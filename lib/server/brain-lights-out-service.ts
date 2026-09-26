import "server-only";
import { randomInt, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  MIN_ANTE_UP_WAGER,
  brainLightsOutPayout,
  resignBrainLightsOut,
  startBrainLightsOut,
  tapBrainLightsOut,
  toBrainLightsOutSnapshot,
  type BrainLightsOutAttempt,
  type BrainLightsOutSnapshot,
} from "@/lib/arcade/brain-lights-out";
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
 * Everything between a Lights Out request and the wallet. Same shape, same
 * three ordering rules as ante-up-memory-service.ts; see that file's header.
 */

export class BrainLightsOutRequestError extends ArcadeRequestError<BrainLightsOutSnapshot, never> {
  readonly name = "BrainLightsOutRequestError";
}

const GAME = "lights-out";
export const BRAIN_LIGHTS_OUT_DAILY_WAGERED_LIMIT = 10;

function snapshot(stored: StoredAnteUpAttempt<BrainLightsOutAttempt>): BrainLightsOutSnapshot {
  return toBrainLightsOutSnapshot(stored.state, { id: stored.id, version: stored.version });
}

/** Returns the credited profile, or null when nothing was paid, so the reply shows the new balance. */
async function payOutWin(profileId: string, attempt: Pick<BrainLightsOutAttempt, "wager" | "status" | "moves">): Promise<PlayerProfile | null> {
  const payout = brainLightsOutPayout(attempt);
  if (payout <= 0) return null;
  let credited: PlayerProfile | null = null;
  try {
    credited = await creditGoldByProfile(profileId, payout);
  } catch (error) {
    console.error("brain-lights-out.payout_credit_failed", { profileId, payout, error });
  }
  await applyMissionEvent(profileId, { kind: "puzzle_completed" });
  await applyAchievementEvent(profileId, { kind: "puzzle_completed" });
  return credited;
}

export async function readBrainLightsOut(
  token: string,
): Promise<{ attempt: BrainLightsOutSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const stored = await getActiveAnteUpAttempt<BrainLightsOutAttempt>(profile.id, GAME);
  return { attempt: stored ? snapshot(stored) : null, profile };
}

export async function openBrainLightsOut(
  token: string,
  wagerInput: number,
  now = new Date(),
): Promise<{ attempt: BrainLightsOutSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);

  if (!Number.isInteger(wagerInput) || wagerInput < 0) {
    throw new BrainLightsOutRequestError("That is not a wager.", 400);
  }
  if (wagerInput > 0 && wagerInput < MIN_ANTE_UP_WAGER) {
    throw new BrainLightsOutRequestError(`Wager at least ${MIN_ANTE_UP_WAGER.toLocaleString()} Gold, or play free.`, 400);
  }
  const overCeiling = anteUpWagerCeilingProblem(GAME, null, wagerInput);
  if (overCeiling) throw new BrainLightsOutRequestError(overCeiling, 400);

  if (wagerInput > 0) {
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const wageredToday = await countWageredAttemptsSince(profile.id, GAME, sinceYesterday);
    if (wageredToday >= BRAIN_LIGHTS_OUT_DAILY_WAGERED_LIMIT) {
      throw new BrainLightsOutRequestError(
        `You've wagered Lights Out ${BRAIN_LIGHTS_OUT_DAILY_WAGERED_LIMIT} times in the last day. Try again later, or play free.`,
        429,
      );
    }
  }

  const wagerCorrelationId = `brain_lights_out_wager:${randomUUID()}`;
  const debited =
    wagerInput > 0 ? await spendStakeLedgered(profile, wagerInput, wagerCorrelationId, "brain_lights_out_wager") : profile;
  if (!debited) {
    throw new BrainLightsOutRequestError(`You need ${wagerInput.toLocaleString()} Gold to wager this.`, 400);
  }

  // node:crypto's randomInt is (min, max); RandomInt is (maxExclusive) only.
  const state = startBrainLightsOut((max) => randomInt(0, max), wagerInput, now);

  let stored: StoredAnteUpAttempt<BrainLightsOutAttempt>;
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
      await creditGoldByProfileLedgered(profile.id, wagerInput, wagerCorrelationId, "brain_lights_out_wager_refund").catch(
        (refundError) => {
          console.error("brain-lights-out.open_refund_failed", { profileId: profile.id, wager: wagerInput, error: refundError });
        },
      );
    }
    if (error instanceof ActiveAnteUpAttemptExists) throw new BrainLightsOutRequestError(error.message, 409);
    throw error;
  }

  if (wagerInput > 0) {
    await confirmGoldDebitLedgered(wagerCorrelationId).catch((confirmError) => {
      console.error("brain-lights-out.open_confirm_failed", { profileId: profile.id, wagerCorrelationId, error: confirmError });
    });
    await awardWager(profile.id, token, wagerInput, now);
  }

  return { attempt: snapshot(stored), profile: debited };
}

export async function tapBrainLightsOutAttempt(
  token: string,
  input: { version: number; index: number },
  now = new Date(),
): Promise<{ attempt: BrainLightsOutSnapshot; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<BrainLightsOutAttempt>(profile.id, GAME);
  if (!current) throw new BrainLightsOutRequestError("Start a board first.", 404);

  if (current.version !== input.version) {
    throw new BrainLightsOutRequestError("That board moved on.", 409, { round: snapshot(current) });
  }
  if (current.state.status !== "active") {
    throw new BrainLightsOutRequestError("This board is already over.", 409, { round: snapshot(current) });
  }

  const next = tapBrainLightsOut(current.state, input.index, now);
  const stored = await advanceAnteUpAttempt(current, next);
  if (!stored) {
    const live = (await getAnteUpAttemptById<BrainLightsOutAttempt>(current.id)) ?? current;
    throw new BrainLightsOutRequestError("That board moved on.", 409, { round: snapshot(live) });
  }

  const paid = stored.state.status === "won" ? await payOutWin(profile.id, stored.state) : null;

  return { attempt: snapshot(stored), profile: paid ?? profile };
}

export async function resignBrainLightsOutAttempt(
  token: string,
  now = new Date(),
): Promise<{ attempt: BrainLightsOutSnapshot | null; profile: PlayerProfile }> {
  const profile = await ensureProfile(token);
  const current = await getActiveAnteUpAttempt<BrainLightsOutAttempt>(profile.id, GAME);
  if (!current) return { attempt: null, profile };

  const next = resignBrainLightsOut(current.state, now);
  const stored =
    (await advanceAnteUpAttempt(current, next)) ?? (await getAnteUpAttemptById<BrainLightsOutAttempt>(current.id)) ?? current;
  return { attempt: snapshot(stored), profile };
}

export function toBrainLightsOutErrorResponse(error: unknown): NextResponse {
  return toArcadeErrorResponse(error, "That board could not be played.");
}
