import { describe, expect, it } from "vitest";
import { CHAPTERS } from "./chapters";
import { emptyInventory, type StackAcresInventory } from "./inventory";
import { journalView, type JournalInput } from "./journal";
import { MACHINE_CATALOGUE, type MachineKind } from "./machines";
import {
  actionProgress,
  isActionable,
  missingRequirements,
  missingSummary,
  nextAction,
  type NextAction,
} from "./next-action";
import { STACKACRES_QUEST_LABELS } from "./shop-locks";
import { stackacresStockPrice } from "./market";
import type { StackAcresContractRow } from "./contracts";
import type { StackAcresStoryView } from "./story/state";
import { TRAVELER_IDS } from "./story/travelers";
import type { StackAcresStock } from "./catalogue";
import type { StackAcresUnitSnapshot, StackAcresUnitState } from "./units";

/* Same fixtures ./journal.test.ts uses, so a farm described here means the
   same thing it does there. */

const FRESH: JournalInput = {
  gold: 0,
  inventory: emptyInventory(),
  built: new Set<MachineKind>(),
  units: [],
  contract: null,
  vat: null,
  cellar: null,
  story: null,
  farmBoard: null,
  progress: { sectors: [], influence: 0, greenhouseBuilt: false, cropFieldsUnlocked: false },
  machines: [],
  woodNodes: [],
  stoneNodes: [],
  forageNodes: [],
  seedStock: {},
  nowMs: Date.parse("2026-09-21T12:00:00.000Z"),
};

/** A farm with a crop already in the ground. A truly empty one is `FRESH` itself, which is where the
 *  seed cues live (Ray's pouch, then Cora). */
const farm = (patch: Partial<JournalInput> = {}): JournalInput => ({ ...FRESH, units: [unit("working")], ...patch });

/** The whole derivation, exactly the way the panel gets it. */
const plan = (patch: Partial<JournalInput> = {}): NextAction | null => {
  const input = farm(patch);
  return nextAction(input, journalView(input));
};

/** Non-null, for the tests that are about the objective's contents. */
const planned = (patch: Partial<JournalInput> = {}): NextAction => {
  const action = plan(patch);
  expect(action).not.toBeNull();
  return action as NextAction;
};

const holding = (item: string, quantity: number): StackAcresInventory => ({ [item]: quantity });

const unit = (state: StackAcresUnitState, stock: StackAcresStock = "wheat"): StackAcresUnitSnapshot => ({
  id: `u-${state}-${stock}`,
  state,
  stock,
  stake: 0,
  yieldQuantity: 1,
  startedAt: "2026-09-21T00:00:00.000Z",
  readyAt: "2026-09-21T00:05:00.000Z",
  progress: 1,
  hungryAt: null,
  thirstyAt: null,
  isWatered: true,
  seed: false,
  soilSlot: null,
  muckFee: null,
  permanent: false,
  housedIn: null,
});

const order = (item: StackAcresContractRow["item"], quantity: number): StackAcresContractRow => ({
  id: "c1",
  item,
  quantity,
  goldReward: 42,
  influenceReward: 10,
  status: "open",
  createdAt: "2026-09-21T00:00:00.000Z",
});

const ALL_BUILT = new Set<MachineKind>(CHAPTERS.flatMap((chapter) => chapter.steps));

/** Every traveler locked except the ones named, none of them met. */
const storyWith = (unlocked: readonly string[], patch: Record<string, unknown> = {}): StackAcresStoryView =>
  ({
    level: 1,
    items: [],
    travelers: Object.fromEntries(
      TRAVELER_IDS.map((id) => [
        id,
        {
          unlocked: unlocked.includes(id),
          hint: null,
          met: false,
          done: false,
          quest: null,
          ready: false,
          questBlocked: false,
          ...(unlocked.includes(id) ? patch : {}),
        },
      ]),
    ),
  }) as unknown as StackAcresStoryView;

/* ------------------------------------------------------------------ */

describe("picking the objective", () => {
  it("tells a farmer with an empty can and a dry bed to fill the can first", () => {
    const action = planned({ units: [unit("dry")], water: 0 });
    expect(action.cue).toBe("water");
    expect(action.title).toBe("Fill your can at the well");
  });

  it("tells a brand new farm to plant its wheat, with no button because it happens on the map", () => {
    const action = planned({ units: [], seedStock: { wheat: 12 } });
    expect(action.cue).toBe("sow");
    expect(action.title).toBe("Plant your wheat");
    expect(action.button).toBeNull();
  });

  it("says seed rather than wheat when the seed held is something else", () => {
    expect(planned({ units: [], seedStock: { carrot: 3 } }).title).toBe("Plant your seed");
  });

  it("sends a farm out of seed to Cora, with a button to the city", () => {
    const action = planned({ units: [], seedStock: {} });
    expect(action.cue).toBe("seeds");
    expect(action.title).toContain("Cora");
    expect(action.button?.target).toEqual({ kind: "travel", place: "city" });
  });

  it("points a brand new farm at chapter 1's Mill, and says why it matters", () => {
    const action = planned();
    expect(action.cue).toBe("gather");
    expect(action.title).toBe("Build the Mill");
    // Straight off CHAPTERS[0].blurb and seedsOpenedLine("mill"), not authored
    // here -- if either is retuned this assertion is what notices.
    expect(action.why).toContain(CHAPTERS[0].blurb);
    expect(action.why).toContain("Corn");
    expect(action.button).toEqual({ label: "Open Workshop", target: { kind: "workshop" } });
  });

  it("sends a building that goes up in the kitchen to the kitchen, not the Workshop", () => {
    // The Mill is up, so chapter 1's second step is the Oven -- a House build.
    const action = planned({ built: new Set<MachineKind>(["mill"]) });
    expect(action.title).toBe("Build the Oven");
    expect(action.button).toEqual({ label: "Open your kitchen", target: { kind: "house" } });
  });

  it("puts a fillable town order above the next building", () => {
    const action = planned({
      built: new Set<MachineKind>(["mill"]),
      contract: order("flour", 2),
      inventory: holding("flour", 2),
      gold: 500,
    });
    expect(action.cue).toBe("contract");
    expect(action.title).toContain("2 Flour");
    expect(action.button).toEqual({ label: "Open Town Board", target: { kind: "contracts" } });
    expect(action.why).toContain("42 Gold");
    expect(action.why).toContain("10 Town Influence");
  });

  it("puts a hungry animal above everything, and gives it no button", () => {
    const action = planned({
      units: [unit("hungry", "hen"), unit("ready")],
      gold: 200,
      inventory: holding("wood", 15),
    });
    expect(action.cue).toBe("hungry");
    // Feeding happens on the animal in front of you; there is no screen for
    // it, so the panel offers no door rather than a door to somewhere else.
    expect(action.button).toBeNull();
  });

  it("falls through to the next reachable milestone once every building is up", () => {
    const action = planned({ built: ALL_BUILT });
    expect(action.cue).toBe("reach");
    expect(action.title).toBe(STACKACRES_QUEST_LABELS.crop_fields_unlocked);
    expect(action.button).toEqual({
      label: "Go to the Crop Fields",
      target: { kind: "travel", place: "cropfields" },
    });
  });

  it("quotes the first acre as the Crop Fields' price", () => {
    const action = planned({
      built: ALL_BUILT,
      gold: 300,
      inventory: holding("wood", 15),
      acrePrice: { gold: 300, wood: 15, stone: 5 },
    });
    expect(action.title).toBe(STACKACRES_QUEST_LABELS.crop_fields_unlocked);
    expect(action.requirements).toEqual([
      { label: "Stone", have: 0, need: 5, source: "Break the boulders in the Crop Fields" },
      { label: "Gold", have: 300, need: 300, source: null },
      { label: "Wood", have: 15, need: 15, source: null },
    ]);
  });

  it("shows nothing at all on a farm with nothing pressing", () => {
    expect(
      plan({
        built: ALL_BUILT,
        progress: {
          sectors: ["wallow", "oxfields"],
          influence: 10,
          greenhouseBuilt: true,
          cropFieldsUnlocked: true,
        },
      }),
    ).toBeNull();
  });

  it("never invents an objective the Journal did not choose", () => {
    // Every rung the panel can show is a rung the Journal's own ladder
    // produced, so the two can never name different work.
    for (const patch of [
      {},
      { gold: 200, inventory: holding("wood", 15) },
      { units: [unit("dry")] },
      { units: [unit("ready")] },
      { built: ALL_BUILT },
      { contract: order("flour", 2), inventory: holding("flour", 2), built: new Set<MachineKind>(["mill"]) },
    ] as Partial<JournalInput>[]) {
      const input = farm(patch);
      const view = journalView(input);
      const action = nextAction(input, view);
      if (action === null) expect(view.now.kind).toBe("idle");
      else expect(action.cue).toBe(view.now.kind);
    }
  });
});

describe("what is missing, and where it comes from", () => {
  it("reads the Mill's price straight off the machine catalogue", () => {
    const action = planned();
    const gold = action.requirements.find((requirement) => requirement.label === "Gold");
    const wood = action.requirements.find((requirement) => requirement.label === "Wood");
    expect(gold).toMatchObject({ have: 0, need: MACHINE_CATALOGUE.mill.placeCost });
    expect(wood).toMatchObject({ have: 0, need: MACHINE_CATALOGUE.mill.materials?.[0].quantity });
  });

  it("counts only the shortfall, and names where the short thing comes from", () => {
    const action = planned({ gold: 200, inventory: holding("wood", 7) });
    expect(missingSummary(action)).toBe("8 Wood");
    const missing = missingRequirements(action);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ label: "Wood", have: 7, need: 15 });
    expect(missing[0].source).toContain("Chop the trees");
  });

  it("drops the source line off a requirement that is already met", () => {
    const met = planned({ gold: 200, inventory: holding("wood", 7) }).requirements.filter(
      (requirement) => requirement.have >= requirement.need,
    );
    expect(met).not.toHaveLength(0);
    for (const requirement of met) expect(requirement.source).toBeNull();
  });

  it("puts the worst shortfall first, so the panel leads with the real blocker", () => {
    // 180 of 200 Gold (90%) against 0 of 15 Wood (0%).
    const action = planned({ gold: 180 });
    expect(action.requirements[0].label).toBe("Wood");
  });

  it("measures progress by the worst line, never the average", () => {
    // All the Gold and none of the Wood is stuck on the Wood, not half done.
    expect(actionProgress(planned({ gold: 200 }))).toBe(0);
    expect(actionProgress(planned({ gold: 100, inventory: holding("wood", 15) }))).toBe(0.5);
    expect(isActionable(planned({ gold: 200, inventory: holding("wood", 15) }))).toBe(true);
  });

  it("has nothing missing, and no meter to fill, on an objective that only needs doing", () => {
    const action = planned({ built: ALL_BUILT });
    expect(action.requirements).toEqual([]);
    expect(missingSummary(action)).toBeNull();
    expect(isActionable(action)).toBe(true);
    expect(actionProgress(action)).toBe(1);
  });

  it("leaves a part-filled town order alone rather than half-recommending it", () => {
    // The Journal only raises `contract` when the order can actually be
    // filled, so three of eight Flour is not the objective -- the farm's own
    // next building still is, and the panel says so rather than telling the
    // player to go and deliver goods they do not have.
    const action = planned({
      built: new Set<MachineKind>(["mill"]),
      contract: order("flour", 8),
      inventory: holding("flour", 3),
      gold: 500,
    });
    expect(action.cue).not.toBe("contract");
    expect(action.title).toBe("Build the Oven");
  });
});

describe("advancing when the objective is done", () => {
  it("moves to the next building the moment the first one is up", () => {
    const before = planned();
    expect(before.title).toBe("Build the Mill");
    const after = planned({ built: new Set<MachineKind>(["mill"]) });
    expect(after.title).toBe("Build the Oven");
    // A different objective, and the id says so, which is what lets the panel
    // tell "the bar moved" from "this is new work".
    expect(after.id).not.toBe(before.id);
  });

  it("keeps the same id while only the progress moves", () => {
    const empty = planned({ gold: 200 });
    const partway = planned({ gold: 200, inventory: holding("wood", 7) });
    expect(partway.id).toBe(empty.id);
    expect(actionProgress(partway)).toBeGreaterThan(actionProgress(empty));
  });

  it("drops the order objective once the order is delivered", () => {
    const withOrder = planned({
      built: new Set<MachineKind>(["mill"]),
      contract: order("flour", 2),
      inventory: holding("flour", 2),
      gold: 500,
    });
    expect(withOrder.cue).toBe("contract");
    const settled = planned({ built: new Set<MachineKind>(["mill"]), contract: null, gold: 500 });
    expect(settled.cue).not.toBe("contract");
    expect(settled.title).toBe("Build the Oven");
  });

  it("stops recommending anything once every ladder is finished", () => {
    const done = plan({
      built: ALL_BUILT,
      progress: {
        sectors: ["wallow", "oxfields"],
        influence: 10,
        greenhouseBuilt: true,
        cropFieldsUnlocked: true,
      },
    });
    expect(done).toBeNull();
  });
});

describe("locked content", () => {
  it("points at the sheep once the two first milestones are done", () => {
    // Sheep are sold in the Store, so the Fold is the next rung and the panel
    // quotes the pen's price.
    const action = planned({
      built: ALL_BUILT,
      gold: 0,
      progress: { sectors: [], influence: 1, greenhouseBuilt: false, cropFieldsUnlocked: true },
    });
    expect(action.title).toBe(STACKACRES_QUEST_LABELS.cleared_wallow);
    expect(action.requirements).toEqual([
      { label: "Gold", have: 0, need: stackacresStockPrice("pig"), source: "Sell crops at the barn" },
    ]);
  });

  it("never names a traveler who will not talk yet", () => {
    // Pierre is milestone-gated, so on a fresh farm he is locked. With every
    // building up and Ray locked out too, there is no caller to name.
    const action = planned({ built: ALL_BUILT, story: storyWith([]) });
    expect(action.cue).toBe("reach");
  });

  it("names the unlocked traveler nobody has spoken to yet, ahead of the next building", () => {
    const story = storyWith(["ray"]);
    // The people teach the game, so a traveler waiting to be met leads the building.
    expect(planned({ story }).cue).toBe("caller");
    const action = planned({ built: ALL_BUILT, story });
    expect(action.cue).toBe("caller");
    expect(action.title).toBe("Talk to Ray");
    expect(action.button).toBeNull();
  });

  it("names the quest a traveler is holding, with its own objective counts", () => {
    const story = storyWith(["ray"], {
      met: true,
      ready: true,
      quest: {
        index: 0,
        total: 3,
        title: "First Furrows",
        objectives: [{ label: "Water 3 crops", have: 3, need: 3 }],
      },
    });
    const action = planned({ built: ALL_BUILT, story });
    expect(action.cue).toBe("caller");
    expect(action.title).toBe('Take "First Furrows" back to Ray');
    expect(action.requirements).toEqual([
      { label: "Water 3 crops", have: 3, need: 3, source: null },
    ]);
    expect(isActionable(action)).toBe(true);
  });

  it("only ever sends the player to a door the farm actually has", () => {
    const targets = new Set<string>();
    for (const patch of [
      {},
      { built: new Set<MachineKind>(["mill"]) },
      { built: ALL_BUILT },
      { built: ALL_BUILT, story: storyWith(["ray"]) },
      { contract: order("flour", 2), inventory: holding("flour", 2), built: new Set<MachineKind>(["mill"]) },
      { units: [unit("dry")] },
      { units: [unit("hungry", "hen")] },
    ] as Partial<JournalInput>[]) {
      const action = plan(patch);
      if (action?.button) targets.add(action.button.target.kind);
    }
    for (const kind of targets) {
      expect(["workshop", "house", "contracts", "travel"]).toContain(kind);
    }
  });
});
