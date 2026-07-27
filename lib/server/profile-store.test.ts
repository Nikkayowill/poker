import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { claimDailyGold, ensureProfile, setUnlimitedGold, spendGold } from "./profile-store";

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
});
