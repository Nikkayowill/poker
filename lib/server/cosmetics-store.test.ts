import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_CARD_BACK } from "@/lib/cosmetics/catalog";
import { equipCosmetic, listOwnedCosmetics, purchaseCosmetic } from "./cosmetics-store";
import { adjustGold, ensureProfile, setUnlimitedGold } from "./profile-store";

describe("cosmetic ownership (memory mode)", () => {
  it("grants free items to everyone without storing ownership", async () => {
    const profile = await ensureProfile(randomUUID());
    expect(await listOwnedCosmetics(profile.id)).toContain(DEFAULT_CARD_BACK);
  });

  it("buys an item, debits the price, and records ownership once", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 28000); // 30,000 total -- enough for the 25,000 item
    const funded = await ensureProfile(token);
    const result = await purchaseCosmetic(token, funded, "back-oxblood");

    expect(result.profile.goldBalance).toBe(5000); // 30,000 - 25,000
    expect(result.owned).toContain("back-oxblood");
    expect(result.owned.filter((id) => id === "back-oxblood")).toHaveLength(1);
  });

  it("refuses a second purchase of the same item", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 28000);
    const funded = await ensureProfile(token);
    await purchaseCosmetic(token, funded, "back-oxblood");
    const after = await ensureProfile(token);
    await expect(purchaseCosmetic(token, after, "back-oxblood")).rejects.toThrow("already own");
  });

  it("refuses a purchase the player cannot afford, leaving Gold untouched", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await expect(purchaseCosmetic(token, profile, "back-ivory")).rejects.toThrow("Not enough Gold.");
    expect((await ensureProfile(token)).goldBalance).toBe(2000);
  });

  it("refuses to sell a Signature item at any balance", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 500_000);
    const rich = await ensureProfile(token);
    // The rule that keeps the best-looking things at the table unbuyable.
    await expect(purchaseCosmetic(token, rich, "back-riverwood"))
      .rejects.toThrow("earned, not bought");
  });

  it("rejects an item id that isn't in the catalog", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await expect(purchaseCosmetic(token, profile, "back-does-not-exist"))
      .rejects.toThrow("doesn't exist");
  });

  it("gives an unlimited-Gold profile the item without charging it", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await setUnlimitedGold(profile.id, true);
    const unlimited = await ensureProfile(token);

    const result = await purchaseCosmetic(token, unlimited, "back-brass");
    expect(result.owned).toContain("back-brass");
    expect(result.profile.goldBalance).toBe(2000);
  });

  it("equips an owned item and refuses one the player does not own", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 28000); // enough for the 25,000 item
    const funded = await ensureProfile(token);
    await purchaseCosmetic(token, funded, "back-slate");

    const owner = await ensureProfile(token);
    expect((await equipCosmetic(token, owner, "back-slate")).cardBack).toBe("back-slate");
    expect((await ensureProfile(token)).equipped.cardBack).toBe("back-slate");

    // The store only offers what you own, but the endpoint cannot assume that.
    await expect(equipCosmetic(token, owner, "back-ivory")).rejects.toThrow("don't own");
  });

  it("does not let a new profile equip a locked 3D character", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);

    expect(await listOwnedCosmetics(profile.id)).not.toContain("marcus");
    expect(await listOwnedCosmetics(profile.id)).not.toContain("claira");
    await expect(equipCosmetic(token, profile, "marcus")).rejects.toThrow("don't own");
    await expect(equipCosmetic(token, profile, "claira")).rejects.toThrow("don't own");
  });

  it("sells and equips a premium 3D character at its server catalog price", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 1_000_000);
    const funded = await ensureProfile(token);
    const purchase = await purchaseCosmetic(token, funded, "derek");

    expect(purchase.profile.goldBalance).toBe(2000);
    expect(purchase.owned).toContain("derek");
    expect((await equipCosmetic(token, purchase.profile, "derek")).avatar3d).toBe("derek");
  });
});
