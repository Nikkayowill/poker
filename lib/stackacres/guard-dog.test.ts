import { describe, expect, it } from "vitest";
import { herdKey, isHerdMapTile } from "./herd";
import { CROWDED_RISK, OPEN_RISK, herdAway, herdRisk, herdShelter } from "./herd-risk";
import { GUARD_DOG_RANGE, dogPlacementProblem, dogSquares, isGuarded } from "./guard-dog";

const DAY = 86_400_000;

function sheep(id: string, tx: number, ty: number) {
  return { id, stock: "pig" as const, mapTx: tx, mapTy: ty };
}

/** Fence pieces on the four sides of a rectangle of squares. */
function pen(x0: number, y0: number, x1: number, y1: number): Set<string> {
  const fences = new Set<string>();
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    fences.add(herdKey(x, y0 - 1));
    fences.add(herdKey(x, y1 + 1));
  }
  for (let y = y0; y <= y1; y++) {
    fences.add(herdKey(x0 - 1, y));
    fences.add(herdKey(x1 + 1, y));
  }
  return fences;
}

describe("a dog's reach", () => {
  it("covers every square within its range, corners included", () => {
    const dog = [{ tx: 10, ty: 10 }];
    expect(isGuarded(10, 10, dog)).toBe(true);
    expect(isGuarded(10 + GUARD_DOG_RANGE, 10 + GUARD_DOG_RANGE, dog)).toBe(true);
    expect(isGuarded(10 - GUARD_DOG_RANGE, 10, dog)).toBe(true);
    expect(isGuarded(10 + GUARD_DOG_RANGE + 1, 10, dog)).toBe(false);
    expect(isGuarded(10, 10 - GUARD_DOG_RANGE - 1, dog)).toBe(false);
    expect(isGuarded(10, 10, [])).toBe(false);
  });

  it("keeps an animal in the open home, and leaves a crowded pen crowded", () => {
    const a = sheep("a", 10, 10);
    const dog = [{ tx: 12, ty: 11 }];
    expect(herdShelter(a, new Set(), [a])).toBe("open");
    expect(herdShelter(a, new Set(), [a], dog)).toBe("guarded");
    expect(herdRisk("guarded")).toBe(0);

    const b = sheep("b", 10, 11);
    const tight = pen(10, 10, 10, 11);
    expect(herdShelter(a, tight, [a, b])).toBe("crowded");
    expect(herdShelter(a, tight, [a, b], dog)).toBe("crowded");
    expect(herdRisk("crowded")).toBe(CROWDED_RISK);
  });

  it("brings every open-ground loss home across a year of nights, and only those", () => {
    const flock = [sheep("a", 4, 4), sheep("b", 5, 4), sheep("c", 4, 5)];
    const dog = [{ tx: 6, ty: 6 }];
    let lost = 0;
    for (let night = 0; night < 365; night++) {
      lost += herdAway(flock, new Set(), night * DAY).size;
      expect(herdAway(flock, new Set(), night * DAY, dog).size).toBe(0);
    }
    expect(lost).toBeGreaterThan(365 * 3 * OPEN_RISK * 0.5);
  });

  it("only reaches as far as it reaches", () => {
    const near = sheep("near", 4, 4);
    const far = sheep("far", 4 + GUARD_DOG_RANGE + 1, 4);
    const dog = [{ tx: 4, ty: 4 + 1 }];
    let farLost = 0;
    for (let night = 0; night < 365; night++) {
      const away = herdAway([near, far], new Set(), night * DAY, dog);
      expect(away.has("near")).toBe(false);
      if (away.has("far")) farLost += 1;
    }
    expect(farLost).toBeGreaterThan(0);
  });
});

describe("where a dog goes", () => {
  it("names every other dog's square, not its own", () => {
    const dogs = [
      { id: "x", tx: 1, ty: 1 },
      { id: "y", tx: 2, ty: 2 },
    ];
    expect([...dogSquares(dogs)].sort()).toEqual([herdKey(1, 1), herdKey(2, 2)]);
    expect([...dogSquares(dogs, "x")]).toEqual([herdKey(2, 2)]);
  });

  it("refuses the same squares a herd animal is refused", () => {
    const yard: { tx: number; ty: number }[] = [];
    for (let ty = 0; yard.length < 4 && ty < 64; ty++) {
      for (let tx = 0; yard.length < 4 && tx < 64; tx++) if (isHerdMapTile(tx, ty)) yard.push({ tx, ty });
    }
    const [bed, fence, animal, free] = yard;
    const taken = {
      beds: new Set([herdKey(bed.tx, bed.ty)]),
      fences: new Set([herdKey(fence.tx, fence.ty)]),
      animals: new Set([herdKey(animal.tx, animal.ty)]),
    };
    expect(dogPlacementProblem(-1, 5, taken)).toBe("off_yard");
    expect(dogPlacementProblem(bed.tx, bed.ty, taken)).toBe("bed");
    expect(dogPlacementProblem(fence.tx, fence.ty, taken)).toBe("fence");
    expect(dogPlacementProblem(animal.tx, animal.ty, taken)).toBe("occupied");
    expect(dogPlacementProblem(free.tx, free.ty, taken)).toBeNull();
  });
});
