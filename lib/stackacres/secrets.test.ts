import { describe, expect, it } from "vitest";
import { BARN_FOOTPRINT, barnHitAt, growAreaAt } from "./world";
import {
  HIDDEN_ZONES,
  SECRET_ITEM_CATALOGUE,
  STACKACRES_DICE_CRIT_BONUS,
  STACKACRES_DICE_UPKEEP_WIPE,
  STACKACRES_DICE_BOOST_ARMED_KEY,
  effectiveCritChance,
  hiddenZoneAt,
  nextUpkeepPaidAfterDiceTrade,
  rollSecretDiscovery,
  secretZoneAttemptKey,
} from "./secrets";

describe("the one secret item", () => {
  it("is catalogued with everything a store row and a museum wing need", () => {
    const dice = SECRET_ITEM_CATALOGUE.lucky_poker_dice;
    expect(dice.id).toBe("lucky_poker_dice");
    expect(dice.label.length).toBeGreaterThan(0);
    expect(dice.icon).toBe("🎲");
    expect(dice.rarity).toBe("legendary");
    expect(dice.blurb.length).toBeGreaterThan(0);
  });
});

describe("hidden zone hit-testing", () => {
  it("hits at every zone's corners and center", () => {
    for (const zone of HIDDEN_ZONES) {
      const b = zone.bounds;
      expect(hiddenZoneAt(b.x, b.y)?.id).toBe(zone.id);
      expect(hiddenZoneAt(b.x + b.width, b.y)?.id).toBe(zone.id);
      expect(hiddenZoneAt(b.x, b.y + b.height)?.id).toBe(zone.id);
      expect(hiddenZoneAt(b.x + b.width, b.y + b.height)?.id).toBe(zone.id);
      expect(hiddenZoneAt(b.x + b.width / 2, b.y + b.height / 2)?.id).toBe(zone.id);
    }
  });

  it("misses just outside a zone's box", () => {
    for (const zone of HIDDEN_ZONES) {
      const b = zone.bounds;
      expect(hiddenZoneAt(b.x - 1, b.y)).toBeNull();
      expect(hiddenZoneAt(b.x + b.width + 1, b.y)).toBeNull();
      expect(hiddenZoneAt(b.x, b.y - 1)).toBeNull();
      expect(hiddenZoneAt(b.x, b.y + b.height + 1)).toBeNull();
    }
  });

  it("misses a point far from every zone", () => {
    expect(hiddenZoneAt(-5000, -5000)).toBeNull();
  });

  it("names three distinct zones, each with a positive discovery chance under 1", () => {
    const ids = new Set(HIDDEN_ZONES.map((zone) => zone.id));
    expect(ids.size).toBe(3);
    for (const zone of HIDDEN_ZONES) {
      expect(zone.discoveryChance).toBeGreaterThan(0);
      expect(zone.discoveryChance).toBeLessThan(1);
    }
  });
});

describe("disjointness from GROW_AREA and BARN_FOOTPRINT", () => {
  it("never lands a hidden zone's corners on a district's grow area or the barn", () => {
    for (const zone of HIDDEN_ZONES) {
      const b = zone.bounds;
      const corners: [number, number][] = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ];
      for (const [x, y] of corners) {
        expect(growAreaAt(x, y)).toBeNull();
        expect(barnHitAt(x, y)).toBe(false);
      }
    }
  });

  it("sanity-checks BARN_FOOTPRINT is itself non-degenerate (guards the test above from a false pass)", () => {
    expect(BARN_FOOTPRINT.width).toBeGreaterThan(0);
    expect(BARN_FOOTPRINT.height).toBeGreaterThan(0);
  });
});

describe("rollSecretDiscovery", () => {
  it("hits when the roll clears the zone's own chance", () => {
    const zone = HIDDEN_ZONES[0];
    expect(rollSecretDiscovery(zone, () => 0)).toBe("lucky_poker_dice");
    expect(rollSecretDiscovery(zone, () => zone.discoveryChance - 0.0001)).toBe("lucky_poker_dice");
  });

  it("misses when the roll does not clear it", () => {
    const zone = HIDDEN_ZONES[0];
    expect(rollSecretDiscovery(zone, () => zone.discoveryChance)).toBeNull();
    expect(rollSecretDiscovery(zone, () => 0.999999)).toBeNull();
  });

  it("is deterministic for a fixed source", () => {
    const zone = HIDDEN_ZONES[1];
    const random = () => 0.01;
    expect(rollSecretDiscovery(zone, random)).toBe(rollSecretDiscovery(zone, random));
  });
});

describe("effectiveCritChance", () => {
  it("is unchanged with no boost armed", () => {
    expect(effectiveCritChance(0, false)).toBe(0);
    expect(effectiveCritChance(0.12, false)).toBe(0.12);
  });

  it("adds the dice bonus when armed", () => {
    expect(effectiveCritChance(0, true)).toBeCloseTo(STACKACRES_DICE_CRIT_BONUS, 10);
    expect(effectiveCritChance(0.12, true)).toBeCloseTo(0.12 + STACKACRES_DICE_CRIT_BONUS, 10);
  });

  it("clamps at 1 rather than exceeding certainty", () => {
    expect(effectiveCritChance(0.95, true)).toBe(1);
    expect(effectiveCritChance(1, true)).toBe(1);
  });
});

describe("nextUpkeepPaidAfterDiceTrade", () => {
  it("raises paidToday by the wipe amount, clamped at the fee", () => {
    expect(nextUpkeepPaidAfterDiceTrade(0, 100_000)).toBe(STACKACRES_DICE_UPKEEP_WIPE);
    expect(nextUpkeepPaidAfterDiceTrade(1_000, 100_000)).toBe(1_000 + STACKACRES_DICE_UPKEEP_WIPE);
  });

  it("clamps exactly at the fee when the wipe would overshoot it", () => {
    expect(nextUpkeepPaidAfterDiceTrade(0, 1_000)).toBe(1_000);
    expect(nextUpkeepPaidAfterDiceTrade(999, 1_000)).toBe(1_000);
  });

  it("never returns above the fee, even at the exact boundary", () => {
    const fee = STACKACRES_DICE_UPKEEP_WIPE;
    expect(nextUpkeepPaidAfterDiceTrade(0, fee)).toBe(fee);
  });

  it("treats a negative paidToday as zero rather than subtracting further", () => {
    expect(nextUpkeepPaidAfterDiceTrade(-500, 100_000)).toBe(STACKACRES_DICE_UPKEEP_WIPE);
  });

  it("is a no-op-ish floor when the fee is already zero", () => {
    expect(nextUpkeepPaidAfterDiceTrade(0, 0)).toBe(0);
    expect(nextUpkeepPaidAfterDiceTrade(500, 0)).toBe(0);
  });
});

describe("ledger keys", () => {
  it("builds a stable, zone-and-day-scoped attempt key", () => {
    expect(secretZoneAttemptKey("wishing-well", "2026-09-04")).toBe(
      "secret-attempt:wishing-well:2026-09-04",
    );
    expect(secretZoneAttemptKey("loose-board", "2026-09-04")).not.toBe(
      secretZoneAttemptKey("wishing-well", "2026-09-04"),
    );
    expect(secretZoneAttemptKey("wishing-well", "2026-09-05")).not.toBe(
      secretZoneAttemptKey("wishing-well", "2026-09-04"),
    );
  });

  it("names the boost-armed marker as a plain, non-SecretItemId string", () => {
    expect(STACKACRES_DICE_BOOST_ARMED_KEY).toBe("lucky_poker_dice_boost_armed");
    expect(STACKACRES_DICE_BOOST_ARMED_KEY in SECRET_ITEM_CATALOGUE).toBe(false);
  });
});
