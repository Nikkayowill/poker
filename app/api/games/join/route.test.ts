import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import { ensureProfile } from "@/lib/server/profile-store";
import { createStoredGame, getStoredGame } from "@/lib/server/game-store";
import { POST } from "./route";

function joinRequest(token: string, code: string) {
  return new NextRequest("https://stackchips.test/api/games/join", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `river_session=${token}`,
    },
    body: JSON.stringify({ code }),
  });
}

describe("POST /api/games/join", () => {
  it("does not charge a player who already owns a seat", async () => {
    const token = randomUUID();
    const game = createGame(token, "Host", undefined, { isPrivate: true });
    await createStoredGame(game);

    const before = await ensureProfile(token);
    const first = await POST(joinRequest(token, game.roomCode!));
    const second = await POST(joinRequest(token, game.roomCode!));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).profile.goldBalance).toBe(before.goldBalance);
    expect((await second.json()).profile.goldBalance).toBe(before.goldBalance);
    expect((await getStoredGame(game.id))?.version).toBe(game.version);
  });
});
