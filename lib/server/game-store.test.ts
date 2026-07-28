import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import {
  advanceStoredGameWithTimeouts,
  createStoredGame,
  getStoredGame,
  loadGameWithTimeouts,
} from "./game-store";

function dueGame() {
  const token = randomUUID();
  const game = createGame(token);
  game.turnDeadlineAt = new Date(0).toISOString();
  return game;
}

describe("game deadline persistence (memory mode)", () => {
  it("keeps ordinary snapshot reads strictly read-only", async () => {
    const game = dueGame();
    await createStoredGame(game);

    const snapshot = await getStoredGame(game.id);

    expect(snapshot?.version).toBe(game.version);
    expect(snapshot?.turnDeadlineAt).toBe(game.turnDeadlineAt);

    const advanced = await loadGameWithTimeouts(game.id);
    expect(advanced?.version).toBe(game.version + 1);
  });

  it("treats simultaneous deadline attempts as one commit and one normal no-op", async () => {
    const game = dueGame();
    await createStoredGame(game);
    const firstReader = await getStoredGame(game.id);
    const secondReader = await getStoredGame(game.id);
    expect(firstReader).not.toBeNull();
    expect(secondReader).not.toBeNull();

    const [firstResult, secondResult] = await Promise.all([
      advanceStoredGameWithTimeouts(firstReader!),
      advanceStoredGameWithTimeouts(secondReader!),
    ]);

    expect(firstResult.version).toBe(game.version + 1);
    expect(secondResult.version).toBe(game.version + 1);
    expect(firstResult).toBe(secondResult);
    expect((await getStoredGame(game.id))?.version).toBe(game.version + 1);
  });

  it("coalesces a 100-request deadline burst into one version transition", async () => {
    const game = dueGame();
    await createStoredGame(game);
    const readers = await Promise.all(
      Array.from({ length: 100 }, () => getStoredGame(game.id)),
    );

    const results = await Promise.all(
      readers.map((state) => advanceStoredGameWithTimeouts(state!)),
    );

    expect(new Set(results).size).toBe(1);
    expect(results.every((state) => state.version === game.version + 1)).toBe(true);
    expect((await getStoredGame(game.id))?.version).toBe(game.version + 1);
  });
});
