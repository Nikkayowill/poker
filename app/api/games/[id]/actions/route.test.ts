import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@/lib/game/engine";
import { TIER_CONFIG } from "@/lib/game/tiers";
import { createStoredGame, getStoredGame, updateStoredGame } from "@/lib/server/game-store";
import { openHeadsUpQuickPlay } from "@/lib/server/heads-up-service";
import { getHeadsUpTableById } from "@/lib/server/heads-up-store";
import { adjustGold, creditGold, ensureProfile } from "@/lib/server/profile-store";
import { POST } from "./route";

vi.mock("@/lib/server/profile-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/profile-store")>();
  return { ...actual, creditGold: vi.fn(actual.creditGold) };
});

function actionRequest(token: string, gameId: string, body: unknown) {
  return new NextRequest(`https://stackchips.test/api/games/${gameId}/actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `river_session=${token}`,
    },
    body: JSON.stringify(body),
  });
}

function leaveRequest(token: string, gameId: string) {
  return actionRequest(token, gameId, { action: { type: "leave-seat" } });
}

const STAKE = TIER_CONFIG["1k"].minBuyIn;

async function funded(gold = 10_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** The pot credit for this table in the memory-mode gold ledger, if any. */
function payoutRow(tableId: string) {
  return globalThis.__riverGoldLedger?.get(`heads_up_payout:${tableId}:credit`) ?? null;
}

/**
 * A heads-up river where b is all in for everything and a's clock has run
 * out holding the winning hand. The winner is only named when the timed
 * advance inside loadGameWithTimeouts auto-checks for a, which is the path
 * that used to skip settlement.
 */
async function headsUpDecidedByTimeout() {
  const a = await funded();
  const b = await funded();
  await openHeadsUpQuickPlay(a.token, "1k");
  const { table } = await openHeadsUpQuickPlay(b.token, "1k");
  const state = await getStoredGame(table.gameId!);
  if (!state) throw new Error("no such game");

  state.status = "playing";
  state.street = "river";
  state.community = [
    { rank: "2", suit: "clubs" }, { rank: "3", suit: "diamonds" }, { rank: "7", suit: "hearts" },
    { rank: "8", suit: "spades" }, { rank: "9", suit: "clubs" },
  ];
  state.currentPlayer = 0;
  state.currentBet = 0;
  state.seats.forEach((seat) => {
    seat.acted = true;
    seat.streetBet = 0;
  });
  state.seats[0].acted = false;
  state.seats[0].status = "active";
  state.seats[0].stack = 500;
  state.seats[0].committed = 500;
  state.seats[0].holeCards = [{ rank: "A", suit: "spades" }, { rank: "A", suit: "diamonds" }];
  state.seats[1].status = "all-in";
  state.seats[1].stack = 0;
  state.seats[1].committed = 500;
  state.seats[1].holeCards = [{ rank: "K", suit: "spades" }, { rank: "K", suit: "diamonds" }];

  state.turnDeadlineAt = new Date(Date.now() - 1000).toISOString();
  state.version += 1;
  state.updatedAt = new Date().toISOString();
  await updateStoredGame(state, { type: "check" }, a.token);
  expect(state.tournament?.winnerProfileId ?? null).toBeNull();
  return { a, b, tableId: table.id, gameId: state.id };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/games/[id]/actions", () => {
  it("logs a failed cash-out credit instead of swallowing it", async () => {
    const token = randomUUID();
    const game = createGame(token, "Host", undefined, { isPrivate: true });
    await createStoredGame(game);
    const stack = game.seats.find((seat) => seat.ownerToken === token)?.stack ?? 0;
    expect(stack).toBeGreaterThan(0);

    const failure = new Error("wallet down");
    vi.mocked(creditGold).mockRejectedValueOnce(failure);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(leaveRequest(token, game.id), { params: Promise.resolve({ id: game.id }) });

    expect(response.status).toBe(200);
    expect((await response.json()).cashedOut).toBe(stack);
    expect(logged).toHaveBeenCalledWith("games.cash_out_credit_failed", {
      gameId: game.id,
      amount: stack,
      error: failure,
    });
  });

  it("settles a tournament whose winner was named by the timed advance on load, even when the action is refused", async () => {
    const { a, tableId, gameId } = await headsUpDecidedByTimeout();

    // The hand is over, so this check is refused, but the load before it
    // ran a's expired clock, which ended the match.
    const response = await POST(
      actionRequest(a.token, gameId, { action: { type: "check" } }),
      { params: Promise.resolve({ id: gameId }) },
    );
    expect(response.status).toBe(409);

    expect((await getHeadsUpTableById(tableId))?.status).toBe("completed");
    expect(payoutRow(tableId)).toMatchObject({ profileId: a.id, amount: STAKE * 2 });

    // Another request on the finished game pays nothing more.
    const afterPayout = await balance(a.token);
    await POST(actionRequest(a.token, gameId, { action: { type: "check" } }), { params: Promise.resolve({ id: gameId }) });
    expect(await balance(a.token)).toBe(afterPayout);
  });

  it("hands the winner their new balance on a stale-version answer", async () => {
    const { a, tableId, gameId } = await headsUpDecidedByTimeout();

    const response = await POST(
      actionRequest(a.token, gameId, { action: { type: "check" }, expectedVersion: 0 }),
      { params: Promise.resolve({ id: gameId }) },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.stale).toBe(true);
    expect(payoutRow(tableId)).toMatchObject({ profileId: a.id, amount: STAKE * 2 });
    // Hand-completion rewards can land after the payout, so only the payout itself is pinned.
    expect(body.profile.id).toBe(a.id);
    expect(body.profile.goldBalance).toBeGreaterThanOrEqual(10_000 + STAKE);
  });
});
