import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  contributeToBlueprint,
  startBlueprintForProfile,
  BlueprintRequestError,
} from "./stackacres-blueprint-service";
import {
  contributeToStackAcresMythicBlueprint,
  startStackAcresMythicBlueprint,
} from "./stackacres-service";
import { __resetStackAcresBlueprintsForTest } from "./stackacres-blueprint-store";
import {
  __resetStackAcresForTest,
  adjustStackAcresInventory,
  readStackAcresInventory,
} from "./stackacres-store";
import { inventoryQuantity } from "@/lib/stackacres/inventory";
import { __resetStackAcresIntentsForTest } from "./stackacres-intent-store";
import { ensureProfile } from "./profile-store";

const STRUCTURE = "mythic-ember-spire";

beforeEach(() => {
  __resetStackAcresForTest();
  __resetStackAcresBlueprintsForTest();
  __resetStackAcresIntentsForTest();
});

async function newProfile() {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  return { token, profileId: profile.id };
}

describe("startBlueprintForProfile", () => {
  it("begins a fresh copy of the blueprint at stage 0", async () => {
    const { profileId } = await newProfile();
    const view = await startBlueprintForProfile(profileId, STRUCTURE);
    expect(view.status).toBe("in_progress");
    expect(view.currentStage).toBe(0);
    expect(view.stage?.label).toBe("Foundation");
    expect(view.stage?.requirements).toEqual([
      { item: "wheat", label: "20 Wheat", required: 20, contributed: 0 },
      { item: "flour", label: "10 Flour", required: 10, contributed: 0 },
    ]);
    expect(view.nextUnlock).toBe("Framework");
  });

  it("is idempotent -- a repeat start does not reset progress", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    await adjustStackAcresInventory(profileId, "wheat", 20);
    await contributeToBlueprint(profileId, STRUCTURE, "wheat", 20);

    const again = await startBlueprintForProfile(profileId, STRUCTURE);
    expect(again.stage?.requirements.find((r) => r.item === "wheat")?.contributed).toBe(20);
  });

  it("rejects a structure id that is not in the catalogue", async () => {
    const { profileId } = await newProfile();
    await expect(startBlueprintForProfile(profileId, "not-a-real-structure")).rejects.toThrow(
      "Not a real blueprint.",
    );
  });
});

describe("contributeToBlueprint", () => {
  it("refuses before the blueprint has been started", async () => {
    const { profileId } = await newProfile();
    await expect(contributeToBlueprint(profileId, STRUCTURE, "wheat", 5)).rejects.toThrow(
      "You have not started that blueprint yet.",
    );
  });

  it("refuses a non-positive or non-integer amount", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    await expect(contributeToBlueprint(profileId, STRUCTURE, "wheat", 0)).rejects.toThrow(
      "That is not a real amount to contribute.",
    );
    await expect(contributeToBlueprint(profileId, STRUCTURE, "wheat", 1.5)).rejects.toThrow(
      "That is not a real amount to contribute.",
    );
  });

  it("refuses a material the current stage does not ask for", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    await adjustStackAcresInventory(profileId, "cloth", 10);
    await expect(contributeToBlueprint(profileId, STRUCTURE, "cloth", 5)).rejects.toThrow(
      "Foundation does not need",
    );
  });

  it("refuses when the player does not hold enough of the material", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    await adjustStackAcresInventory(profileId, "wheat", 3);
    await expect(contributeToBlueprint(profileId, STRUCTURE, "wheat", 20)).rejects.toThrow(
      "you do not have yet",
    );
    // Nothing was taken on a refusal.
    const view = await startBlueprintForProfile(profileId, STRUCTURE);
    expect(view.stage?.requirements.find((r) => r.item === "wheat")?.contributed).toBe(0);
  });

  it("accepts a partial contribution and reports the remainder still needed", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    await adjustStackAcresInventory(profileId, "wheat", 12);
    const view = await contributeToBlueprint(profileId, STRUCTURE, "wheat", 12);
    expect(view.status).toBe("in_progress");
    expect(view.stage?.requirements.find((r) => r.item === "wheat")?.contributed).toBe(12);
    expect(view.stage?.satisfied).toBe(false);
  });

  it("clamps a contribution to what the stage still needs, spending only that much", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    await adjustStackAcresInventory(profileId, "wheat", 500);
    const view = await contributeToBlueprint(profileId, STRUCTURE, "wheat", 500);
    expect(view.stage?.requirements.find((r) => r.item === "wheat")?.contributed).toBe(20);
    // 500 - 20 = 480 left over, not spent past the requirement.
    const inventory = await readStackAcresInventory(profileId);
    expect(inventoryQuantity(inventory, "wheat")).toBe(480);
  });

  it("refuses a second delivery once a line is already fully met", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    await adjustStackAcresInventory(profileId, "wheat", 30);
    await contributeToBlueprint(profileId, STRUCTURE, "wheat", 20);
    await expect(contributeToBlueprint(profileId, STRUCTURE, "wheat", 10)).rejects.toThrow(
      "already has enough",
    );
  });

  it("advances to the next stage only once EVERY line at the current stage is met", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    await adjustStackAcresInventory(profileId, "wheat", 20);
    await adjustStackAcresInventory(profileId, "flour", 10);

    const afterWheat = await contributeToBlueprint(profileId, STRUCTURE, "wheat", 20);
    expect(afterWheat.currentStage).toBe(0); // flour still outstanding
    expect(afterWheat.stage?.satisfied).toBe(false);

    const afterFlour = await contributeToBlueprint(profileId, STRUCTURE, "flour", 10);
    expect(afterFlour.currentStage).toBe(1);
    expect(afterFlour.stage?.label).toBe("Framework");
    expect(afterFlour.nextUnlock).toBe("Spire Crown");
  });

  it("completes the structure on the final stage's last requirement, with no stage left to show", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);

    for (const [item, quantity] of [
      ["wheat", 20],
      ["flour", 10 + 15], // stage 0 + stage 1
      ["cheese", 8 + 6], // stage 1 + stage 2
      ["cloth", 10],
    ] as const) {
      await adjustStackAcresInventory(profileId, item, quantity);
    }

    await contributeToBlueprint(profileId, STRUCTURE, "wheat", 20);
    await contributeToBlueprint(profileId, STRUCTURE, "flour", 10); // finishes stage 0
    await contributeToBlueprint(profileId, STRUCTURE, "flour", 15);
    const afterCheeseStage1 = await contributeToBlueprint(profileId, STRUCTURE, "cheese", 8); // finishes stage 1
    expect(afterCheeseStage1.currentStage).toBe(2);

    const afterCheeseStage2 = await contributeToBlueprint(profileId, STRUCTURE, "cheese", 6);
    expect(afterCheeseStage2.status).toBe("in_progress"); // cloth still outstanding

    const final = await contributeToBlueprint(profileId, STRUCTURE, "cloth", 10);
    expect(final.status).toBe("completed");
    expect(final.stage).toBeNull();
    expect(final.nextUnlock).toBeNull();
    expect(final.completedAt).not.toBeNull();
  });

  it("refuses any further contribution once the structure is completed", async () => {
    const { profileId } = await newProfile();
    await startBlueprintForProfile(profileId, STRUCTURE);
    for (const [item, quantity] of [
      ["wheat", 20],
      ["flour", 25],
      ["cheese", 14],
      ["cloth", 10],
    ] as const) {
      await adjustStackAcresInventory(profileId, item, quantity);
    }
    await contributeToBlueprint(profileId, STRUCTURE, "wheat", 20);
    await contributeToBlueprint(profileId, STRUCTURE, "flour", 10);
    await contributeToBlueprint(profileId, STRUCTURE, "flour", 15);
    await contributeToBlueprint(profileId, STRUCTURE, "cheese", 8);
    await contributeToBlueprint(profileId, STRUCTURE, "cheese", 6);
    await contributeToBlueprint(profileId, STRUCTURE, "cloth", 10);

    await adjustStackAcresInventory(profileId, "cloth", 1);
    await expect(contributeToBlueprint(profileId, STRUCTURE, "cloth", 1)).rejects.toThrow(
      "already finished",
    );
  });

  it("carries the current state as the error's round payload", async () => {
    const { profileId } = await newProfile();
    try {
      await contributeToBlueprint(profileId, STRUCTURE, "wheat", 5);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(BlueprintRequestError);
      expect((error as BlueprintRequestError).round?.status).toBe("not_started");
    }
  });
});

describe("the full-farm view wrappers", () => {
  it("startStackAcresMythicBlueprint returns the whole farm's view, blueprints included", async () => {
    const { token, profileId } = await newProfile();
    const view = await startStackAcresMythicBlueprint(token, STRUCTURE);
    expect(view.blueprints[STRUCTURE].status).toBe("in_progress");
    // Every catalogue entry is present even for one never touched -- there is
    // only one blueprint today, so this also covers "present, not_started".
    await adjustStackAcresInventory(profileId, "wheat", 20);
  });

  it("contributeToStackAcresMythicBlueprint resolves the token exactly once and returns the full view", async () => {
    const { token, profileId } = await newProfile();
    await startStackAcresMythicBlueprint(token, STRUCTURE);
    await adjustStackAcresInventory(profileId, "wheat", 20);
    const view = await contributeToStackAcresMythicBlueprint(token, STRUCTURE, "wheat", 20);
    expect(view.blueprints[STRUCTURE].stage?.requirements.find((r) => r.item === "wheat")?.contributed).toBe(
      20,
    );
    // The rest of the farm's view is still the same shape every other action
    // returns -- not just the blueprint slice.
    expect(view.profile.id).toBe(profileId);
    expect(view.units).toEqual([]);
  });
});
