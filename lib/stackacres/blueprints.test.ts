import { describe, expect, it } from "vitest";
import {
  MYTHIC_BLUEPRINTS,
  isBlueprintId,
  isFinalStageIndex,
  isStageSatisfied,
  isValidBlueprintItem,
  nextUnlockLabel,
  notStartedConstructionState,
  overallProgressFraction,
  stageAt,
  stageProgressFraction,
  stageRemaining,
  stageRequirement,
  totalStages,
  type ConstructionState,
} from "./blueprints";

const spire = MYTHIC_BLUEPRINTS["mythic-ember-spire"];

describe("isBlueprintId", () => {
  it("accepts the shipped structure and rejects anything else", () => {
    expect(isBlueprintId("mythic-ember-spire")).toBe(true);
    expect(isBlueprintId("mythic-ember-castle")).toBe(false);
    expect(isBlueprintId("")).toBe(false);
  });
});

describe("isValidBlueprintItem", () => {
  it("only accepts a real processing-track item", () => {
    expect(isValidBlueprintItem("flour")).toBe(true);
    expect(isValidBlueprintItem("gold")).toBe(false);
  });
});

/**
 * PARITY PIN: the SQL migration's `stackacres_blueprint_requirements_def`
 * seed rows must name the exact same (stage, item, quantity) triples as
 * MYTHIC_BLUEPRINTS below -- a SQL function cannot import this module, so the
 * two are hand-kept in sync (see blueprints.ts's own header). This test is
 * what catches a drift, the same role contracts.test.ts's 1.3x premium pin
 * plays for ./contracts.ts.
 *
 * If this ever fails after editing the migration or this catalogue, fix
 * whichever one is wrong -- do not edit this test to match a mistake.
 */
describe("MYTHIC_BLUEPRINTS parity with the migration seed", () => {
  it("mythic-ember-spire matches supabase/migrations/20260905130000_stackacres_mythic_blueprints.sql", () => {
    expect(spire.stages.map((stage) => ({ index: stage.index, requirements: stage.requirements }))).toEqual([
      {
        index: 0,
        requirements: [
          { item: "wheat", quantity: 20 },
          { item: "flour", quantity: 10 },
        ],
      },
      {
        index: 1,
        requirements: [
          { item: "flour", quantity: 15 },
          { item: "cheese", quantity: 8 },
        ],
      },
      {
        index: 2,
        requirements: [
          { item: "cheese", quantity: 6 },
          { item: "cloth", quantity: 10 },
        ],
      },
    ]);
  });
});

describe("stageRequirement / stageRemaining", () => {
  it("is null for an item the stage never asks for", () => {
    expect(stageRequirement(spire.stages[0], "cloth")).toBeNull();
  });

  it("is the full quantity when nothing has been contributed yet", () => {
    expect(stageRemaining(spire.stages[0], {}, "wheat")).toBe(20);
  });

  it("shrinks as contributions land, clamped at zero", () => {
    expect(stageRemaining(spire.stages[0], { wheat: 12 }, "wheat")).toBe(8);
    expect(stageRemaining(spire.stages[0], { wheat: 999 }, "wheat")).toBe(0);
  });

  it("is zero for an item the stage does not ask for, never negative or NaN", () => {
    expect(stageRemaining(spire.stages[0], { cloth: 5 }, "cloth")).toBe(0);
  });
});

describe("isStageSatisfied", () => {
  it("requires every line, not just one", () => {
    expect(isStageSatisfied(spire.stages[0], { wheat: 20 })).toBe(false);
    expect(isStageSatisfied(spire.stages[0], { wheat: 20, flour: 10 })).toBe(true);
  });

  it("surplus on one line does not excuse a shortfall on another", () => {
    expect(isStageSatisfied(spire.stages[0], { wheat: 500, flour: 9 })).toBe(false);
  });
});

describe("stageProgressFraction", () => {
  it("is 0 with nothing contributed and 1 once every line is met", () => {
    expect(stageProgressFraction(spire.stages[0], {})).toBe(0);
    expect(stageProgressFraction(spire.stages[0], { wheat: 20, flour: 10 })).toBe(1);
  });

  it("weighs by total quantity across lines, clamped so surplus cannot exceed 1", () => {
    // 20 wheat + 10 flour = 30 total. 10 wheat + 10 flour(surplus clamped to
    // 10) = 20 held -> 20/30.
    expect(stageProgressFraction(spire.stages[0], { wheat: 10, flour: 999 })).toBeCloseTo(20 / 30);
  });
});

describe("totalStages / isFinalStageIndex / stageAt / nextUnlockLabel", () => {
  it("the shipped structure has exactly three stages", () => {
    expect(totalStages(spire)).toBe(3);
  });

  it("only the last index is final", () => {
    expect(isFinalStageIndex(spire, 0)).toBe(false);
    expect(isFinalStageIndex(spire, 1)).toBe(false);
    expect(isFinalStageIndex(spire, 2)).toBe(true);
  });

  it("stageAt is null past the ladder's end", () => {
    expect(stageAt(spire, 2)?.label).toBe("Spire Crown");
    expect(stageAt(spire, 3)).toBeNull();
  });

  it("nextUnlockLabel names the following stage, and is null at the last one", () => {
    expect(nextUnlockLabel(spire, 0)).toBe("Framework");
    expect(nextUnlockLabel(spire, 1)).toBe("Spire Crown");
    expect(nextUnlockLabel(spire, 2)).toBeNull();
  });
});

describe("overallProgressFraction", () => {
  it("is 0 for a not-started blueprint and 1 for a completed one", () => {
    const notStarted = notStartedConstructionState("mythic-ember-spire");
    expect(overallProgressFraction(spire, notStarted)).toBe(0);

    const completed: ConstructionState = {
      blueprintId: "mythic-ember-spire",
      status: "completed",
      currentStage: 2,
      stageContributed: {},
      completedAt: "2026-09-05T00:00:00.000Z",
    };
    expect(overallProgressFraction(spire, completed)).toBe(1);
  });

  it("counts a fully-met current stage as 1/3, not the fraction of one item", () => {
    const state: ConstructionState = {
      blueprintId: "mythic-ember-spire",
      status: "in_progress",
      currentStage: 1,
      stageContributed: {},
      completedAt: null,
    };
    // Two stages fully behind currentStage=1 would be 2/3, but currentStage
    // counts stages BEFORE it as complete, so an empty stage 1 alone is 1/3.
    expect(overallProgressFraction(spire, state)).toBeCloseTo(1 / 3);
  });

  it("adds the in-progress stage's own fraction on top of completed stages", () => {
    const state: ConstructionState = {
      blueprintId: "mythic-ember-spire",
      status: "in_progress",
      currentStage: 1,
      stageContributed: { flour: 15, cheese: 4 }, // flour line met, half of cheese's 8
      completedAt: null,
    };
    // Stage 1 total required = 15 + 8 = 23; held = 15 + 4 = 19 -> 19/23.
    const expected = (1 + 19 / 23) / 3;
    expect(overallProgressFraction(spire, state)).toBeCloseTo(expected);
  });
});
