import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { TIER_CONFIG } from "@/lib/game/tiers";
import { getStoredGame, updateStoredGame } from "@/lib/server/game-store";
import { openHeadsUpQuickPlay } from "@/lib/server/heads-up-service";
import { getHeadsUpTableById } from "@/lib/server/heads-up-store";
import { adjustGold, ensureProfile } from "@/lib/server/profile-store";
import { POST } from "./route";

const STAKE = TIER_CONFIG["1k"].minBuyIn;

async function funded(gold = 10_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
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

describe("POST /api/games/[id]/reactions", () => {
  it("settles a tournament whose winner was named by the timed advance on load", async () => {
    const { a, b, tableId, gameId } = await headsUpDecidedByTimeout();

    const request = new NextRequest(`https://stackchips.test/api/games/${gameId}/reactions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `river_session=${b.token}` },
      body: JSON.stringify({ reactionId: "nice_hand" }),
    });
    const response = await POST(request, { params: Promise.resolve({ id: gameId }) });
    expect(response.status).toBe(200);

    expect((await getHeadsUpTableById(tableId))?.status).toBe("completed");
    expect(payoutRow(tableId)).toMatchObject({ profileId: a.id, amount: STAKE * 2 });
  });
});
