import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import { ensureProfile } from "@/lib/server/profile-store";
import { createStoredGame, getStoredGame } from "@/lib/server/game-store";
import { POST } from "./route";

function quickPlayRequest(token: string) {
  return new NextRequest("https://stackchips.test/api/games/quick-play", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `river_session=${token}`,
    },
    body: JSON.stringify({ tier: "1k" }),
  });
}

describe("POST /api/games/quick-play", () => {
  it("does not charge a player who is matched back to the table they already sit at", async () => {
    const token = randomUUID();
    const before = await ensureProfile(token, "Host");
    const game = createGame(token, "Host", undefined, { tier: "1k" });
    await createStoredGame(game);

    const response = await POST(quickPlayRequest(token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.game.id).toBe(game.id);
    expect(body.profile.goldBalance).toBe(before.goldBalance);
    expect((await ensureProfile(token)).goldBalance).toBe(before.goldBalance);
    expect((await getStoredGame(game.id))?.version).toBe(game.version);
  });
});
