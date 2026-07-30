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
  state.winners = [{ seatId: seat.id, name: seat.name, amount: amountWon, hand: "Flush" }];
  return state;
}

describe("checkAvatarUnlocks", () => {
  it("awards a chips-won avatar the moment a single hand crosses its threshold", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);

    const before = await listOwnedCosmetics(profile.id);
    expect(before).not.toContain("avatar-closer");

    const state = wonHand(token, 60_000);
    state.id = randomUUID();
    state.handNumber = 1;
    const touched = await recordHandStats(state);
    expect(touched).toEqual([profile.id]);
    await checkAvatarUnlocks(touched);

    const after = await listOwnedCosmetics(profile.id);
    expect(after).toContain("avatar-closer");
    // 60,000 clears avatar-closer's 50,000 chips-won bar but not
    // avatar-veteran's 250,000 -- crossing one threshold must not award
    // every avatar past it.
    expect(after).not.toContain("avatar-veteran");
    // Only one hand has been recorded, nowhere near avatar-rounder's
    // 25 hands-won bar -- the two unlock metrics must not bleed into
    // each other.
    expect(after).not.toContain("avatar-rounder");
  });

  it("does not re-award an avatar the profile already owns", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);

    const first = wonHand(token, 60_000);
    first.id = randomUUID();
    first.handNumber = 1;
    await checkAvatarUnlocks(await recordHandStats(first));
    expect(await listOwnedCosmetics(profile.id)).toContain("avatar-closer");

    const second = wonHand(token, 60_000);
    second.id = first.id;
    second.handNumber = 2;
    await checkAvatarUnlocks(await recordHandStats(second));

    const owned = await listOwnedCosmetics(profile.id);
    expect(owned.filter((id) => id === "avatar-closer")).toHaveLength(1);
  });
});
