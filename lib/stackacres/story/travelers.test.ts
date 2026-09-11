import { describe, expect, it } from "vitest";

import { STACKACRES_ITEMS } from "../items";
import { STACKACRES_TOOL_TIERS } from "../equipment";
import { MACHINE_PROCESSED_ITEMS, MACHINE_RAW_ITEMS } from "../machine-items";
import { RECIPE_IDS } from "../recipes";
import { isStackAcresCrop } from "../catalogue";
import { ZONE_IDS } from "../zones";
import { STORY_ITEM_IDS, isStoryItemId } from "./items";
import { ALL_STORY_QUESTS, TRAVELER_QUESTS, objectiveLabel } from "./quests";
import { TRAVELERS_IN_FINALE, TRAVELER_CATALOGUE, TRAVELER_IDS, TRAVELER_PORTRAIT, isTravelerId } from "./travelers";

const MACHINE_ITEM_IDS: readonly string[] = [...STACKACRES_ITEMS, ...MACHINE_RAW_ITEMS, ...MACHINE_PROCESSED_ITEMS];

describe("TRAVELER_IDS", () => {
  it("is eleven, unique, and Ray comes first", () => {
    expect(TRAVELER_IDS).toHaveLength(11);
    expect(new Set(TRAVELER_IDS).size).toBe(11);
    expect(TRAVELER_IDS[0]).toBe("ray");
    expect(TRAVELERS_IN_FINALE).toBe(10);
  });

  it("isTravelerId accepts the cast and nothing else", () => {
    expect(isTravelerId("pierre")).toBe(true);
    expect(isTravelerId("bleep")).toBe(false);
    expect(isTravelerId("")).toBe(false);
    expect(isTravelerId(3)).toBe(false);
  });
});

describe("TRAVELER_CATALOGUE", () => {
  it("hands out every story item exactly once", () => {
    const rewards = TRAVELER_IDS.map((id) => TRAVELER_CATALOGUE[id].reward);
    expect(new Set(rewards).size).toBe(rewards.length);
    expect([...rewards].sort()).toEqual([...STORY_ITEM_IDS].sort());
    for (const reward of rewards) expect(isStoryItemId(reward)).toBe(true);
  });

  it("stands every traveler in a real district", () => {
    for (const id of TRAVELER_IDS) expect(ZONE_IDS).toContain(TRAVELER_CATALOGUE[id].zone);
  });

  it("maps the brief's unlock requirements onto derived facts", () => {
    expect(TRAVELER_CATALOGUE.ray.unlock).toEqual({ kind: "always" });
    expect(TRAVELER_CATALOGUE.pierre.unlock).toEqual({ kind: "milestone", count: 1 });
    expect(TRAVELER_CATALOGUE.miles.unlock).toEqual({ kind: "milestone", count: 1 });
    expect(TRAVELER_CATALOGUE.skye.unlock).toEqual({ kind: "milestone", count: 2 });
    expect(TRAVELER_CATALOGUE.barnaby.unlock).toEqual({ kind: "milestone", count: 2 });
    expect(TRAVELER_CATALOGUE.brayden.unlock).toEqual({ kind: "milestone", count: 3 });
    expect(TRAVELER_CATALOGUE.ivy.unlock).toEqual({ kind: "milestone", count: 3 });
    expect(TRAVELER_CATALOGUE.bea.unlock).toEqual({ kind: "milestone", count: 4 });
    expect(TRAVELER_CATALOGUE.arthur.unlock).toEqual({ kind: "flag", flag: "town_trusted" });
    expect(TRAVELER_CATALOGUE.wes.unlock).toEqual({ kind: "flag", flag: "cleared_oxfields" });
    expect(TRAVELER_CATALOGUE.leo.unlock).toEqual({ kind: "finale" });
  });

  it("names a portrait file per traveler", () => {
    for (const id of TRAVELER_IDS) expect(TRAVELER_PORTRAIT[id]).toBe(`/stackacres/sprites/traveler-${id}.png`);
  });
});

describe("TRAVELER_QUESTS", () => {
  it("gives every traveler a line whose ids follow <traveler>.q<n>", () => {
    for (const id of TRAVELER_IDS) {
      const line = TRAVELER_QUESTS[id];
      expect(line.length).toBeGreaterThan(0);
      line.forEach((quest, i) => {
        expect(quest.id).toBe(`${id}.q${i + 1}`);
        expect(quest.title.length).toBeGreaterThan(0);
        expect(quest.turnInLabel.length).toBeGreaterThan(0);
        expect(quest.objectives.length).toBeGreaterThan(0);
      });
    }
    expect(new Set(ALL_STORY_QUESTS.map((quest) => quest.id)).size).toBe(ALL_STORY_QUESTS.length);
  });

  it("only names catalogue ids and positive whole targets", () => {
    for (const quest of ALL_STORY_QUESTS) {
      for (const objective of quest.objectives) {
        expect(Number.isInteger(objective.target)).toBe(true);
        expect(objective.target).toBeGreaterThan(0);
        expect(objectiveLabel(objective).length).toBeGreaterThan(0);
        switch (objective.kind) {
          case "harvest":
            expect(objective.crops.length).toBeGreaterThan(0);
            for (const crop of objective.crops) expect(isStackAcresCrop(crop)).toBe(true);
            break;
          case "deliver":
            expect(MACHINE_ITEM_IDS).toContain(objective.item);
            break;
          case "process":
            expect(RECIPE_IDS).toContain(objective.recipe);
            break;
          case "hold-tool":
            expect(STACKACRES_TOOL_TIERS).toContain(objective.tool);
            expect(objective.target).toBe(1);
            break;
          default:
            break;
        }
      }
    }
  });

  it("reads the brief's asks as real farm verbs", () => {
    expect(TRAVELER_QUESTS.pierre[0].objectives).toEqual([
      { kind: "deliver", item: "potato", target: 5 },
      { kind: "deliver", item: "carrot", target: 5 },
    ]);
    expect(TRAVELER_QUESTS.brayden[0].objectives).toEqual([{ kind: "hold-tool", tool: "iron-shovel", target: 1 }]);
    expect(TRAVELER_QUESTS.bea[0].objectives).toEqual([{ kind: "harvest", crops: ["poppy", "sunflower"], target: 16 }]);
    expect(TRAVELER_QUESTS.leo[1].objectives.map((objective) => objective.kind)).toEqual(["pipes", "forge"]);
  });

  it("labels objectives as one imperative line", () => {
    expect(objectiveLabel({ kind: "harvest", crops: ["poppy", "sunflower"], target: 16 })).toBe(
      "Harvest 16 poppy or sunflower",
    );
    expect(objectiveLabel({ kind: "deliver", item: "potato", target: 5 })).toBe("Bring 5 Potatoes");
    expect(objectiveLabel({ kind: "hold-tool", tool: "iron-shovel", target: 1 })).toBe("Own the Iron Shovel");
    expect(objectiveLabel({ kind: "clear-sector", target: 1 })).toBe("Clear a district of wild growth");
  });
});
