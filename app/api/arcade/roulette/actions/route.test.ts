import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { startRouletteRound, type RouletteRound } from "@/lib/arcade/roulette";
import { ROULETTE_GAME, readRouletteRound } from "@/lib/server/roulette-service";
import {
  __resetArcadeRoundsForTest,
  createArcadeRound,
} from "@/lib/server/arcade-round-store";
import { adjustGold, banProfile, ensureProfile, spendGold } from "@/lib/server/profile-store";
import { POST } from "./route";

/**
 * The ban gate on a paid round, which outlived the game it guards.
 *
 * Roulette was retired on 2026-08-12 (lib/arcade/retired.ts), so
 * `placeRouletteBet` now refuses -- but the settle path was deliberately kept
 * so a player holding a round they already paid for can still spin it, and
 * this is the property that says a *banned* player cannot. The fixture round
 * is therefore opened straight through the store, which is what the service
 * did before the guard, minus the guard. Setup only: nothing under app/ or
 * lib/server can reach this, so it cannot become a way to deal a retired game.
 */
describe("POST /api/arcade/roulette/actions", () => {
  beforeEach(() => {
    __resetArcadeRoundsForTest();
  });

  it("refuses to spin a paid round after the player is banned", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 5_000 - profile.goldBalance);

    const paid = await spendGold(token, 1_000);
    const stored = await createArcadeRound<RouletteRound>({
      profileId: profile.id,
      game: ROULETTE_GAME,
      tier: "1k",
      baseStake: 1_000,
      round: startRouletteRound({ stake: 1_000, bet: { kind: "straight", pocket: 7 } }),
      settled: false,
    });
    const round = { id: stored.id, version: stored.version };
    await banProfile(profile.id, true);

    const response = await POST(new NextRequest("https://stackchips.test/api/arcade/roulette/actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `river_session=${token}`,
      },
      body: JSON.stringify({ roundId: round.id, version: round.version }),
    }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/suspended/i);
    // The round is untouched and the wallet is exactly where the stake left
    // it -- a refused spin must neither advance the wheel nor cost anything.
    expect((await readRouletteRound(token)).round?.version).toBe(round.version);
    expect((await ensureProfile(token)).goldBalance).toBe(paid.goldBalance);
  });
});
