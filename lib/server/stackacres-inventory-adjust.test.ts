import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("./supabase-admin", () => ({ adminClient: () => ({ rpc }) }));

import { adjustStackAcresInventory } from "./stackacres-store";

const PROFILE = "00000000-0000-0000-0000-000000000001";

describe("adjustStackAcresInventory against the database", () => {
  beforeEach(() => rpc.mockReset());

  it("returns the new quantity", async () => {
    rpc.mockResolvedValue({ data: 7, error: null });
    await expect(adjustStackAcresInventory(PROFILE, "wood", 3)).resolves.toBe(7);
    expect(rpc).toHaveBeenCalledWith("adjust_homestead_processing_inventory", {
      p_profile_id: PROFILE,
      p_item: "wood",
      p_delta: 3,
    });
  });

  it("reads a spend the shelf cannot cover as a refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "not enough wood on hand" } });
    await expect(adjustStackAcresInventory(PROFILE, "wood", -15)).resolves.toBeNull();
  });

  it("throws when a credit is rejected, so a missing item never passes silently", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: 'violates check constraint "homestead_processing_inventory_item_check"' },
    });
    await expect(adjustStackAcresInventory(PROFILE, "wood", 5)).rejects.toThrow(/Could not update your stores/);
  });

  it("throws on any other database error, spend or credit", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    await expect(adjustStackAcresInventory(PROFILE, "stone", -2)).rejects.toThrow(/Could not update your stores/);
    await expect(adjustStackAcresInventory(PROFILE, "stone", 2)).rejects.toThrow(/Could not update your stores/);
  });
});
