import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetFriendsMemory,
  blockProfile,
  getFriendsOverview,
  getOrCreateFriendInviteCode,
  isBlockedEitherWay,
  redeemFriendInviteCode,
  regenerateFriendInviteCode,
  removeFriend,
  respondToFriendRequest,
  sendFriendRequest,
  unblockProfile,
} from "./friends-store";
import { __resetHeadToHeadMemory, recordHeadToHeadDuel } from "./head-to-head-store";
import { __resetNotificationsMemory, listNotifications } from "./notifications-store";
import { ensureProfile } from "./profile-store";

/**
 * A real profile, because the store looks its target up before it will create
 * a request -- an invented uuid is `unknown_profile`, not a friend.
 */
async function newPlayer(name: string) {
  const profile = await ensureProfile(randomUUID(), name);
  return profile.id;
}

/** Sends and immediately accepts, for the tests that need an existing friendship. */
async function befriend(a: string, b: string) {
  const sent = await sendFriendRequest(a, b);
  if (sent.status !== "sent") throw new Error(`expected sent, got ${sent.status}`);
  const accepted = await respondToFriendRequest(b, sent.requestId, "accept");
  if (accepted.status !== "accepted") throw new Error(`expected accepted, got ${accepted.status}`);
  return sent.requestId;
}

beforeEach(() => {
  __resetFriendsMemory();
  __resetHeadToHeadMemory();
  __resetNotificationsMemory();
});

describe("notifications wiring", () => {
  it("notifies the addressee when a request lands, and the requester when it's accepted", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await befriend(hero, villain);

    const [villainNotice] = (await listNotifications(villain)).notifications;
    expect(villainNotice.kind).toBe("friend_request_received");

    const [heroNotice] = (await listNotifications(hero)).notifications;
    expect(heroNotice.kind).toBe("friend_request_accepted");
  });

  it("notifies the code owner when their invite code is redeemed", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const { code } = await getOrCreateFriendInviteCode(hero);

    await redeemFriendInviteCode(villain, code);

    const [heroNotice] = (await listNotifications(hero)).notifications;
    expect(heroNotice.kind).toBe("friend_request_accepted");
  });
});

describe("friend requests (memory mode)", () => {
  it("shows a sent request as outgoing to the sender and incoming to the target", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await sendFriendRequest(hero, villain);

    const heroView = await getFriendsOverview(hero);
    expect(heroView.outgoing.map((row) => row.profileId)).toEqual([villain]);
    expect(heroView.incoming).toEqual([]);

    const villainView = await getFriendsOverview(villain);
    expect(villainView.incoming.map((row) => row.profileId)).toEqual([hero]);
    expect(villainView.outgoing).toEqual([]);
  });

  it("hydrates a request with the other player's display name, and no Gold balance", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await sendFriendRequest(hero, villain);

    const [row] = (await getFriendsOverview(villain)).incoming;
    expect(row.displayName).toBe("Hero");
    // The projection in the store is the guard; this is what would have caught
    // it being widened back to PlayerProfile.
    expect(row).not.toHaveProperty("goldBalance");
    expect(row).not.toHaveProperty("isRegistered");
  });

  it("refuses a second pending request to the same player", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await sendFriendRequest(hero, villain);
    expect((await sendFriendRequest(hero, villain)).status).toBe("already_pending");
  });

  it("refuses the crossed request -- B asking A while A is already asking B", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await sendFriendRequest(hero, villain);
    // Different ordered pair, so only the unordered-pair index stops this.
    // Accepting both would try to write the same friendship twice.
    expect((await sendFriendRequest(villain, hero)).status).toBe("already_pending");
  });

  it("refuses to friend yourself, and refuses a profile that does not exist", async () => {
    const hero = await newPlayer("Hero");
    expect((await sendFriendRequest(hero, hero)).status).toBe("self");
    expect((await sendFriendRequest(hero, randomUUID())).status).toBe("unknown_profile");
  });

  it("allows a fresh request after a decline", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const first = await sendFriendRequest(hero, villain);
    if (first.status !== "sent") throw new Error("expected sent");

    expect((await respondToFriendRequest(villain, first.requestId, "decline")).status)
      .toBe("declined");
    // The unique indexes are partial on status for exactly this: people
    // decline and ask again, and a full constraint would bar it forever.
    expect((await sendFriendRequest(hero, villain)).status).toBe("sent");
  });
});

describe("responding to requests", () => {
  it("makes both players friends on accept, and clears the pending row", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await befriend(hero, villain);

    const heroView = await getFriendsOverview(hero);
    expect(heroView.friends.map((row) => row.profileId)).toEqual([villain]);
    expect(heroView.outgoing).toEqual([]);

    // Symmetric: the friendship is stored once, in canonical order, and has
    // to read the same from the side that did not match profile_a.
    const villainView = await getFriendsOverview(villain);
    expect(villainView.friends.map((row) => row.profileId)).toEqual([hero]);
    expect(villainView.incoming).toEqual([]);
  });

  it("reads the same from both sides regardless of which id sorts first", async () => {
    // The canonical-order constraint means one of these players is profile_a
    // and the other profile_b; neither test run gets to choose which.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      __resetFriendsMemory();
      const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
      await befriend(hero, villain);
      expect((await getFriendsOverview(hero)).friends).toHaveLength(1);
      expect((await getFriendsOverview(villain)).friends).toHaveLength(1);
    }
  });

  it("refuses to let the requester accept their own request", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const sent = await sendFriendRequest(hero, villain);
    if (sent.status !== "sent") throw new Error("expected sent");

    // Direction is authorization, not a filter.
    expect((await respondToFriendRequest(hero, sent.requestId, "accept")).status).toBe("not_found");
    expect((await getFriendsOverview(hero)).friends).toEqual([]);
  });

  it("refuses to let the addressee cancel, or a stranger touch it at all", async () => {
    const [hero, villain, stranger] = [
      await newPlayer("Hero"),
      await newPlayer("Villain"),
      await newPlayer("Stranger"),
    ];
    const sent = await sendFriendRequest(hero, villain);
    if (sent.status !== "sent") throw new Error("expected sent");

    expect((await respondToFriendRequest(villain, sent.requestId, "cancel")).status)
      .toBe("not_found");
    expect((await respondToFriendRequest(stranger, sent.requestId, "accept")).status)
      .toBe("not_found");
    expect((await respondToFriendRequest(stranger, sent.requestId, "decline")).status)
      .toBe("not_found");
  });

  it("is idempotent -- a second accept finds nothing pending", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const requestId = await befriend(hero, villain);

    expect((await respondToFriendRequest(villain, requestId, "accept")).status).toBe("not_found");
    // And does not duplicate the friendship.
    expect((await getFriendsOverview(hero)).friends).toHaveLength(1);
  });

  it("lets the requester cancel while it is still pending", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const sent = await sendFriendRequest(hero, villain);
    if (sent.status !== "sent") throw new Error("expected sent");

    expect((await respondToFriendRequest(hero, sent.requestId, "cancel")).status).toBe("cancelled");
    expect((await getFriendsOverview(villain)).incoming).toEqual([]);
  });
});

describe("unfriending", () => {
  it("removes the friendship from both sides", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await befriend(hero, villain);

    expect(await removeFriend(villain, hero)).toBe(true);
    expect((await getFriendsOverview(hero)).friends).toEqual([]);
    expect((await getFriendsOverview(villain)).friends).toEqual([]);
  });

  it("reports false rather than throwing when they were not friends", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    expect(await removeFriend(hero, villain)).toBe(false);
  });
});

describe("blocking", () => {
  it("stops a request in both directions", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await blockProfile(hero, villain);

    expect((await sendFriendRequest(hero, villain)).status).toBe("blocked");
    // The blocked player is stopped too, and is told the same thing the
    // blocker is -- the route never reveals which direction the block runs.
    expect((await sendFriendRequest(villain, hero)).status).toBe("blocked");
    expect(await isBlockedEitherWay(villain, hero)).toBe(true);
  });

  it("tears down an existing friendship and cancels live requests", async () => {
    const [hero, villain, third] = [
      await newPlayer("Hero"),
      await newPlayer("Villain"),
      await newPlayer("Third"),
    ];
    await befriend(hero, villain);
    const pending = await sendFriendRequest(third, hero);
    if (pending.status !== "sent") throw new Error("expected sent");

    await blockProfile(hero, villain);

    expect((await getFriendsOverview(hero)).friends).toEqual([]);
    expect((await getFriendsOverview(villain)).friends).toEqual([]);
    // Unrelated relationships survive: the teardown is scoped to the pair.
    expect((await getFriendsOverview(hero)).incoming.map((row) => row.id)).toEqual([pending.requestId]);
  });

  it("cancels a pending request between the pair when one blocks the other", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await sendFriendRequest(villain, hero);

    await blockProfile(hero, villain);

    // Otherwise the blocked player keeps appearing in the blocker's drawer,
    // which is the one thing blocking is supposed to prevent.
    expect((await getFriendsOverview(hero)).incoming).toEqual([]);
    expect((await getFriendsOverview(villain)).outgoing).toEqual([]);
  });

  it("cannot accept a request once the addressee has blocked the requester", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const sent = await sendFriendRequest(hero, villain);
    if (sent.status !== "sent") throw new Error("expected sent");

    await blockProfile(villain, hero);

    // Note what this does and does not prove: blockProfile already cancelled
    // the row, so the accept fails on "not pending", not on the block check
    // inside the accept path. That check is a backstop for the race where a
    // block lands between an accept's read and its write, which cannot be
    // staged from outside the store -- it is covered by the FOR UPDATE and
    // the block predicate in accept_friend_request, not by this test.
    expect((await respondToFriendRequest(villain, sent.requestId, "accept")).status)
      .toBe("not_found");
    expect((await getFriendsOverview(hero)).friends).toEqual([]);
  });

  it("lifts a block without restoring the friendship it removed", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await befriend(hero, villain);
    await blockProfile(hero, villain);

    expect(await unblockProfile(hero, villain)).toBe(true);
    expect(await isBlockedEitherWay(hero, villain)).toBe(false);
    expect((await getFriendsOverview(hero)).friends).toEqual([]);
    // They can ask again, which is the whole point of not auto-restoring.
    expect((await sendFriendRequest(hero, villain)).status).toBe("sent");
  });

  it("keeps the two directions of a block independent", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await blockProfile(hero, villain);
    await blockProfile(villain, hero);

    // "A blocked B" and "B blocked A" are different facts; lifting one must
    // not lift the other.
    await unblockProfile(hero, villain);
    expect(await isBlockedEitherWay(hero, villain)).toBe(true);
  });

  it("refuses to block yourself", async () => {
    const hero = await newPlayer("Hero");
    expect(await blockProfile(hero, hero)).toBe(false);
  });
});

describe("recent opponents", () => {
  it("offers someone you've played but never friended", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await recordHeadToHeadDuel("chess", [hero, villain], 0);

    const recent = (await getFriendsOverview(hero)).recentOpponents;
    expect(recent.map((row) => row.profileId)).toEqual([villain]);
    expect(recent[0].duelRecord).toMatchObject({ wins: 1, losses: 0, draws: 0 });
  });

  it("excludes someone already a friend", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    await recordHeadToHeadDuel("chess", [hero, villain], 0);
    await befriend(hero, villain);

    expect((await getFriendsOverview(hero)).recentOpponents).toEqual([]);
  });

  it("excludes someone with a pending request in either direction", async () => {
    const [hero, sentTo, sentBy] = [
      await newPlayer("Hero"), await newPlayer("SentTo"), await newPlayer("SentBy"),
    ];
    await recordHeadToHeadDuel("chess", [hero, sentTo], 0);
    await recordHeadToHeadDuel("chess", [hero, sentBy], 0);
    await sendFriendRequest(hero, sentTo);
    await sendFriendRequest(sentBy, hero);

    expect((await getFriendsOverview(hero)).recentOpponents).toEqual([]);
  });

  it("excludes someone blocked in either direction", async () => {
    const [hero, blockedByHero, blockedHero] = [
      await newPlayer("Hero"), await newPlayer("BlockedByHero"), await newPlayer("BlockedHero"),
    ];
    await recordHeadToHeadDuel("chess", [hero, blockedByHero], 0);
    await recordHeadToHeadDuel("chess", [hero, blockedHero], 0);
    await blockProfile(hero, blockedByHero);
    await blockProfile(blockedHero, hero);

    expect((await getFriendsOverview(hero)).recentOpponents).toEqual([]);
  });

  it("is empty for someone who has never played anyone", async () => {
    const hero = await newPlayer("Hero");
    expect((await getFriendsOverview(hero)).recentOpponents).toEqual([]);
  });
});

describe("invite codes", () => {
  it("hands back the same code on repeated calls", async () => {
    const hero = await newPlayer("Hero");
    const first = await getOrCreateFriendInviteCode(hero);
    const second = await getOrCreateFriendInviteCode(hero);
    expect(second.code).toBe(first.code);
  });

  it("replaces the code on regeneration", async () => {
    const hero = await newPlayer("Hero");
    const before = await getOrCreateFriendInviteCode(hero);
    const after = await regenerateFriendInviteCode(hero);
    expect(after.code).not.toBe(before.code);
    // The old code is dead -- nobody can redeem it once a fresh one exists.
    const villain = await newPlayer("Villain");
    expect(await redeemFriendInviteCode(villain, before.code)).toEqual({ status: "invalid_code" });
  });

  it("friends the redeemer directly, with no request/accept step", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const { code } = await getOrCreateFriendInviteCode(hero);

    expect(await redeemFriendInviteCode(villain, code)).toEqual({ status: "friended", profileId: hero });
    expect((await getFriendsOverview(hero)).friends.map((row) => row.profileId)).toEqual([villain]);
    expect((await getFriendsOverview(villain)).friends.map((row) => row.profileId)).toEqual([hero]);
  });

  it("is case- and whitespace-insensitive", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const { code } = await getOrCreateFriendInviteCode(hero);

    expect(await redeemFriendInviteCode(villain, ` ${code.toLowerCase()} `))
      .toEqual({ status: "friended", profileId: hero });
  });

  it("reports already_friends rather than erroring on a second redemption", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const { code } = await getOrCreateFriendInviteCode(hero);
    await redeemFriendInviteCode(villain, code);

    expect(await redeemFriendInviteCode(villain, code)).toEqual({ status: "already_friends", profileId: hero });
  });

  it("refuses your own code", async () => {
    const hero = await newPlayer("Hero");
    const { code } = await getOrCreateFriendInviteCode(hero);
    expect(await redeemFriendInviteCode(hero, code)).toEqual({ status: "self" });
  });

  it("refuses a code from someone who blocked you, without saying so", async () => {
    const [hero, villain] = [await newPlayer("Hero"), await newPlayer("Villain")];
    const { code } = await getOrCreateFriendInviteCode(hero);
    await blockProfile(hero, villain);

    expect(await redeemFriendInviteCode(villain, code)).toEqual({ status: "blocked" });
  });

  it("reports an unknown code as invalid rather than throwing", async () => {
    const villain = await newPlayer("Villain");
    expect(await redeemFriendInviteCode(villain, "NOTREALCODE")).toEqual({ status: "invalid_code" });
  });
});
