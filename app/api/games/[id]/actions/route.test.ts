import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@/lib/game/engine";
import { createStoredGame } from "@/lib/server/game-store";
import { creditGold } from "@/lib/server/profile-store";
import { POST } from "./route";

vi.mock("@/lib/server/profile-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/profile-store")>();
  return { ...actual, creditGold: vi.fn(actual.creditGold) };
});

function leaveRequest(token: string, gameId: string) {
  return new NextRequest(`https://stackchips.test/api/games/${gameId}/actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `river_session=${token}`,
    },
    body: JSON.stringify({ action: { type: "leave-seat" } }),
  });
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
});
