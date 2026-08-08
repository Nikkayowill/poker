import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { dealBlackjackRound, readBlackjackRound } from "@/lib/server/blackjack-service";
import { __resetBlackjackRoundsForTest } from "@/lib/server/blackjack-store";
import { adjustGold, banProfile, ensureProfile } from "@/lib/server/profile-store";
import { POST } from "./route";

describe("POST /api/arcade/blackjack/actions", () => {
  beforeEach(() => {
    __resetBlackjackRoundsForTest();
  });

  it("refuses to play a paid round after the player is banned", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 100_000 - profile.goldBalance);

    let dealt = await dealBlackjackRound(token, "1k");
    while (dealt.round?.phase === "settled") dealt = await dealBlackjackRound(token, "1k");
    const round = dealt.round!;
    await banProfile(profile.id, true);

    const response = await POST(new NextRequest("https://stackchips.test/api/arcade/blackjack/actions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `river_session=${token}`,
      },
      body: JSON.stringify({ roundId: round.id, version: round.version, action: "stand" }),
    }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/suspended/i);
    expect((await readBlackjackRound(token)).round?.version).toBe(round.version);
    expect((await ensureProfile(token)).goldBalance).toBe(dealt.profile.goldBalance);
  });
});
