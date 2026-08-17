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
 * test, not an engine test, and running 25+ real hands to cross a
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
  it("awards the first earned 3D character on the fiftieth lifetime hand win", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const gameId = randomUUID();

    for (let handNumber = 1; handNumber <= 49; handNumber++) {
      const state = wonHand(token, 1000);
      state.id = gameId;
      state.handNumber = handNumber;
      await checkAvatarUnlocks(await recordHandStats(state));
    }
    expect(await listOwnedCosmetics(profile.id)).not.toContain("donni");

    const fiftieth = wonHand(token, 1000);
    fiftieth.id = gameId;
    fiftieth.handNumber = 50;
    await checkAvatarUnlocks(await recordHandStats(fiftieth));

    const owned = await listOwnedCosmetics(profile.id);
    expect(owned).toContain("donni");
    // Crossing donni's bar must not award jimmy's 150.
    expect(owned).not.toContain("jimmy");
    // claira is a 7,000,000 Gold item with no `unlock` field, so no number
    // of hand wins may ever grant her. This is the load-bearing half of
    // this test now: the loop above walks straight past the 10-hand bar
    // she used to carry, so a regression that re-derived an unlock for a
    // priced character -- or let one fall through to a free default --
    // would hand out the catalog's most expensive character for nothing.
    expect(owned).not.toContain("claira");
  });

  // The 2D avatar catalog (character1-11, replacing the retired illustrated
  // roster) has no chipsWon-gated entry any more than the old one's
  // avatar-closer/avatar-veteran did -- every unlockable is handsWon-gated,
  // so checkAvatarUnlocks's chipsWon branch has no live catalog entry to
  // exercise it against until a chipsWon avatar exists again. The two tests
  // below cover what's real instead: crossing exactly one handsWon bar per
  // hand recorded, and never twice.

  it("does not re-award an avatar the profile already owns", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const gameId = randomUUID();

    for (let handNumber = 1; handNumber <= 50; handNumber++) {
      const state = wonHand(token, 1000);
      state.id = gameId;
      state.handNumber = handNumber;
      await checkAvatarUnlocks(await recordHandStats(state));
    }
    expect(await listOwnedCosmetics(profile.id)).toContain("donni");

    // A 51st win must not grant a second copy of an avatar already owned.
    const again = wonHand(token, 1000);
    again.id = gameId;
    again.handNumber = 51;
    await checkAvatarUnlocks(await recordHandStats(again));

    const owned = await listOwnedCosmetics(profile.id);
    expect(owned.filter((id) => id === "donni")).toHaveLength(1);
  });
});
