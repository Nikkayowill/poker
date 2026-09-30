import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureProfile } from "@/lib/server/profile-store";
import { __resetSoloEarningsMemory, recordSoloResult } from "@/lib/server/solo-earnings-store";
import { GET } from "./route";

function board(game?: string, token?: string) {
  const url = new URL("https://stackchips.test/api/leaderboard");
  if (game) url.searchParams.set("game", game);
  return new NextRequest(url, { headers: token ? { cookie: `river_session=${token}` } : {} });
}

async function playerWithWin(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  await recordSoloResult(profile.id, token, { game: "sudoku", correlationId: randomUUID(), wager: 1_000, payout: 5_000 });
  return { token, id: profile.id };
}

beforeEach(() => {
  __resetSoloEarningsMemory();
});

describe("GET /api/leaderboard", () => {
  it("defaults to the global rank board", async () => {
    const player = await playerWithWin("Ranked");

    const response = await GET(board());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.game).toBe("global");
    expect(body.entries.map((entry: { profileId: string }) => entry.profileId)).toContain(player.id);
    expect(body.entries[0]).toHaveProperty("points");
  });

  it("rejects the retired boards", async () => {
    for (const game of ["poker", "chess", "friends-old"]) {
      expect((await GET(board(game))).status).toBe(400);
    }
  });

  it("answers the friends board for a guest as empty, asking for an account", async () => {
    const body = await (await GET(board("friends"))).json();
    expect(body).toMatchObject({ game: "friends", entries: [], requiresAccount: true });
  });

  it("returns the caller on their own friends board", async () => {
    const player = await playerWithWin("Solo");

    const body = await (await GET(board("friends", player.token))).json();

    expect(body.entries.map((entry: { profileId: string }) => entry.profileId)).toEqual([player.id]);
  });
});
