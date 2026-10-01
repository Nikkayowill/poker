import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BARN_CREW, BARN_STARTING_CREW, type FarmHand } from "./barn-cast";
import { BARN_TUNING, Barnsite, barnGrid, barnLayout, type BarnArea, type BarnsiteEvent, type BarnsiteTuning } from "./barnsite";
import type { FarmJob } from "./work-board";
import type { Worker } from "./work-crew";

/**
 * A small farm, 30 by 36: the barn top left with the well and the muck heap beside it, the stock hands' and
 * dairy's posts in the yard in front, the coop, the sheep pen and the cattle pen in a row below (each gated at
 * the top), a row of wheat and a row of corn below the coop with a path under each, the field hands' posts
 * beside them, and at the bottom the pig sty on the left and on the right a stable of two stalls facing the
 * paddock gate.
 */
function farm(): BarnArea {
  const W = 30;
  const H = 36;
  const blocked: [number, number][] = [];
  const zones: BarnArea["zones"] = [];
  const block = (x0: number, y0: number, x1 = x0, y1 = y0) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked.push([x, y]);
  };
  const zone = (tag: string, tx: number, ty: number, w = 1, h = 1) => zones.push({ tag, x: tx * 16, y: ty * 16, w: w * 16, h: h * 16 });
  const fence = (x0: number, y0: number, x1: number, y1: number, gate: [number, number]) => {
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (x !== gate[0] || y !== gate[1]) block(x, y);
    for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) if (x !== gate[0] || y !== gate[1]) block(x, y);
    zone(`gate:${gate.join("-")}`, gate[0], gate[1]);
  };
  // The edges.
  block(0, 0, W - 1, 0);
  block(0, H - 1, W - 1, H - 1);
  block(0, 1, 0, H - 2);
  block(W - 1, 1, W - 1, H - 2);
  // The barn, the well and the heap.
  block(1, 1, 8, 4);
  zone("barn:feed", 3, 5, 2, 1);
  zone("barn:dairy", 7, 5);
  block(12, 3);
  zone("well", 12, 4);
  block(16, 3);
  zone("heap", 16, 4);
  zone("post:hand", 2, 7, 4, 1);
  zone("post:dairy", 6, 7, 3, 1);
  zone("post", 5, 6, 3, 1);
  zone("break", 10, 7);
  // The coop: the henhouse in the top right corner of its run, the nest boxes reached from beside it.
  fence(1, 9, 8, 15, [4, 9]);
  zone("pen:coop", 2, 10, 6, 5);
  block(6, 10, 7, 10);
  zone("roost", 6, 11);
  zone("nest", 5, 10);
  block(2, 14, 3, 14);
  zone("eat:coop", 2, 13, 2, 1);
  zone("trough:coop:feed", 4, 14);
  block(6, 14, 7, 14);
  zone("drink:coop", 6, 13, 2, 1);
  zone("trough:coop:water", 5, 14);
  zone("muck:coop", 4, 12);
  // The sheep.
  fence(10, 9, 17, 15, [13, 9]);
  zone("pen:sheep", 11, 10, 6, 5);
  block(11, 14, 12, 14);
  zone("eat:sheep", 11, 13, 2, 1);
  zone("trough:sheep:feed", 13, 14);
  block(15, 14, 16, 14);
  zone("drink:sheep", 15, 13, 2, 1);
  zone("trough:sheep:water", 14, 14);
  zone("muck:sheep", 13, 11);
  // The cattle, with a milking stand in each top corner.
  fence(19, 9, 28, 17, [23, 9]);
  zone("pen:cattle", 20, 10, 8, 7);
  zone("stand:1", 20, 10);
  zone("stand:1:hand", 21, 10);
  zone("stand:2", 27, 10);
  zone("stand:2:hand", 26, 10);
  block(20, 16, 22, 16);
  zone("eat:cattle", 20, 15, 3, 1);
  zone("trough:cattle:feed", 23, 16);
  block(25, 16, 27, 16);
  zone("drink:cattle", 25, 15, 3, 1);
  zone("trough:cattle:water", 24, 16);
  zone("muck:cattle", 23, 12);
  // The field.
  zone("plot", 2, 19, 7, 1);
  zone("plot:corn", 2, 21, 7, 1);
  zone("post:field", 10, 20, 3, 1);
  // The sty: troughs up by the gate, the wallow and the beds at the back.
  fence(1, 24, 10, 32, [5, 24]);
  zone("pen:sty", 2, 25, 8, 7);
  block(2, 26, 3, 26);
  zone("trough:sty:feed", 2, 25);
  zone("eat:sty", 2, 27, 2, 1);
  block(7, 26, 8, 26);
  zone("trough:sty:water", 7, 25);
  zone("drink:sty", 7, 27, 2, 1);
  zone("wallow:sty", 3, 30, 2, 1);
  zone("bed:sty", 7, 31, 2, 1);
  zone("muck:sty", 5, 28);
  // The stable: two stalls and the feed room, the stable hands' posts beside it.
  block(12, 24, 17, 24);
  zone("stall:1", 12, 25);
  zone("stall:1:hand", 13, 25);
  zone("stall:2", 14, 25);
  zone("stall:2:hand", 15, 25);
  block(16, 25, 17, 25);
  zone("barn:feed", 17, 26);
  zone("post:stable", 18, 26, 2, 1);
  // The paddock, gated at the top, where the horses wait by the gate to be brought in.
  fence(12, 28, 28, 34, [14, 28]);
  zone("pen:paddock", 13, 29, 15, 5);
  zone("catch:1", 13, 30);
  zone("catch:1:hand", 13, 29);
  zone("catch:2", 15, 30);
  zone("catch:2:hand", 15, 29);
  block(18, 30, 19, 30);
  zone("trough:paddock:feed", 18, 29);
  zone("eat:paddock", 18, 31, 2, 1);
  block(22, 30, 23, 30);
  zone("trough:paddock:water", 22, 29);
  zone("drink:paddock", 22, 31, 2, 1);
  zone("muck:paddock", 25, 32);
  return { width: W, height: H, tile: 16, blocked, props: [], zones };
}

const AREA = farm();
const LAYOUT = barnLayout(AREA);
const GRID = barnGrid(AREA);
const DAY = { timeout: 90_000 };
const from = (hour: number) => (now: number) => (hour + now / 60_000) % 24;
/** A herd the small farm has room for. */
const SMALL: BarnsiteTuning = { ...BARN_TUNING, herd: { hen: 6, sheep: 4, cow: 3, pig: 2, horse: 2 } };

function site(options: { crew?: readonly FarmHand[]; seed?: number; hourAt?: (now: number) => number; tuning?: BarnsiteTuning } = {}) {
  const s = new Barnsite(LAYOUT, GRID, { seed: options.seed ?? 7, hourAt: options.hourAt ?? from(6), tuning: options.tuning ?? SMALL });
  for (const h of options.crew ?? BARN_CREW) s.hire(h.name, h.job, h.name, h.profile);
  return s;
}

function run(s: Barnsite, ms: number, each?: (events: BarnsiteEvent[]) => void): BarnsiteEvent[] {
  const all: BarnsiteEvent[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    const events = s.step(50);
    each?.(events);
    all.push(...events);
  }
  return all;
}
const count = (events: BarnsiteEvent[], kind: BarnsiteEvent["kind"]) => events.filter((e) => e.kind === kind).length;
const hours = (n: number) => n * 60_000;
const crewOf = (names: readonly string[]) => BARN_CREW.filter((h) => names.includes(h.name));

describe("the barnyard's layout", () => {
  it("reads the pens, troughs, stands and plots off the map's zones", () => {
    expect(LAYOUT.pens.map((p) => [p.id, p.kind])).toEqual([
      ["cattle", "cow"],
      ["coop", "hen"],
      ["paddock", "horse"],
      ["sheep", "sheep"],
      ["sty", "pig"],
    ]);
    const coop = LAYOUT.pens.find((p) => p.id === "coop")!;
    expect(coop.eat.map((s) => s.facing)).toEqual(["down", "down"]);
    expect(coop.feed).toMatchObject({ tx: 4, ty: 14, facing: "left" });
    // The animals never stand on a trough's or the nest's working square, or the hen door.
    expect(coop.ground.some((t) => t.tx === 5 && t.ty === 10)).toBe(false);
    expect(coop.ground.some((t) => t.tx === 6 && t.ty === 11)).toBe(false);
    expect(LAYOUT.stands).toHaveLength(2);
    expect(LAYOUT.stands[0].hand).toMatchObject({ tx: 21, ty: 10, facing: "left" });
    expect(LAYOUT.plots).toHaveLength(14);
    // Worked from the path below, looking up at the crop.
    expect(LAYOUT.plots[0].work).toMatchObject({ tx: 2, ty: 20, facing: "up" });
    // A bare plot is wheat; the tag names anything else.
    expect(LAYOUT.plots.filter((p) => p.crop === "wheat").map((p) => p.at.ty)).toEqual(Array(7).fill(19));
    expect(LAYOUT.plots.filter((p) => p.crop === "corn").map((p) => p.at.ty)).toEqual(Array(7).fill(21));
    expect([LAYOUT.jobPosts.hand.length, LAYOUT.jobPosts.dairy.length, LAYOUT.jobPosts.field.length, LAYOUT.jobPosts.stable.length, LAYOUT.posts.length]).toEqual([
      4, 3, 3, 2, 3,
    ]);
  });

  it("reads the stalls, the catch squares by the gate, the wallow and the beds", () => {
    expect(LAYOUT.stalls.map((s) => [s.horse.tx, s.horse.facing, s.hand.tx, s.hand.facing])).toEqual([
      [12, "down", 13, "left"],
      [14, "down", 15, "left"],
    ]);
    // A horse waits facing the hand who comes for her, and never wanders onto that hand's square.
    expect(LAYOUT.catches[0]).toMatchObject({ horse: { tx: 13, ty: 30, facing: "up" }, hand: { tx: 13, ty: 29, facing: "down" } });
    const paddock = LAYOUT.pens.find((p) => p.id === "paddock")!;
    expect(paddock.ground.some((t) => t.tx === 13 && (t.ty === 29 || t.ty === 30))).toBe(false);
    // A horse's troughs are fed from the pen side only; a pig's from its ends as well.
    expect(paddock.eat).toHaveLength(2);
    expect(LAYOUT.pens.find((p) => p.id === "sty")!.eat.length).toBeGreaterThan(2);
    const sty = LAYOUT.pens.find((p) => p.id === "sty")!;
    expect(sty.wallow.map((t) => t.tx)).toEqual([3, 4]);
    expect(sty.bed.map((t) => t.tx)).toEqual([7, 8]);
  });

  it("refuses horses with nowhere to be caught", () => {
    const area = farm();
    area.zones = area.zones.filter((z) => !z.tag.startsWith("catch:"));
    expect(() => barnLayout(area)).toThrow(/somewhere by the paddock gate/);
  });

  it("works a bed two rows deep from the furrows above and below it", () => {
    const area = farm();
    area.zones = area.zones.filter((z) => !z.tag.startsWith("plot"));
    area.zones.push({ tag: "plot:corn", x: 2 * 16, y: 19 * 16, w: 7 * 16, h: 2 * 16 });
    const plots = barnLayout(area).plots;
    expect(plots.filter((p) => p.at.ty === 19).every((p) => p.work.ty === 18 && p.work.facing === "down")).toBe(true);
    expect(plots.filter((p) => p.at.ty === 20).every((p) => p.work.ty === 21 && p.work.facing === "up")).toBe(true);
  });

  it("refuses a plot under something solid", () => {
    const area = farm();
    area.blocked.push([4, 19]);
    expect(() => barnLayout(area)).toThrow(/plot square at 4,19 is under something solid/);
  });

  it("refuses a map without a way to milk the cows", () => {
    const area = farm();
    area.zones = area.zones.filter((z) => !z.tag.startsWith("stand:"));
    expect(() => barnLayout(area)).toThrow(/milking stand/);
  });

  it("refuses a work square nobody can stand on", () => {
    const area = farm();
    area.zones = area.zones.map((z) => (z.tag === "nest" ? { ...z, x: 6 * 16 } : z));
    expect(() => barnLayout(area)).toThrow(/nest square at 6,10 is under something solid/);
  });
});

describe("the crew", () => {
  it("wait at their own job's posts, and at a spare one once those are taken", () => {
    const s = site({ crew: [] });
    const extra = { ...BARN_CREW[0], name: "spare" };
    for (const h of [...BARN_CREW, extra]) s.hire(h.name, h.job, h.name, h.profile);
    const at = new Map(s.view().workers.map((w) => [w.id, w.tile]));
    for (const h of BARN_CREW) expect(LAYOUT.jobPosts[h.job].some((p) => p.tx === at.get(h.name)!.tx && p.ty === at.get(h.name)!.ty), h.name).toBe(true);
    expect(LAYOUT.posts.some((p) => p.tx === at.get("spare")!.tx && p.ty === at.get("spare")!.ty)).toBe(true);
  });

  it("keep one field hand to a furrow", DAY, () => {
    const s = site({ hourAt: from(7) });
    const rowOf = new Map(LAYOUT.plots.map((p) => [p.id, p.work.ty]));
    let shared = 0;
    let worked = 0;
    run(s, hours(8), () => {
      const hands = new Map<number, Set<string>>();
      for (const n of s.view().notes) {
        if (n.claimedBy === null || (n.kind !== "harvest" && n.kind !== "sow")) continue;
        const row = rowOf.get(n.key.slice(n.key.indexOf(":") + 1))!;
        hands.set(row, (hands.get(row) ?? new Set()).add(n.claimedBy));
      }
      worked += hands.size;
      for (const who of hands.values()) if (who.size > 1) shared += 1;
    });
    expect(worked).toBeGreaterThan(0);
    expect(shared).toBe(0);
  });
});

describe("a day on the farm", () => {
  it("keeps the troughs filled, and the animals eat and drink from them", DAY, () => {
    const s = site();
    const events = run(s, hours(6));
    expect(count(events, "fed")).toBeGreaterThan(3);
    expect(count(events, "watered")).toBeGreaterThan(5);
    const view = s.view();
    for (const a of view.animals) {
      expect(a.hunger, a.name).toBeGreaterThan(0.2);
      expect(a.thirst, a.name).toBeGreaterThan(0.2);
    }
    // Something was eaten: troughs aren't all still brim full.
    expect(view.troughs.some((t) => t.level < 1)).toBe(true);
  });

  it("milks every cow in the morning and again in the evening", DAY, () => {
    const s = site({ hourAt: from(4.5) });
    const milked: { cow: string; hour: number }[] = [];
    run(s, hours(15.5), (events) => {
      for (const e of events) if (e.kind === "milked") milked.push({ cow: e.cow, hour: s.hour() });
    });
    const morning = milked.filter((m) => m.hour < 12);
    const evening = milked.filter((m) => m.hour >= 16);
    expect(new Set(morning.map((m) => m.cow)).size).toBe(3);
    expect(new Set(evening.map((m) => m.cow)).size).toBe(3);
    expect(s.view().dairy.milk).toBe(6);
  });

  it("collects the eggs and carries them to the dairy", DAY, () => {
    const s = site();
    const events = run(s, hours(10));
    const eggs = events.flatMap((e) => (e.kind === "eggs" ? [e.count] : []));
    expect(eggs.length).toBeGreaterThan(0);
    // One each, all brought in by the afternoon sweep.
    expect(eggs.reduce((a, b) => a + b, 0)).toBe(6);
    expect(s.view().dairy.eggs).toBe(6);
    expect(s.view().nestEggs).toBe(0);
  });

  it("grows corn slower than wheat", DAY, () => {
    const s = site({ crew: [], hourAt: from(6) });
    const plots = () => s.view().plots;
    const start = new Map(plots().map((p) => [`${p.tx},${p.ty}`, p.stage]));
    run(s, hours(5));
    const grew = (crop: string) => plots().filter((p) => p.crop === crop && p.stage > start.get(`${p.tx},${p.ty}`)!).length;
    expect(BARN_TUNING.stageHours.corn).toBeGreaterThan(BARN_TUNING.stageHours.wheat);
    expect(plots().every((p) => p.crop === "wheat" || p.crop === "corn")).toBe(true);
    expect(grew("wheat") + grew("corn")).toBeGreaterThan(0);
  });

  it("brings in the crop to the feed store and sows the field again", DAY, () => {
    const s = site();
    let before = s.view().feedStore;
    let rose = 0;
    const events = run(s, hours(12), (happened) => {
      const now = s.view().feedStore;
      if (happened.some((e) => e.kind === "harvested") && now > before) rose += 1;
      before = now;
    });
    expect(count(events, "harvested")).toBeGreaterThan(2);
    expect(rose).toBeGreaterThan(0);
    expect(count(events, "sown")).toBeGreaterThan(5);
    // Carried back a few at a time, not one plot a trip.
    expect(Math.max(...events.flatMap((e) => (e.kind === "harvested" ? [e.count] : [])))).toBeGreaterThan(1);
  });

  it("mucks out the pens", DAY, () => {
    const events = run(site(), hours(14));
    expect(new Set(events.flatMap((e) => (e.kind === "mucked" ? [e.pen] : []))).size).toBeGreaterThanOrEqual(2);
  });

  it("puts the hens in at dusk and lets them out in the morning", DAY, () => {
    const s = site({ hourAt: from(19) });
    run(s, hours(2));
    expect(s.view().animals.filter((a) => a.kind === "hen").every((a) => a.doing === "inside")).toBe(true);
    expect(s.view().animals.filter((a) => a.kind !== "hen").every((a) => a.doing === "sleep")).toBe(true);
    run(s, hours(10));
    expect(s.view().animals.filter((a) => a.kind === "hen").some((a) => a.doing !== "inside")).toBe(true);
  });

  it("keeps the piglets by their mothers", DAY, () => {
    const s = site({ hourAt: from(8) });
    let samples = 0;
    let apart = 0;
    run(s, hours(3), () => {
      const animals = s.view().animals;
      for (const p of animals.filter((a) => a.young)) {
        const mother = animals.find((a) => a.id === p.mother)!;
        samples += 1;
        apart += Math.max(Math.abs(p.tile.tx - mother.tile.tx), Math.abs(p.tile.ty - mother.tile.ty));
      }
    });
    expect(s.view().animals.filter((a) => a.young)).toHaveLength(SMALL.herd.pig * SMALL.litter);
    expect(apart / samples).toBeLessThan(3);
  });

  it("the sows lie in the wallow through the heat of the day, and not before", DAY, () => {
    const s = site({ hourAt: from(8) });
    const wallowed: number[] = [];
    run(s, hours(7), () => {
      if (s.view().animals.some((a) => a.doing === "wallow")) wallowed.push(s.hour());
    });
    expect(wallowed.length).toBeGreaterThan(0);
    expect(Math.min(...wallowed)).toBeGreaterThanOrEqual(BARN_TUNING.wallowHours[0]);
  });

  it("beds the pigs down by the ark at night, each piglet beside her mother", DAY, () => {
    const s = site({ hourAt: from(19) });
    run(s, hours(2.5));
    const pigs = s.view().animals.filter((a) => a.kind === "pig");
    const sty = LAYOUT.pens.find((p) => p.id === "sty")!;
    for (const sow of pigs.filter((a) => !a.young)) {
      expect(sow.doing, sow.name).toBe("sleep");
      expect(sty.bed.some((b) => b.tx === sow.tile.tx && b.ty === sow.tile.ty), sow.name).toBe(true);
    }
    for (const p of pigs.filter((a) => a.young)) {
      const mother = pigs.find((a) => a.id === p.mother)!;
      expect(p.doing, p.name).toBe("sleep");
      expect(Math.max(Math.abs(p.tile.tx - mother.tile.tx), Math.abs(p.tile.ty - mother.tile.ty)), p.name).toBeLessThanOrEqual(1);
    }
  });

  it("grooms each horse in her stall and leads her out to the paddock in the morning", DAY, () => {
    const s = site({ hourAt: from(6.5) });
    const seen = new Set<string>();
    const led = new Set<string>();
    const events = run(s, hours(3), () => {
      for (const a of s.view().animals) {
        if (a.kind !== "horse") continue;
        seen.add(a.doing);
        if (a.ledBy) led.add(`${a.name}:${a.ledBy}`);
      }
    });
    expect(count(events, "turned-out")).toBe(2);
    expect(seen.has("groomed")).toBe(true);
    expect(seen.has("gallop")).toBe(true);
    expect([...led].every((l) => /:(ruby|amos)$/.test(l))).toBe(true);
    const pen = LAYOUT.pens.find((p) => p.id === "paddock")!;
    const paddock = new Set([...pen.ground, ...pen.eat, ...pen.drink].map((t) => `${t.tx},${t.ty}`));
    for (const h of s.view().animals.filter((a) => a.kind === "horse")) expect(paddock.has(`${h.tile.tx},${h.tile.ty}`), h.name).toBe(true);
  });

  it("brings the horses in at evening, and they spend the night in their stalls", DAY, () => {
    const s = site({ hourAt: from(9) });
    const events = run(s, hours(11.5));
    expect(count(events, "brought-in")).toBe(2);
    const horses = s.view().animals.filter((a) => a.kind === "horse");
    for (const h of horses) {
      expect(h.doing, h.name).toBe("sleep");
      expect(LAYOUT.stalls.some((st) => st.horse.tx === h.tile.tx && st.horse.ty === h.tile.ty), h.name).toBe(true);
    }
  });

  it("with no stable hand the horses stay in their stalls all day", DAY, () => {
    const s = site({ crew: BARN_CREW.filter((h) => h.job !== "stable"), hourAt: from(6.5) });
    const events = run(s, hours(4));
    expect(count(events, "turned-out")).toBe(0);
    expect(s.view().animals.filter((a) => a.kind === "horse").every((a) => a.doing === "stall")).toBe(true);
  });

  it("a horse without a stall of her own lives out, and sleeps in the paddock", DAY, () => {
    const s = site({ hourAt: from(9), tuning: { ...SMALL, herd: { ...SMALL.herd, horse: 3 } } });
    const events = run(s, hours(11.5));
    expect(count(events, "brought-in")).toBe(2);
    const out = s.view().animals.filter((a) => a.kind === "horse" && !LAYOUT.stalls.some((st) => st.horse.tx === a.tile.tx && st.horse.ty === a.tile.ty));
    expect(out.map((a) => a.doing)).toEqual(["sleep"]);
  });

  it("only works the shift: nothing's on the board at night", DAY, () => {
    const s = site({ hourAt: from(20.5) });
    run(s, hours(1));
    expect(s.view().working).toBe(false);
    expect(s.view().notes).toHaveLength(0);
  });

  it("plays out the same from the same seed", DAY, () => {
    expect(run(site({ seed: 3 }), hours(3))).toEqual(run(site({ seed: 3 }), hours(3)));
  });

  it("nobody on the crew is ever stuck for long", DAY, () => {
    const s = site({ seed: 5, hourAt: from(5) });
    const crew = (s as unknown as { workers: Worker<FarmJob>[] }).workers;
    let longest = 0;
    run(s, hours(16), () => {
      for (const w of crew) longest = Math.max(longest, w.walker.blockedMs);
    });
    expect(longest).toBeLessThan(5000);
  });

  it("with a short crew the troughs run dry and the animals go without", DAY, () => {
    const dry = (crew: readonly FarmHand[]) => {
      // The full-size herd: the small one is too little work to swamp even a crew of three.
      const s = site({ crew, seed: 9, hourAt: from(5), tuning: BARN_TUNING });
      let ms = 0;
      let without = 0;
      run(s, hours(16), () => {
        const view = s.view();
        ms += view.troughs.filter((t) => t.level <= 0.02).length * 50;
        without += view.animals.filter((a) => a.hunger < 0.25 || a.thirst < 0.25).length * 50;
      });
      return { ms, without };
    };
    const full = dry(BARN_CREW);
    const short = dry(crewOf(BARN_STARTING_CREW));
    expect(short.ms).toBeGreaterThan(full.ms * 2 + hours(1));
    expect(short.without).toBeGreaterThan(full.without * 2 + hours(1));
  });

  it("with nobody in the field the feed store runs out", DAY, () => {
    const s = site({ crew: BARN_CREW.filter((h) => h.job !== "field"), tuning: { ...BARN_TUNING, feedStart: 4 } });
    const events = run(s, hours(10));
    expect(count(events, "feed-out")).toBeGreaterThan(0);
    expect(s.view().feedStore).toBe(0);
  });
});

const REAL = join(process.cwd(), "public/stackacres-td/areas/barnyard/area.json");

describe.runIf(existsSync(REAL))("on the real barnyard", () => {
  const area = () => JSON.parse(readFileSync(REAL, "utf8")) as BarnArea;
  const day = (crew: readonly FarmHand[]) => {
    const a = area();
    const s = new Barnsite(barnLayout(a), barnGrid(a), { seed: 1, hourAt: from(5) });
    for (const h of crew) s.hire(h.name, h.job, h.name, h.profile);
    const workers = (s as unknown as { workers: Worker<FarmJob>[] }).workers;
    const start = s.view().feedStore;
    let longest = 0;
    let dryMs = 0;
    let lowest = 1;
    let ranOutAt: number | null = null;
    const milked: number[] = [];
    const events = run(s, hours(16), (happened) => {
      for (const e of happened) if (e.kind === "milked") milked.push(s.hour());
      const view = s.view();
      for (const w of workers) longest = Math.max(longest, w.walker.blockedMs);
      dryMs += view.troughs.filter((t) => t.level <= 0.02).length * 50;
      for (const an of view.animals) lowest = Math.min(lowest, an.hunger, an.thirst);
      if (ranOutAt === null && view.feedStore === 0) ranOutAt = s.hour();
    });
    return { s, events, start, longest, dryMs, lowest, ranOutAt: ranOutAt as number | null, milked };
  };

  it("lays out the farm: job posts, both crops in two-row beds, room round the troughs, the sty and the stable", () => {
    const layout = barnLayout(area());
    expect([layout.jobPosts.hand.length, layout.jobPosts.dairy.length, layout.jobPosts.field.length, layout.jobPosts.stable.length]).toEqual([
      4, 3, 3, 2,
    ]);
    expect(layout.pens.map((p) => p.kind).sort()).toEqual(["cow", "hen", "horse", "pig", "sheep"]);
    expect([layout.stalls.length, layout.catches.length]).toEqual([4, 2]);
    const sty = layout.pens.find((p) => p.kind === "pig")!;
    expect([sty.bed.length, sty.wallow.length]).toEqual([3, 5]);
    expect(new Set(layout.plots.map((p) => p.crop))).toEqual(new Set(["wheat", "corn"]));
    const isPlot = new Set(layout.plots.map((p) => `${p.at.tx},${p.at.ty}`));
    for (const p of layout.plots) expect(isPlot.has(`${p.work.tx},${p.work.ty}`), p.id).toBe(false);
    expect(layout.stands).toHaveLength(3);
    // The hens' one-square water trough is drunk from at both ends too.
    expect(layout.pens.find((p) => p.id === "coop")!.drink.length).toBeGreaterThan(1);
  });

  it("runs a full working day with the whole crew: nobody stuck, nothing left undone, the feed store level", DAY, () => {
    const { events, start, s, longest, dryMs, lowest, milked } = day(BARN_CREW);
    expect(longest).toBeLessThan(5000);
    for (const kind of ["fed", "watered", "eggs", "harvested", "sown", "mucked"] as const) expect(count(events, kind), kind).toBeGreaterThan(0);
    // Every cow, morning and evening.
    expect(milked.filter((h) => h < 12)).toHaveLength(6);
    expect(milked.filter((h) => h >= 12)).toHaveLength(6);
    expect(s.view().dairy.eggs).toBe(10);
    expect(Math.abs(s.view().feedStore - start)).toBeLessThanOrEqual(10);
    // Ten troughs over sixteen hours, dry for under eight minutes each on average, and nobody goes without.
    expect(dryMs / s.view().troughs.length).toBeLessThan(hours(8 / 60));
    for (const kind of ["turned-out", "brought-in"] as const) expect(count(events, kind), kind).toBe(4);
    expect(lowest).toBeGreaterThan(0.1);
  });

  it("runs out of feed by the middle of the day with nobody in the field", DAY, () => {
    const { ranOutAt, lowest } = day(BARN_CREW.filter((h) => h.job !== "field"));
    expect(ranOutAt).not.toBeNull();
    expect(ranOutAt!).toBeGreaterThan(10);
    expect(ranOutAt!).toBeLessThan(17);
    expect(lowest).toBeLessThan(0.05);
  });

  it("falls behind with one of each", DAY, () => {
    const full = day(BARN_CREW);
    const short = day(crewOf(BARN_STARTING_CREW));
    expect(short.dryMs).toBeGreaterThan(full.dryMs + hours(10));
    expect(short.lowest).toBeLessThan(0.05);
  });
});
