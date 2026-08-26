import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "@/lib/profile/types";
import type { PreferenceStorage } from "@/lib/profile/stored-preference";
import {
  PENDING_FRIEND_INVITE_KEY,
  SESSION_GREETED_KEY,
  SESSION_PROFILE_KEY,
  clearPendingFriendInvite,
  clearSessionContinuity,
  markAccountLinkAnnounced,
  readCachedProfile,
  readPendingFriendInvite,
  serverProfileSnapshot,
  sessionProfileSnapshot,
  shouldAnnounceAccountLink,
  subscribeSessionCache,
  writeCachedProfile,
  writePendingFriendInvite,
} from "@/lib/profile/session-continuity";

function memoryStorage(seed: Record<string, string> = {}): PreferenceStorage {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

/** A storage that refuses every operation, as private-mode Safari and a full quota do. */
function throwingStorage(): PreferenceStorage {
  return {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
}

const profile: PlayerProfile = {
  id: "profile-1",
  displayName: "Kayo",
  initials: "K",
  avatarUrl: null,
  avatarPreset: "ace",
  equipped: { cardBack: "house", avatar2d: "ace" },
  accent: "#e7c66a",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  goldBalance: 4_200,
  unlimitedGold: false,
  lastDailyClaimAt: null,
  lastBackstopAt: null,
  isRegistered: true,
};

describe("the cached profile", () => {
  it("round-trips the profile a remount needs to paint the hub", () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, profile);
    expect(readCachedProfile(storage)).toEqual(profile);
  });

  it("reads as absent when nothing has been written", () => {
    expect(readCachedProfile(memoryStorage())).toBeNull();
  });

  it("reads as absent with no storage at all, rather than throwing", () => {
    expect(readCachedProfile(null)).toBeNull();
  });

  it("survives a storage that throws on every access", () => {
    const storage = throwingStorage();
    expect(readCachedProfile(storage)).toBeNull();
    expect(() => writeCachedProfile(storage, profile)).not.toThrow();
    expect(() => clearSessionContinuity(storage)).not.toThrow();
  });

  it("discards a payload that is not JSON", () => {
    expect(readCachedProfile(memoryStorage({ [SESSION_PROFILE_KEY]: "{not json" }))).toBeNull();
  });

  // The whole point of the shape check: a payload written by an older build
  // must fall back to the fetch rather than render `undefined` on the hub.
  it("discards a profile missing a field the hub renders", () => {
    const withoutGold: Record<string, unknown> = { ...profile };
    delete withoutGold.goldBalance;
    const storage = memoryStorage({ [SESSION_PROFILE_KEY]: JSON.stringify(withoutGold) });
    expect(readCachedProfile(storage)).toBeNull();
  });

  it("discards a balance that is not a finite number", () => {
    const storage = memoryStorage({
      [SESSION_PROFILE_KEY]: JSON.stringify({ ...profile, goldBalance: "4200" }),
    });
    expect(readCachedProfile(storage)).toBeNull();
  });

  it("clears the entry when the profile goes away", () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, profile);
    writeCachedProfile(storage, null);
    expect(readCachedProfile(storage)).toBeNull();
  });
});

describe("greeting an account once per tab", () => {
  it("announces an account this tab has not greeted", () => {
    expect(shouldAnnounceAccountLink(memoryStorage(), "account-1")).toBe(true);
  });

  // The reported bug: every "Back to the lobby" remounted PokerApp, re-ran the
  // idempotent link, and re-announced it.
  it("stays quiet on the re-link that follows a remount", () => {
    const storage = memoryStorage();
    markAccountLinkAnnounced(storage, "account-1");
    expect(shouldAnnounceAccountLink(storage, "account-1")).toBe(false);
  });

  it("still announces a different account in the same tab", () => {
    const storage = memoryStorage();
    markAccountLinkAnnounced(storage, "account-1");
    expect(shouldAnnounceAccountLink(storage, "account-2")).toBe(true);
  });

  it("announces when storage is unavailable, rather than swallowing a real sign-in", () => {
    expect(shouldAnnounceAccountLink(null, "account-1")).toBe(true);
    expect(shouldAnnounceAccountLink(throwingStorage(), "account-1")).toBe(true);
  });

  it("greets again after a sign-out clears the tab", () => {
    const storage = memoryStorage();
    markAccountLinkAnnounced(storage, "account-1");
    clearSessionContinuity(storage);
    expect(shouldAnnounceAccountLink(storage, "account-1")).toBe(true);
  });
});

describe("the useSyncExternalStore snapshot", () => {
  // React compares snapshots by identity. A fresh object per read is an
  // infinite re-render, which is why this memoizes on the raw string.
  it("hands back the same reference while the stored text is unchanged", () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, profile);
    expect(sessionProfileSnapshot(storage)).toBe(sessionProfileSnapshot(storage));
  });

  it("hands back a new reference once the stored text changes", () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, profile);
    const before = sessionProfileSnapshot(storage);
    writeCachedProfile(storage, { ...profile, goldBalance: 9_000 });
    const after = sessionProfileSnapshot(storage);
    expect(after).not.toBe(before);
    expect(after?.goldBalance).toBe(9_000);
  });

  it("reads as absent on the server, where there is no storage", () => {
    expect(serverProfileSnapshot()).toBeNull();
    expect(sessionProfileSnapshot(null)).toBeNull();
  });

  // Without this the signed-out tab keeps rendering the departed player's
  // balance, because React has no reason to re-read the snapshot.
  it("notifies subscribers on a write and on a clear", () => {
    const storage = memoryStorage();
    let notifications = 0;
    const unsubscribe = subscribeSessionCache(() => void (notifications += 1));

    writeCachedProfile(storage, profile);
    expect(notifications).toBe(1);

    clearSessionContinuity(storage);
    expect(notifications).toBe(2);
    expect(sessionProfileSnapshot(storage)).toBeNull();

    unsubscribe();
    writeCachedProfile(storage, profile);
    expect(notifications).toBe(2);
  });
});

describe("clearing on sign-out", () => {
  // Clearing one and not the other paints the departing player's name and
  // balance over the entry card of whoever signs in next on this tab.
  it("drops the cached profile and the greeting together", () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, profile);
    markAccountLinkAnnounced(storage, "account-1");

    clearSessionContinuity(storage);

    expect(storage.getItem(SESSION_PROFILE_KEY)).toBeNull();
    expect(storage.getItem(SESSION_GREETED_KEY)).toBeNull();
  });

  // A code left over from a previous account in this tab would otherwise
  // friend whoever signs in next, not whoever actually clicked the link.
  it("drops a pending friend invite too", () => {
    const storage = memoryStorage();
    writePendingFriendInvite(storage, "ABCD123456");

    clearSessionContinuity(storage);

    expect(storage.getItem(PENDING_FRIEND_INVITE_KEY)).toBeNull();
  });
});

describe("pending friend invite", () => {
  it("round-trips a code", () => {
    const storage = memoryStorage();
    writePendingFriendInvite(storage, "ABCD123456");
    expect(readPendingFriendInvite(storage)).toBe("ABCD123456");
  });

  it("is null when nothing is pending", () => {
    expect(readPendingFriendInvite(memoryStorage())).toBeNull();
  });

  it("clears without touching the rest of session continuity", () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, profile);
    writePendingFriendInvite(storage, "ABCD123456");

    clearPendingFriendInvite(storage);

    expect(readPendingFriendInvite(storage)).toBeNull();
    expect(readCachedProfile(storage)).not.toBeNull();
  });

  it("is inert wherever storage is unavailable or throwing", () => {
    expect(() => writePendingFriendInvite(null, "ABCD123456")).not.toThrow();
    expect(readPendingFriendInvite(null)).toBeNull();
    expect(() => clearPendingFriendInvite(throwingStorage())).not.toThrow();
    expect(readPendingFriendInvite(throwingStorage())).toBeNull();
  });
});
