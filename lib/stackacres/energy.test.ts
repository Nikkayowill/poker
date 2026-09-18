import { describe, expect, it } from "vitest";
import {
  ENERGY_MAX,
  ENERGY_REGEN_CAP,
  ENERGY_REGEN_MS,
  FOOD_ENERGY,
  applyEnergyDelta,
  energyAt,
  isFoodItem,
  nextEnergyPointAt,
  settleEnergy,
} from "./energy";

const T0 = new Date("2026-09-18T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const anchor = (level: number, updatedAt = T0) => ({ level, updatedAt: updatedAt.toISOString() });

describe("energyAt", () => {
  it("starts a brand new farm full", () => {
    expect(energyAt(null, T0)).toBe(ENERGY_MAX);
  });

  it("refills one point every 6 minutes", () => {
    expect(energyAt(anchor(10), at(ENERGY_REGEN_MS - 1))).toBe(10);
    expect(energyAt(anchor(10), at(ENERGY_REGEN_MS))).toBe(11);
    expect(energyAt(anchor(10), at(5 * ENERGY_REGEN_MS + 1))).toBe(15);
  });

  it("never refills past 50 from waiting", () => {
    expect(energyAt(anchor(0), at(1000 * ENERGY_REGEN_MS))).toBe(ENERGY_REGEN_CAP);
  });

  it("does not decay a level above 50", () => {
    expect(energyAt(anchor(80), at(1000 * ENERGY_REGEN_MS))).toBe(80);
  });

  it("ignores a clock running backwards", () => {
    expect(energyAt(anchor(10), at(-ENERGY_REGEN_MS * 5))).toBe(10);
  });
});

describe("applyEnergyDelta", () => {
  it("refuses a spend that would go below zero", () => {
    expect(applyEnergyDelta(anchor(4), -5, T0)).toBeNull();
    expect(applyEnergyDelta(anchor(5), -5, T0)?.level).toBe(0);
  });

  it("lets food go above 50 but never above 100", () => {
    expect(applyEnergyDelta(anchor(45), FOOD_ENERGY.bread, T0)?.level).toBe(65);
    expect(applyEnergyDelta(anchor(90), FOOD_ENERGY.cake, T0)?.level).toBe(ENERGY_MAX);
  });

  it("keeps a partial point in progress across a spend", () => {
    // 3 minutes into the next point at 20: spending 5 keeps those 3 minutes.
    const next = applyEnergyDelta(anchor(20), -5, at(ENERGY_REGEN_MS / 2));
    expect(next).toEqual({ level: 15, updatedAt: T0.toISOString() });
    expect(energyAt(next, at(ENERGY_REGEN_MS))).toBe(16);
  });

  it("starts regen from now when a spend drops below the cap", () => {
    const next = applyEnergyDelta(anchor(52), -5, at(ENERGY_REGEN_MS * 3));
    expect(next).toEqual({ level: 47, updatedAt: at(ENERGY_REGEN_MS * 3).toISOString() });
  });
});

describe("settleEnergy and nextEnergyPointAt", () => {
  it("moves the anchor forward by whole points only", () => {
    expect(settleEnergy(anchor(10), at(ENERGY_REGEN_MS * 2 + 1000))).toEqual({
      level: 12,
      updatedAt: at(ENERGY_REGEN_MS * 2).toISOString(),
    });
    expect(nextEnergyPointAt(anchor(10), at(1000))?.toISOString()).toBe(at(ENERGY_REGEN_MS).toISOString());
    expect(nextEnergyPointAt(anchor(50), T0)).toBeNull();
  });
});

describe("isFoodItem", () => {
  it("knows bread and cake, nothing else", () => {
    expect(isFoodItem("bread")).toBe(true);
    expect(isFoodItem("cake")).toBe(true);
    expect(isFoodItem("flour")).toBe(false);
    expect(isFoodItem("eggs")).toBe(false);
  });
});
