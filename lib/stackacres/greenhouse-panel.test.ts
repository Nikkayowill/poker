import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "@/lib/profile/types";
// The panel and its pure helpers, tested here because vitest only collects lib/ and app/.
import {
  GREENHOUSE_CAN_EMPTY,
  GREENHOUSE_FASTER_PERCENT,
  GREENHOUSE_NO_SEED,
  StackAcresGreenhousePanel,
  greenhouseSeedChoices,
  greenhouseSowLabel,
  slotsFor,
  type GreenhousePanelProps,
} from "@/components/arcade/stackacres/stackacres-greenhouse-panel";
import { STACKACRES_CATALOGUE } from "./catalogue";
import { GREENHOUSE_SLOT_CAP, greenhouseDurationMs } from "./greenhouse";
import { predictStackAcresAction, type FarmPredictContext } from "./optimistic-actions";
import { SEED_SELLER_NAME } from "./seed-seller";
import { withLocalClockUnit } from "./units";
import { WATER_CAPACITY } from "./water-can";

const NOW = new Date("2026-10-05T12:00:00.000Z").getTime();

function ctx(overrides: Partial<FarmPredictContext> = {}): FarmPredictContext {
  const profile = { id: "p1", goldBalance: 1_000, unlimitedGold: false } as PlayerProfile;
  return {
    profile,
    goldBalance: profile.goldBalance,
    unlimitedGold: false,
    units: [],
    feed: 0,
    water: WATER_CAPACITY,
    energy: { level: 100, updatedAt: new Date(NOW).toISOString() },
    capacity: {},
    seedStock: { lettuce: 2 },
    toolTier: "trowel",
    cutters: ["scythe"],
    sectors: [],
    upkeep: { plots: 0, fee: 0, paidToday: 0, due: 0 },
    influence: 0,
    contract: null,
    secrets: { held: {}, boostArmed: false },
    secretDonations: {} as FarmPredictContext["secretDonations"],
    greenhouseBuilt: true,
    cropFieldsUnlocked: false,
    soilTiles: [],
    forageNodes: [],
    landObstacles: [],
    fences: [],
    inventory: {},
    wheatPlots: [],
    machines: [],
    nowMs: NOW,
    ...overrides,
  };
}

describe("greenhouseSeedChoices", () => {
  it("offers only the crops seed is held for, in the catalogue's order", () => {
    expect(greenhouseSeedChoices({ tomato: 1, lettuce: 3, corn: 0 })).toEqual([
      { stock: "lettuce", held: 3 },
      { stock: "tomato", held: 1 },
    ]);
  });

  it("offers nothing with no seed on hand", () => {
    expect(greenhouseSeedChoices({})).toEqual([]);
    expect(greenhouseSeedChoices({ lettuce: 0 })).toEqual([]);
  });
});

describe("greenhouseSowLabel", () => {
  it("names the seed on hand, never a Gold price", () => {
    expect(greenhouseSowLabel({ stock: "lettuce", held: 3 })).toBe("Sow Lettuce (3 seeds)");
    expect(greenhouseSowLabel({ stock: "bell_pepper", held: 1 })).toBe("Sow Bell Pepper (1 seed)");
    expect(greenhouseSowLabel({ stock: "lettuce", held: 3 })).not.toMatch(/Gold/);
  });
});

describe("the panel's copy", () => {
  it("sends a player with no seed to Cora", () => {
    expect(GREENHOUSE_NO_SEED).toContain(SEED_SELLER_NAME);
  });

  it("says faster by as much as a housed crop really saves", () => {
    expect(GREENHOUSE_FASTER_PERCENT).toBeGreaterThan(0);
    const outside = STACKACRES_CATALOGUE.lettuce.durationMs;
    expect(greenhouseDurationMs("lettuce", outside, true)).toBe(Math.round((outside * (100 - GREENHOUSE_FASTER_PERCENT)) / 100));
  });
});

describe("a Greenhouse crop from sowing to picking, as the panel shows it", () => {
  const sown = predictStackAcresAction({ action: "stock", stock: "lettuce", inGreenhouse: true }, ctx());
  const seed = sown?.units?.[0];

  it("goes in as dry seed that asks for water", () => {
    expect(seed?.housedIn).toBe("greenhouse");
    expect(sown?.seedStock?.lettuce).toBe(1);
    const [first, ...rest] = slotsFor(sown?.units ?? []);
    expect(first).toMatchObject({ kind: "growing", thirsty: true });
    expect(rest).toHaveLength(GREENHOUSE_SLOT_CAP - 1);
    expect(rest.every((slot) => slot.kind === "empty")).toBe(true);
  });

  it("does not grow on its own, however long it waits", () => {
    if (!seed) throw new Error("No seed was sown.");
    const dayLater = withLocalClockUnit(seed, NOW + 24 * 60 * 60 * 1000);
    expect(slotsFor([dayLater])[0]).toMatchObject({ kind: "growing", thirsty: true });
  });

  it("starts growing the moment it is watered, from the can", () => {
    if (!seed) throw new Error("No seed was sown.");
    const watered = predictStackAcresAction({ action: "water", unitId: seed.id }, ctx({ units: [seed] }));
    expect(watered?.water).toBe(WATER_CAPACITY - 1);
    expect(slotsFor(watered?.units ?? [])[0]).toMatchObject({ kind: "growing", thirsty: false, progress: 0 });
  });

  it("is ready to collect once its shortened cycle has run", () => {
    if (!seed) throw new Error("No seed was sown.");
    const watered = predictStackAcresAction({ action: "water", unitId: seed.id }, ctx({ units: [seed] }))?.units?.[0];
    if (!watered) throw new Error("The seed was not watered.");
    const cycle = greenhouseDurationMs("lettuce", STACKACRES_CATALOGUE.lettuce.durationMs, true);
    expect(slotsFor([withLocalClockUnit(watered, NOW + cycle - 1)])[0]).toMatchObject({ kind: "growing" });
    expect(slotsFor([withLocalClockUnit(watered, NOW + cycle)])[0]).toEqual({
      kind: "ready",
      unitId: watered.id,
      stock: "lettuce",
    });
  });
});

function noop(): void {}

/** The panel as the farm draws it, as HTML. */
function panel(overrides: Partial<GreenhousePanelProps> = {}): string {
  const props: GreenhousePanelProps = {
    built: true,
    inventory: {},
    units: [],
    seedStock: {},
    water: WATER_CAPACITY,
    busy: false,
    onBuild: noop,
    onSow: noop,
    onWater: noop,
    onCollect: noop,
    onClose: noop,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(StackAcresGreenhousePanel, props));
}

/** Every button's own text, in order. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
}

describe("the Greenhouse panel", () => {
  const seed = predictStackAcresAction({ action: "stock", stock: "lettuce", inGreenhouse: true }, ctx())?.units?.[0];
  if (!seed) throw new Error("No seed was sown.");

  it("gives a thirsty crop a Water button", () => {
    const html = panel({ units: [seed] });
    expect(html).toContain("Needs water");
    expect(buttons(html)).toContain("Water");
    expect(html).not.toContain(GREENHOUSE_CAN_EMPTY);
  });

  it("holds the Water button back, and says why, while the can is empty", () => {
    const html = panel({ units: [seed], water: 0 });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Water<\/button>/);
    expect(html).toContain(GREENHOUSE_CAN_EMPTY);
  });

  it("offers each held seed once, by count, and never a Gold price", () => {
    const html = panel({ seedStock: { lettuce: 3, tomato: 1, carrot: 0 } });
    const sow = buttons(html).filter((text) => text.startsWith("Sow "));
    expect(sow).toEqual(["Sow Lettuce (3 seeds)", "Sow Tomato (1 seed)"]);
    expect(html).not.toContain("Gold");
  });

  it("points at Cora when there is no seed to sow", () => {
    const html = panel({ seedStock: {} });
    expect(buttons(html).filter((text) => text.startsWith("Sow "))).toEqual([]);
    expect(html).toContain(`${SEED_SELLER_NAME} sells it at`);
  });

  it("says the build makes crops faster, not a slower pace", () => {
    const html = panel({ built: false });
    expect(html).toContain(`Crops grow ${GREENHOUSE_FASTER_PERCENT}% faster in here`);
    expect(html).not.toContain("pace");
  });
});
