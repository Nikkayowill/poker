import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_CARD_BACK } from "@/lib/cosmetics/catalog";
import { assignChipDesign, equipCosmetic, listOwnedCosmetics, purchaseCosmetic } from "./cosmetics-store";
import { adjustGold, ensureProfile, setAdminBadge, setUnlimitedGold } from "./profile-store";

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

  it("does not let a new profile equip a locked rare avatar", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);

    expect(await listOwnedCosmetics(profile.id)).not.toContain("character5");
    await expect(equipCosmetic(token, profile, "character5")).rejects.toThrow("don't own");
  });

  it("sells and equips a rare avatar at its server catalog price", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 80_000);
    const funded = await ensureProfile(token);
    const purchase = await purchaseCosmetic(token, funded, "character5");

    expect(purchase.profile.goldBalance).toBe(2000);
    expect(purchase.owned).toContain("character5");
    expect((await equipCosmetic(token, purchase.profile, "character5")).avatar2d).toBe("character5");
  });

  it("assigns an owned chip design to a denomination, and clears it back to the house default", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await adjustGold(profile.id, 20_000); // enough for chip-crimson (20,000)
    const funded = await ensureProfile(token);
    await purchaseCosmetic(token, funded, "chip-crimson");

    const owner = await ensureProfile(token);
    const assigned = await assignChipDesign(token, owner, 5, "chip-crimson");
    expect(assigned.chipDesigns[5]).toBe("chip-crimson");
    expect((await ensureProfile(token)).equipped.chipDesigns[5]).toBe("chip-crimson");

    // Assigning a second denomination doesn't disturb the first -- this is a
    // pool assignment across four independent slots, not a single equip.
    const second = await assignChipDesign(token, await ensureProfile(token), 25, "chip-crimson");
    expect(second.chipDesigns).toEqual({ 5: "chip-crimson", 25: "chip-crimson" });

    const cleared = await assignChipDesign(token, await ensureProfile(token), 5, null);
    expect(cleared.chipDesigns).toEqual({ 25: "chip-crimson" });
  });

  it("refuses to assign a chip design the player does not own", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await expect(assignChipDesign(token, profile, 5, "chip-crimson")).rejects.toThrow("don't own");
  });

  it("refuses to assign a non-chip-design cosmetic", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await expect(assignChipDesign(token, profile, 5, DEFAULT_CARD_BACK)).rejects.toThrow("isn't a chip design");
  });

  it("refuses to equip a chip design directly -- it's a per-denomination assignment, not a single equip", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    // Free, so already owned -- this must fail on the slot check, not on
    // ownership.
    await expect(equipCosmetic(token, profile, "chip-cobalt"))
      .rejects.toThrow("assigned per denomination");
  });

  it("refuses an unrecognised denomination", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await expect(assignChipDesign(token, profile, 7 as never, null)).rejects.toThrow("chip denomination");
  });
});

describe("the admin-only avatar (character32)", () => {
  it("is absent from ownership without the admin badge, and present with it", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    expect(await listOwnedCosmetics(profile.id)).not.toContain("character32");
    expect(await listOwnedCosmetics(profile.id, { adminBadge: false })).not.toContain("character32");
    expect(await listOwnedCosmetics(profile.id, { adminBadge: true })).toContain("character32");
  });

  it("can be equipped only by a profile currently holding the admin badge", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await expect(equipCosmetic(token, profile, "character32")).rejects.toThrow("don't own that item yet");

    await setAdminBadge(profile.id, true);
    const badged = await ensureProfile(token);
    const equipped = await equipCosmetic(token, badged, "character32");
    expect(equipped.avatar2d).toBe("character32");
  });

  it("can never be bought, badge or not", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await setAdminBadge(profile.id, true);
    const badged = await ensureProfile(token);
    await expect(purchaseCosmetic(token, badged, "character32")).rejects.toThrow("earned, not bought");
  });
});
