import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import {
  adjustGold,
  banProfile,
  claimDailyGold,
  ensureProfile,
  isBanned,
  listProfiles,
  recordSeenIp,
  setUnlimitedGold,
  spendGold,
} from "./profile-store";

describe("Gold economy (memory mode)", () => {
  it("gives a brand new profile the starting balance", async () => {
    const profile = await ensureProfile(randomUUID());
    expect(profile.goldBalance).toBe(2000);
    expect(profile.unlimitedGold).toBe(false);
    expect(profile.lastDailyClaimAt).toBeNull();
  });

  it("deducts Gold on a successful spend", async () => {
    const token = randomUUID();
    await ensureProfile(token);
    const after = await spendGold(token, 500);
    expect(after.goldBalance).toBe(1500);
  });

  it("rejects a spend larger than the balance", async () => {
    const token = randomUUID();
    await ensureProfile(token);
    await expect(spendGold(token, 5000)).rejects.toThrow("Not enough Gold.");
  });

  it("never deducts for an unlimited-Gold profile", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await setUnlimitedGold(profile.id, true);
    const after = await spendGold(token, 1_000_000);
    expect(after.goldBalance).toBe(2000);
  });

  it("rejects setUnlimitedGold for an unknown profile id", async () => {
    await expect(setUnlimitedGold(randomUUID(), true)).rejects.toThrow("Profile not found.");
  });

  it("grants the daily amount once, then rejects a same-day repeat", async () => {
    const token = randomUUID();
    await ensureProfile(token);
    const claimed = await claimDailyGold(token);
    expect(claimed.goldBalance).toBe(3000);
    expect(claimed.lastDailyClaimAt).not.toBeNull();
    await expect(claimDailyGold(token)).rejects.toThrow("already claimed");
  });

  it("rejects an invalid (zero or negative) spend amount", async () => {
    const token = randomUUID();
    await ensureProfile(token);
    await expect(spendGold(token, 0)).rejects.toThrow("Invalid Gold amount.");
    await expect(spendGold(token, -50)).rejects.toThrow("Invalid Gold amount.");
  });

  it("adjusts Gold by an admin-supplied delta, clamped at 0", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    const credited = await adjustGold(profile.id, 500);
    expect(credited.goldBalance).toBe(2500);
    const debited = await adjustGold(profile.id, -10_000);
    expect(debited.goldBalance).toBe(0);
  });

  it("rejects an invalid (zero) Gold adjustment and an unknown profile id", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await expect(adjustGold(profile.id, 0)).rejects.toThrow("Invalid Gold adjustment.");
    await expect(adjustGold(randomUUID(), 100)).rejects.toThrow("Profile not found.");
  });

  it("bans and unbans a profile by id, checkable via isBanned", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    expect(await isBanned(token)).toBe(false);
    await banProfile(profile.id, true);
    expect(await isBanned(token)).toBe(true);
    await banProfile(profile.id, false);
    expect(await isBanned(token)).toBe(false);
  });

  it("rejects banProfile for an unknown profile id", async () => {
    await expect(banProfile(randomUUID(), true)).rejects.toThrow("Profile not found.");
  });

  it("treats an unknown token as not banned", async () => {
    expect(await isBanned(randomUUID())).toBe(false);
  });

  it("records the last-seen IP for a token and surfaces it via listProfiles", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await recordSeenIp(token, "203.0.113.5");
    const profiles = await listProfiles();
    const found = profiles.find((entry) => entry.id === profile.id);
    expect(found?.lastSeenIp).toBe("203.0.113.5");
  });

  it("lists profiles newest first, including one just created", async () => {
    const token = randomUUID();
    const created = await ensureProfile(token, "Newest Signup");
    await new Promise((resolve) => setTimeout(resolve, 100)); // Wait a bit to ensure different timestamps
    const profiles = await listProfiles();
    expect(profiles.some((profile) => profile.id === created.id)).toBe(true);
    for (let i = 1; i < profiles.length; i += 1) {
      expect(profiles[i - 1].createdAt >= profiles[i].createdAt).toBe(true);
    }
  });
});
