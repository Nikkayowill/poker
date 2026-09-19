import { describe, expect, it } from "vitest";
import { CHAPTERS, chapterFinishedBy, chapterViews, currentChapter, limitingNeed, nextStep, stepReadiness } from "./chapters";
import { MACHINE_CATALOGUE, type MachineKind } from "./machines";

const built = (...kinds: MachineKind[]) => new Set(kinds);
const stock = (gold: number, inventory: Record<string, number> = {}) => ({ gold, inventory });

describe("the chapters", () => {
  it("only ask for buildings that exist", () => {
    for (const chapter of CHAPTERS) for (const kind of chapter.steps) expect(MACHINE_CATALOGUE[kind]).toBeDefined();
  });

  it("are numbered 1 to 6 with no building in two of them", () => {
    expect(CHAPTERS.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6]);
    const all = CHAPTERS.flatMap((c) => c.steps);
    expect(new Set(all).size).toBe(all.length);
  });

  it("never use an em-dash in what Ray says", () => {
    for (const chapter of CHAPTERS) expect(chapter.doneLine).not.toMatch(/[—–]/);
  });
});

describe("chapterViews", () => {
  it("starts a new farm on chapter 1 with the Mill next", () => {
    const views = chapterViews(built(), stock(0));
    const current = currentChapter(views);
    expect(current?.chapter.number).toBe(1);
    expect(nextStep(current!)?.kind).toBe("mill");
  });

  it("moves on to the Oven once the Mill is built", () => {
    const current = currentChapter(chapterViews(built("mill"), stock(0)))!;
    expect(current.chapter.number).toBe(1);
    expect(nextStep(current)?.kind).toBe("oven");
  });

  it("finishes a chapter when every building in it is built", () => {
    const views = chapterViews(built("mill", "oven"), stock(0));
    expect(views[0].done).toBe(true);
    expect(currentChapter(views)?.chapter.number).toBe(2);
  });

  it("has no current chapter once all six are done", () => {
    const all = new Set(CHAPTERS.flatMap((c) => c.steps));
    expect(currentChapter(chapterViews(all, stock(0)))).toBeNull();
  });

  it("keeps the current chapter on the first unfinished one when they are built out of order", () => {
    const views = chapterViews(built("counter"), stock(0));
    expect(views[2].done).toBe(true);
    expect(currentChapter(views)?.chapter.number).toBe(1);
  });
});

describe("what a building still needs", () => {
  it("counts Gold and materials, capped at the price", () => {
    const [mill] = chapterViews(built(), stock(5000, { wood: 4 }))[0].steps;
    expect(mill.needs).toEqual([
      { label: "Gold", have: 200, need: 200 },
      { label: "Wood", have: 4, need: 15 },
    ]);
  });

  it("names the need furthest from done", () => {
    const [mill] = chapterViews(built(), stock(5000, { wood: 4 }))[0].steps;
    expect(limitingNeed(mill).label).toBe("Wood");
    const [poor] = chapterViews(built(), stock(50, { wood: 15 }))[0].steps;
    expect(limitingNeed(poor).label).toBe("Gold");
  });

  it("reads 1 when the player can afford it", () => {
    const [mill] = chapterViews(built(), stock(200, { wood: 15 }))[0].steps;
    expect(stepReadiness(mill)).toBe(1);
  });

  it("reads a fraction while they are short", () => {
    const [oven] = chapterViews(built("mill"), stock(250))[0].steps.slice(1);
    expect(stepReadiness(oven)).toBeCloseTo(0.5);
  });
});

describe("chapterFinishedBy", () => {
  it("names the chapter a building completes", () => {
    expect(chapterFinishedBy("oven", built("mill", "oven"))?.number).toBe(1);
    expect(chapterFinishedBy("stew_pot", built("stew_pot"))?.number).toBe(2);
  });

  it("is null while the chapter still has a building to go", () => {
    expect(chapterFinishedBy("mill", built("mill"))).toBeNull();
    expect(chapterFinishedBy("oven", built("oven"))).toBeNull();
  });

  it("is null for a building that belongs to no chapter", () => {
    expect(chapterFinishedBy("dairy", built("dairy"))).toBeNull();
  });
});
