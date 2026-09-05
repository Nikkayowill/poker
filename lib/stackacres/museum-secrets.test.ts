import { describe, expect, it } from "vitest";
import {
  SECRET_ARTIFACTS,
  SECRET_JOKE_ARTIFACTS,
  SECRET_MUSEUM_ITEM_CATALOGUE,
  emptySecretMuseumRegistry,
  isSecretArtifact,
  isSecretJokeArtifact,
  museumGlowTier,
  rollSecretArtifact,
  secretHiddenSetComplete,
  secretsFoundCount,
  type SecretMuseumItemId,
} from "./museum-secrets";

function fixed(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("SECRET_MUSEUM_ITEM_CATALOGUE", () => {
  it("has one entry per core artifact and per joke artifact, no more, no less", () => {
    const ids = Object.keys(SECRET_MUSEUM_ITEM_CATALOGUE) as SecretMuseumItemId[];
    expect(ids.sort()).toEqual([...SECRET_ARTIFACTS, ...SECRET_JOKE_ARTIFACTS].sort());
  });

  it("classifies every id as exactly one of core or joke", () => {
    for (const item of SECRET_ARTIFACTS) {
      expect(isSecretArtifact(item)).toBe(true);
      expect(isSecretJokeArtifact(item)).toBe(false);
    }
    for (const item of SECRET_JOKE_ARTIFACTS) {
      expect(isSecretJokeArtifact(item)).toBe(true);
      expect(isSecretArtifact(item)).toBe(false);
    }
  });
});

describe("emptySecretMuseumRegistry / secretHiddenSetComplete / secretsFoundCount", () => {
  it("starts with nothing found", () => {
    const registry = emptySecretMuseumRegistry();
    expect(secretHiddenSetComplete(registry)).toBe(false);
    expect(secretsFoundCount(registry)).toBe(0);
  });

  it("is complete only once every CORE item is true; joke finds don't count", () => {
    const registry = { ...emptySecretMuseumRegistry(), ...Object.fromEntries(SECRET_JOKE_ARTIFACTS.map((i) => [i, true])) };
    expect(secretHiddenSetComplete(registry)).toBe(false);
    expect(secretsFoundCount(registry)).toBe(0);

    const partial = { ...registry, [SECRET_ARTIFACTS[0]]: true };
    expect(secretHiddenSetComplete(partial)).toBe(false);
    expect(secretsFoundCount(partial)).toBe(1);

    const complete = { ...registry, ...Object.fromEntries(SECRET_ARTIFACTS.map((i) => [i, true])) };
    expect(secretHiddenSetComplete(complete)).toBe(true);
    expect(secretsFoundCount(complete)).toBe(SECRET_ARTIFACTS.length);
  });

  it("treats a missing key as not-found rather than throwing", () => {
    const sparse = {} as Record<string, boolean>;
    expect(secretHiddenSetComplete(sparse as never)).toBe(false);
    expect(secretsFoundCount(sparse as never)).toBe(0);
  });
});

describe("rollSecretArtifact", () => {
  it("never rolls above the base tiers' floor rate", () => {
    // 0.001 is the lowest configured rate (trowel, no crit); a roll just
    // under it hits, just at or over it misses.
    expect(rollSecretArtifact("trowel", false, fixed(0.0009))).not.toBeNull();
    expect(rollSecretArtifact("trowel", false, fixed(0.001))).toBeNull();
  });

  it("a crit always rolls at least as generously as that tier's own base rate", () => {
    for (const tier of ["trowel", "iron-shovel", "golden-spade"] as const) {
      const roll = (isCrit: boolean, p: number) => rollSecretArtifact(tier, isCrit, fixed(p, 0.99));
      // Any p that hits on base must also hit on crit.
      const justUnderBase = 0.0005;
      if (roll(false, justUnderBase)) expect(roll(true, justUnderBase)).not.toBeNull();
    }
  });

  it("the Golden Spade's own crit rate is exactly 1.5%, the brief's own quoted ceiling", () => {
    expect(rollSecretArtifact("golden-spade", true, fixed(0.0149, 0.99))).not.toBeNull();
    expect(rollSecretArtifact("golden-spade", true, fixed(0.015, 0.99))).toBeNull();
  });

  it("a successful roll always returns a real catalogue id", () => {
    for (const jokeShare of [0, 0.99]) {
      const hit = rollSecretArtifact("golden-spade", true, fixed(0, jokeShare, 0));
      expect(hit).not.toBeNull();
      expect(hit! in SECRET_MUSEUM_ITEM_CATALOGUE).toBe(true);
    }
  });

  it("is a pure function of its inputs -- same random sequence, same answer", () => {
    const a = rollSecretArtifact("iron-shovel", true, fixed(0.001, 0.5, 0.5));
    const b = rollSecretArtifact("iron-shovel", true, fixed(0.001, 0.5, 0.5));
    expect(a).toBe(b);
  });

  it("defaults to Math.random when no source is given, and stays within the catalogue over many rolls", () => {
    for (let i = 0; i < 200; i += 1) {
      const hit = rollSecretArtifact("golden-spade", true);
      if (hit !== null) expect(hit in SECRET_MUSEUM_ITEM_CATALOGUE).toBe(true);
    }
  });
});

describe("museumGlowTier", () => {
  it("is none when the regular exhibits are full and the secret wing hasn't started", () => {
    expect(
      museumGlowTier({ regularUndonatedCount: 0, secretsFound: 0, secretsTotal: 3, hasGoldenSpade: false }),
    ).toBe("none");
  });

  it("is ambient when a regular exhibit is still unfound, even with no golden spade", () => {
    expect(
      museumGlowTier({ regularUndonatedCount: 1, secretsFound: 0, secretsTotal: 3, hasGoldenSpade: false }),
    ).toBe("ambient");
  });

  it("is ambient on partial secret progress without the golden spade", () => {
    expect(
      museumGlowTier({ regularUndonatedCount: 0, secretsFound: 1, secretsTotal: 3, hasGoldenSpade: false }),
    ).toBe("ambient");
  });

  it("is progression once the golden spade is held and the secret wing is incomplete", () => {
    expect(
      museumGlowTier({ regularUndonatedCount: 0, secretsFound: 0, secretsTotal: 3, hasGoldenSpade: true }),
    ).toBe("progression");
    expect(
      museumGlowTier({ regularUndonatedCount: 3, secretsFound: 1, secretsTotal: 3, hasGoldenSpade: true }),
    ).toBe("progression");
  });

  it("goes quiet once the secret wing is fully complete, golden spade or not", () => {
    expect(
      museumGlowTier({ regularUndonatedCount: 0, secretsFound: 3, secretsTotal: 3, hasGoldenSpade: true }),
    ).toBe("none");
  });
});
