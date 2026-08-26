import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import { checkAvatarUnlocks } from "./avatar-unlocks";
import { listOwnedCosmetics } from "./cosmetics-store";
import { ensureProfile } from "./profile-store";
import { recordHandStats } from "./stats-store";

/**
 * A minimal completed-hand GameState: real createGame() for a valid table,
 * then the two fields recordHandStats actually reads are set directly
 * rather than played out through the engine -- this is a stats-recording
 * test, not an engine test, and running hundreds of real hands to cross a
 * hands-won threshold would make it both slow and about the wrong thing.
 */
function wonHand(token: string, amountWon: number) {
  const state = createGame(token);
  const seat = state.seats[0];
  seat.holeCards = [{ rank: "A", suit: "spades" }, { rank: "K", suit: "spades" }];
  seat.committed = 500;
  seat.vpip = true;
  state.winners = [{ seatId: seat.id, name: seat.name, amount: amountWon, hand: "Flush", bestFive: null }];
  return state;
}

describe("checkAvatarUnlocks", () => {
  it("awards the first earned character on its lifetime-hands-won bar (character1, 250)", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const gameId = randomUUID();

    for (let handNumber = 1; handNumber <= 249; handNumber++) {
      const state = wonHand(token, 1000);
      state.id = gameId;
      state.handNumber = handNumber;
      await checkAvatarUnlocks(await recordHandStats(state));
    }
    expect(await listOwnedCosmetics(profile.id)).not.toContain("character1");

    const twoFiftieth = wonHand(token, 1000);
    twoFiftieth.id = gameId;
    twoFiftieth.handNumber = 250;
    await checkAvatarUnlocks(await recordHandStats(twoFiftieth));

    const owned = await listOwnedCosmetics(profile.id);
    expect(owned).toContain("character1");
    // Crossing character1's bar must not award character2's 750.
    expect(owned).not.toContain("character2");
    // character5 is a Gold-priced item with no `unlock` field, so no number
    // of hand wins may ever grant it. This is the load-bearing half of this
    // test: a regression that re-derived an unlock for a priced character --
    // or let one fall through to a free default -- would hand out a paid
    // character for nothing.
    expect(owned).not.toContain("character5");
  }, 20_000);

  // Every unlockable avatar today is handsWon-gated, not chipsWon-gated, so
  // checkAvatarUnlocks's chipsWon branch has no live catalog entry to
  // exercise it against until a chipsWon avatar exists again. The two tests
  // here cover what's real instead: crossing exactly one handsWon bar per
  // hand recorded, and never twice.

  it("does not re-award an avatar the profile already owns", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const gameId = randomUUID();

    for (let handNumber = 1; handNumber <= 250; handNumber++) {
      const state = wonHand(token, 1000);
      state.id = gameId;
      state.handNumber = handNumber;
      await checkAvatarUnlocks(await recordHandStats(state));
    }
    expect(await listOwnedCosmetics(profile.id)).toContain("character1");

    // A 251st win must not grant a second copy of an avatar already owned.
    const again = wonHand(token, 1000);
    again.id = gameId;
    again.handNumber = 251;
    await checkAvatarUnlocks(await recordHandStats(again));

    const owned = await listOwnedCosmetics(profile.id);
    expect(owned.filter((id) => id === "character1")).toHaveLength(1);
  }, 20_000);
});
