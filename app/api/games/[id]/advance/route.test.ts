import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import { banProfile, ensureProfile } from "@/lib/server/profile-store";
import { createStoredGame, getStoredGame } from "@/lib/server/game-store";
import { POST } from "./route";

describe("POST /api/games/[id]/advance", () => {
  it("refuses a banned seated player without advancing the table", async () => {
    const token = randomUUID();
    const game = createGame(token, "Host");
    const profile = await ensureProfile(token);
    await createStoredGame(game);
    await banProfile(profile.id, true);

    const response = await POST(
      new NextRequest(`https://stackchips.test/api/games/${game.id}/advance`, {
        method: "POST",
        headers: { cookie: `river_session=${token}` },
      }),
      { params: Promise.resolve({ id: game.id }) },
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/suspended/i);
    expect((await getStoredGame(game.id))?.version).toBe(game.version);
  });
});
