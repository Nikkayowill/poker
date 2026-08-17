import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { createGame } from "@/lib/game/engine";
import { listOwnedCosmetics } from "./cosmetics-store";
import { onHandCompleted } from "./hand-completion";
import { ensureProfile } from "./profile-store";
import { getPlayerStanding } from "./stats-store";

/**
 * Same shortcut as avatar-unlocks.test.ts: a real createGame() table, with
 * the handful of fields hand bookkeeping actually reads set directly rather
 * than played out through the engine. These are bookkeeping tests, not
 * engine tests.
 */
function wonHand(token: string, amountWon: number) {
  const state = createGame(token);
  const seat = state.seats[0];
  seat.holeCards = [{ rank: "A", suit: "spades" }, { rank: "K", suit: "spades" }];
  seat.committed = 500;
  seat.vpip = true;
  state.winners = [{ seatId: seat.id, name: seat.name, amount: amountWon, hand: "Flush", bestFive: null }];
  state.id = randomUUID();
  state.handNumber = 1;
  return state;
}

describe("onHandCompleted", () => {
  it("records the hand and awards the unlock it earns in a single call", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    expect(await listOwnedCosmetics(profile.id)).not.toContain("donni");

    // The whole point of the hook: one call does both halves. Nothing here
    // calls checkAvatarUnlocks itself, which is exactly the mistake the
    // human-action path used to make. donni's threshold (50 hands won) is
    // the catalog's lowest remaining avatar unlock, so this crosses it on
    // the last of 50 calls rather than the first -- no catalog entry left
    // unlocks off a single hand's own numbers the way a chips-won avatar
    // used to.
    const gameId = randomUUID();
    for (let handNumber = 1; handNumber < 50; handNumber++) {
      const state = wonHand(token, 1000);
      state.id = gameId;
      state.handNumber = handNumber;
      await onHandCompleted(state);
    }
    expect(await listOwnedCosmetics(profile.id)).not.toContain("donni");

    const fiftieth = wonHand(token, 1000);
    fiftieth.id = gameId;
    fiftieth.handNumber = 50;
    await onHandCompleted(fiftieth);

    expect(await listOwnedCosmetics(profile.id)).toContain("donni");
    const standing = await getPlayerStanding(profile.id, "lifetime");
    expect(standing?.stats.handsWon).toBe(50);
  });

  it("is safe to run twice for the same hand", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const gameId = randomUUID();

    for (let handNumber = 1; handNumber < 50; handNumber++) {
      const state = wonHand(token, 1000);
      state.id = gameId;
      state.handNumber = handNumber;
      await onHandCompleted(state);
    }

    const state = wonHand(token, 1000);
    state.id = gameId;
    state.handNumber = 50;
    await onHandCompleted(state);
    // A retry, or both completion paths racing on the same hand. Neither the
    // stats nor the award may be applied a second time.
    await onHandCompleted(state);

    const standing = await getPlayerStanding(profile.id, "lifetime");
    expect(standing?.stats.handsPlayed).toBe(50);
    const owned = await listOwnedCosmetics(profile.id);
    expect(owned.filter((id) => id === "donni")).toHaveLength(1);
  });

  it("keeps the stats it already wrote when the unlock check fails, and still reports the failure", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);

    vi.resetModules();
    vi.doMock("./avatar-unlocks", () => ({
      checkAvatarUnlocks: () => Promise.reject(new Error("unlock lookup failed")),
    }));
    try {
      const { onHandCompleted: withFailingUnlocks } = await import("./hand-completion");
      await expect(withFailingUnlocks(wonHand(token, 60_000))).rejects.toThrow("unlock lookup failed");
    } finally {
      vi.doUnmock("./avatar-unlocks");
      vi.resetModules();
    }

    // The stats half ran before the unlock half failed, and a best-effort
    // sibling failing must not roll it back -- the hand really was played.
    const standing = await getPlayerStanding(profile.id, "lifetime");
    expect(standing?.stats.handsPlayed).toBe(1);
  });

  it("keeps the stats it already wrote when the achievement check fails, and still reports the failure", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);

    vi.resetModules();
    vi.doMock("./achievement-store", () => ({
      checkAchievements: () => Promise.reject(new Error("achievement lookup failed")),
    }));
    try {
      const { onHandCompleted: withFailingAchievements } = await import("./hand-completion");
      await expect(withFailingAchievements(wonHand(token, 60_000))).rejects.toThrow("achievement lookup failed");
    } finally {
      vi.doUnmock("./achievement-store");
      vi.resetModules();
    }

    // Same isolation guarantee as the avatar-unlock sibling above: a
    // best-effort achievement check failing must not roll back the stats
    // write, and must not skip the avatar-unlock sibling either.
    const standing = await getPlayerStanding(profile.id, "lifetime");
    expect(standing?.stats.handsPlayed).toBe(1);
  });
});

/**
 * The defect this hook exists to prevent was invisible to every behavioural
 * test: both hand-completion paths worked, they simply did different amounts
 * of work, and only the rarer one checked unlocks. Nothing but reading the
 * two call sites catches that drift reappearing, so this reads them.
 */
describe("both hand-completion paths route through the hook", () => {
  const callSites = [
    // A human's own action closes the hand -- the common ending, and the one
    // that was missing its unlock check before this hook existed.
    join("app", "api", "games", "[id]", "actions", "route.ts"),
    // A bot's action or an expired turn clock closes the hand.
    join("lib", "server", "game-store.ts"),
  ];

  for (const relativePath of callSites) {
    it(`${relativePath} calls onHandCompleted and not recordHandStats directly`, () => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).toMatch(/onHandCompleted\(/);
      expect(source).not.toMatch(/recordHandStats\(/);
      expect(source).not.toMatch(/checkAvatarUnlocks\(/);
      expect(source).not.toMatch(/checkAchievements\(/);
    });
  }
});
