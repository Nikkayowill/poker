import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { placeRouletteBet, readRouletteRound } from "@/lib/server/roulette-service";
import { __resetArcadeRoundsForTest } from "@/lib/server/arcade-round-store";
import { adjustGold, banProfile, ensureProfile } from "@/lib/server/profile-store";
import { POST } from "./route";

describe("POST /api/arcade/roulette/actions", () => {
  beforeEach(() => {
    __resetArcadeRoundsForTest();
  });

  it("refuses to spin a paid round after the player is banned", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 5_000 - profile.goldBalance);
    const bet = await placeRouletteBet(token, "1k", { kind: "straight", pocket: 7 });
    const round = bet.round!;
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
    expect((await readRouletteRound(token)).round?.version).toBe(round.version);
    expect((await ensureProfile(token)).goldBalance).toBe(bet.profile.goldBalance);
  });
});
