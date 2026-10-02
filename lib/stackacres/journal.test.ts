import { describe, expect, it } from "vitest";
import { stackacresStockPrice } from "./market";
import {
  journalCue,
  journalView,
  journalChapterLabel,
  type JournalCueKind,
  type JournalInput,
} from "./journal";
import { CHAPTERS } from "./chapters";
import { emptyInventory, type StackAcresInventory } from "./inventory";
import type { MachineKind } from "./machines";
import { STACKACRES_QUEST_FLAGS } from "./shop-locks";
import type { StackAcresUnitSnapshot } from "./units";
import type { StackAcresStock } from "./catalogue";
import type { StackAcresUnitState } from "./units";
import type { VatContainer } from "./aging";
import type { StackAcresContractRow } from "./contracts";
import type { StackAcresStoryView } from "./story/state";
import { TRAVELER_IDS } from "./story/travelers";

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

const container = (status: VatContainer["status"]): VatContainer => ({
  machineId: "m1",
  status,
  manifest: null,
  currentTier: null,
  nextTier: null,
  msUntilNextTier: null,
  collectibleGoldValue: 0,
  maxGoldValue: 0,
});

const order = (item: StackAcresContractRow["item"], quantity: number): StackAcresContractRow => ({
  id: "c1",
  item,
  quantity,
  goldReward: 140,
  influenceReward: 10,
  status: "open",
  createdAt: "2026-09-21T00:00:00.000Z",
});

const holding = (item: string, quantity: number): StackAcresInventory => ({ [item]: quantity });

const cueFor = (patch: Partial<JournalInput>): JournalCueKind => journalView(farm(patch)).now.kind;

describe("the one line", () => {
  it("tells a farm with seed and nothing planted to sow first, before any building", () => {
    const cue = journalView(farm({ units: [], seedStock: { wheat: 12 } })).now;
    expect(cue.kind).toBe("sow");
    expect(cue.line).toContain("sow");
  });

  it("sends a farm with nothing planted and no seed to Cora in the city", () => {
    const cue = journalView(farm({ units: [], seedStock: {} })).now;
    expect(cue.kind).toBe("seeds");
    expect(cue.line).toContain("Cora");
    expect(cue.where).toBe("The City");
  });

  it("points at the next building rather than at Cora while there is wheat to mill", () => {
    const cue = journalView(farm({ units: [], seedStock: {}, inventory: holding("wheat", 20) })).now;
    expect(cue.kind).not.toBe("seeds");
  });

  it("stops asking for seed once a crop is in the ground", () => {
    const cue = journalView(farm({ seedStock: { wheat: 12 } })).now;
    expect(cue.kind).not.toBe("sow");
    expect(cue.kind).not.toBe("seeds");
  });

  it("points a farm with a crop planted at its first building, and says where the Wood comes from", () => {
    const cue = journalView(farm()).now;
    expect(cue.kind).toBe("gather");
    expect(cue.line).toContain("Feed Grinder");
    expect(cue.line).toContain("Wood");
    expect(cue.line).toContain("Chop the trees");
  });

  it("says the building can go up, and where, once everything is in hand", () => {
    const cue = journalView(farm({ gold: 200, inventory: holding("wood", 15) })).now;
    expect(cue.kind).toBe("build");
    expect(cue.where).toBe("Workshop");
  });

  it("names the Gold shortfall for a building that asks for no materials", () => {
    const cue = journalView(farm({ built: new Set<MachineKind>(["mill"]), gold: 100 })).now;
    expect(cue.kind).toBe("gather");
    expect(cue.line).toContain("Oven");
    expect(cue.line).toContain("400 Gold");
  });

  // The whole point of the ladder: what finished while the player was away
  // sorts above what would merely be a good idea next.
  it("puts hungry animals above everything", () => {
    expect(
      cueFor({
        units: [unit("hungry", "hen"), unit("ready")],
        cellar: container("collectible"),
        gold: 200,
        inventory: holding("wood", 15),
      }),
    ).toBe("hungry");
  });

  it("counts a finished machine run as something to collect, and says where", () => {
    const mill = {
      id: "m1",
      kind: "mill" as const,
      status: "working" as const,
      startedAt: "2026-09-21T11:00:00.000Z",
      readyAt: "2026-09-21T11:30:00.000Z",
      recipeId: null,
      unitsProcessing: 1,
      done: true,
      progress: 1,
      autoFeedsLeft: null,
      standingRecipe: null,
      kitchenSince: null,
    };
    const view = journalView(farm({ machines: [mill] }));
    expect(view.now.kind).toBe("collect");
    expect(view.now.where).toBe("Workshop");
  });

  it("puts a finished cellar above a fillable order", () => {
    expect(
      cueFor({ cellar: container("collectible"), contract: order("flour", 2), inventory: holding("flour", 4) }),
    ).toBe("collect");
  });

  it("puts a fillable order above a ready harvest", () => {
    expect(cueFor({ contract: order("flour", 2), inventory: holding("flour", 2), units: [unit("ready")] })).toBe(
      "contract",
    );
  });

  it("stays quiet about an order that cannot be filled yet", () => {
    expect(cueFor({ contract: order("flour", 4), inventory: holding("flour", 3) })).not.toBe("contract");
  });

  it("says to fill the can when a bed is dry and the can is empty", () => {
    const cue = journalView(farm({ units: [unit("dry")], water: 0 })).now;
    expect(cue.kind).toBe("water");
    expect(cue.line).toContain("well");
  });

  it("counts the beds that have gone dry", () => {
    const cue = journalView(farm({ units: [unit("dry"), unit("dry", "carrot")], gold: 200, inventory: holding("wood", 15) })).now;
    expect(cue.kind).toBe("water");
    expect(cue.line).toContain("2 beds");
  });

  // The people are how the game teaches itself, so one waiting to be met comes before the next building.
  it("puts a waiting traveler ahead of the player's own next building", () => {
    const story = {
      level: 1,
      items: [],
      finale: { travelersHome: 0, travelersNeeded: 10, leoUnlocked: false },
      travelers: Object.fromEntries(
        TRAVELER_IDS.map((id) => [
          id,
          { unlocked: id === "ray", hint: null, met: false, done: false, quest: null, ready: false },
        ]),
      ),
    } as unknown as StackAcresStoryView;
    expect(cueFor({ story })).toBe("caller");
    expect(cueFor({ story, gold: 200, inventory: holding("wood", 15) })).toBe("caller");
    expect(cueFor({ story, built: new Set(CHAPTERS.flatMap((chapter) => chapter.steps)) })).toBe("caller");
    // Once Ray has been met and has a quest still running, the building leads again.
    const met = {
      ...story,
      travelers: { ...story.travelers, ray: { ...story.travelers.ray, met: true, quest: { index: 0, total: 3, title: "First Furrows", objectives: [] } } },
    } as unknown as StackAcresStoryView;
    expect(cueFor({ story: met })).toBe("gather");
    expect(journalView(farm({ story })).callers).toEqual([
      { traveler: "ray", name: "Ray", state: "waiting", detail: null },
    ]);
  });

  it("falls back to the next milestone when the buildings are all up", () => {
    const cue = journalView(farm({ built: new Set(CHAPTERS.flatMap((chapter) => chapter.steps)) })).now;
    expect(cue.kind).toBe("reach");
    expect(cue.line).toContain("Break ground in the Crop Fields");
  });

  it("has nothing to say on a finished farm", () => {
    expect(
      cueFor({
        built: new Set(CHAPTERS.flatMap((chapter) => chapter.steps)),
        progress: {
          sectors: ["wallow", "oxfields"],
          influence: 10,
          greenhouseBuilt: true,
          cropFieldsUnlocked: true,
        },
      }),
    ).toBe("idle");
  });

  it("never uses an em-dash, whichever rung answers", () => {
    const farms: Partial<JournalInput>[] = [
      {},
      { units: [unit("hungry", "hen")] },
      { cellar: container("collectible") },
      { vat: container("collectible") },
      { contract: order("flour", 2), inventory: holding("flour", 2) },
      { units: [unit("ready")] },
      { units: [unit("dry")] },
      { gold: 200, inventory: holding("wood", 15) },
      { built: new Set(CHAPTERS.flatMap((chapter) => chapter.steps)) },
    ];
    for (const patch of farms) expect(journalView(farm(patch)).now.line).not.toMatch(/[—–]/);
  });

  it("always answers with a rung on the ladder", () => {
    expect(() => journalCue(FRESH, journalView(FRESH).chapters)).not.toThrow();
  });

  // The chip is one nowrap line, so it takes the first sentence and the sheet
  // keeps the rest. A one-sentence cue is its own short form.
  it("gives the chip the first sentence and the sheet the whole line", () => {
    const gather = journalView(farm()).now;
    expect(gather.line).toBe("The Feed Grinder still wants 15 more Wood. Chop the trees around the farm.");
    expect(gather.short).toBe("The Feed Grinder still wants 15 more Wood.");
    const build = journalView(farm({ gold: 200, inventory: holding("wood", 15) })).now;
    expect(build.short).toBe(build.line);
  });
});

describe("what filled up while you were away", () => {
  const nodes = (ready: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ ready: i < ready }));

  it("says nothing at all on a farm with nothing to come back to", () => {
    expect(journalView(FRESH).waiting).toEqual([]);
  });

  it("counts the trees and the bushes that have grown back, and shows no Mine", () => {
    const view = journalView(
      farm({ woodNodes: nodes(3, 4), forageNodes: nodes(0, 4), stoneNodes: nodes(1, 3) }),
    );
    expect(view.waiting.map((row) => [row.key, row.detail, row.ready])).toEqual([
      ["trees", "3 of 4 ready", true],
      ["bushes", "0 of 4 ready", false],
    ]);
    expect(view.waiting[0].fill).toBeCloseTo(0.75);
  });

  it("gives each room one row: what is running in it, and what is finished", () => {
    const mill = {
      id: "m1",
      kind: "mill" as const,
      status: "working" as const,
      startedAt: "2026-09-21T11:00:00.000Z",
      readyAt: "2026-09-21T11:30:00.000Z",
      recipeId: null,
      unitsProcessing: 1,
      done: true,
      progress: 1,
      autoFeedsLeft: null,
      standingRecipe: null,
      kitchenSince: null,
    };
    const [finished] = journalView(farm({ machines: [mill] })).waiting;
    expect(finished).toMatchObject({ label: "The Workshop", detail: "1 finished, waiting to be taken", ready: true });

    const still = { ...mill, readyAt: "2026-09-21T13:00:00.000Z", done: false };
    expect(journalView(farm({ machines: [still] })).waiting[0]).toMatchObject({
      detail: "1 still running",
      ready: false,
    });
  });

  it("shows the cellar filling, then ready", () => {
    const aging = { ...container("aging"), manifest: { item: "pickles", quantity: 9 } } as unknown as VatContainer;
    const [row] = journalView(farm({ cellar: aging })).waiting;
    expect(row.detail).toBe("9 of 12 jars aging");
    expect(row.ready).toBe(false);
    expect(row.fill).toBeCloseTo(0.75);

    const done = { ...aging, status: "collectible" } as VatContainer;
    expect(journalView(farm({ cellar: done })).waiting[0]).toMatchObject({
      detail: "9 jars, ready to open",
      ready: true,
    });
  });

  it("leads the pens with hunger, because hunger is a loss and a harvest is not", () => {
    const hungry = journalView(farm({ units: [unit("hungry", "hen"), unit("ready", "hen")] })).waiting;
    expect(hungry.at(-1)).toMatchObject({ key: "animals", detail: "1 hungry", ready: true });
    const calm = journalView(farm({ units: [unit("ready", "hen"), unit("working", "hen")] })).waiting;
    expect(calm.at(-1)).toMatchObject({ detail: "1 ready to collect", ready: true });
  });

  it("counts a crop as neither an animal nor a gatherable", () => {
    expect(journalView(farm({ units: [unit("ready", "wheat")] })).waiting).toEqual([]);
  });
});

describe("the production track", () => {
  it("shows every chapter, with exactly one current until they are all done", () => {
    const view = journalView(FRESH);
    expect(view.chapters).toHaveLength(CHAPTERS.length);
    expect(view.chapters.filter((chapter) => chapter.current)).toHaveLength(1);
    expect(view.currentChapter?.number).toBe(1);
    expect(journalChapterLabel(view)).toBe("Chapter 1 · Bread");
  });

  it("has no current chapter, and a full bar, once every building is up", () => {
    const view = journalView(farm({ built: new Set(CHAPTERS.flatMap((chapter) => chapter.steps)) }));
    expect(view.currentChapter).toBeNull();
    expect(journalChapterLabel(view)).toBeNull();
    expect(view.readiness).toBe(1);
  });

  it("carries where each building goes up and what it opens", () => {
    const mill = journalView(FRESH).chapters[0].steps[0];
    expect(mill.place).toBe("Workshop");
    expect(mill.opens).toContain("Corn");
    const oven = journalView(FRESH).chapters[0].steps[1];
    expect(oven.place).toBe("House");
  });

  // A farm with the Gold and none of the Wood is not nearly done.
  it("measures readiness by the line furthest behind, not by Gold alone", () => {
    expect(journalView(farm({ gold: 200 })).readiness).toBe(0);
    expect(journalView(farm({ gold: 100, inventory: holding("wood", 15) })).readiness).toBeCloseTo(0.5);
  });
});

describe("the expansion track", () => {
  it("starts at Standing 1 of 6 with all five flags open", () => {
    const view = journalView(FRESH);
    expect(view.standing).toBe(1);
    expect(view.standingMax).toBe(6);
    expect(view.reach).toHaveLength(STACKACRES_QUEST_FLAGS.length);
    expect(view.reach.every((step) => !step.done)).toBe(true);
  });

  it("ticks a flag off the farm has already earned, and raises Standing", () => {
    const view = journalView(farm({ progress: { ...FRESH.progress, influence: 10 } }));
    expect(view.standing).toBe(2);
    expect(view.reach.find((step) => step.flag === "town_trusted")?.done).toBe(true);
  });

  it("prices every rung that is bought", () => {
    const view = journalView({ ...FRESH, acrePrice: { gold: 300, wood: 15, stone: 5 } });
    const cost = (flag: string) => view.reach.find((step) => step.flag === flag)?.cost;
    // The first wild bed needs a bought acre, so the acre is the Crop Fields' price.
    expect(cost("crop_fields_unlocked")).toBe("300 Gold + 15 Wood + 5 Stone");
    // The first sheep or cow opens its district.
    expect(cost("cleared_wallow")).toBe(`${stackacresStockPrice("pig").toLocaleString()} Gold`);
    expect(cost("cleared_oxfields")).toBe(`${stackacresStockPrice("cattle").toLocaleString()} Gold`);
    // The other two are acts, not purchases.
    expect(cost("town_trusted")).toBeNull();
    expect(cost("greenhouse_raised")).toBeNull();
  });

  it("shows no acre price once every acre is owned", () => {
    const view = journalView({ ...FRESH, acrePrice: null });
    expect(view.reach.find((step) => step.flag === "crop_fields_unlocked")?.cost).toBeNull();
  });

  it("names the travelers pinned to a particular flag on that flag", () => {
    // No remaining traveler (Ray, Pierre, Ivy) unlocks on a named flag --
    // all three are milestone-gated (see ../story/travelers.ts). Knight
    // Arthur and Cowboy Wes, who were, left with the six districts
    // (../story/travelers.ts's own header), so every flag's `brings` is
    // empty rather than naming someone.
    const view = journalView(FRESH);
    for (const step of view.reach) expect(step.brings, step.flag).toEqual([]);
  });

  it("says what one more flag opens, whichever flag it turns out to be", () => {
    expect(journalView(FRESH).nextMilestoneOpens).toContain("Chef Pierre");
  });

  it("promises nothing once every flag is earned", () => {
    const view = journalView(
      farm({
        progress: { sectors: ["wallow", "oxfields"], influence: 10, greenhouseBuilt: true, cropFieldsUnlocked: true },
      }),
    );
    expect(view.standing).toBe(6);
    expect(view.nextMilestoneOpens).toEqual([]);
  });

  it("lists no callers before a snapshot has landed", () => {
    expect(journalView(FRESH).callers).toEqual([]);
  });
});
