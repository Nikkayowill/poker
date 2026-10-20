import { describe, expect, it } from "vitest";
import { WORD_STACK_ANSWERS } from "./word-stack-answers";
import { hardWordPool, wordStackDifficulty, wordStackHardAnswers } from "./word-stack-hard-answers";

describe("wordStackDifficulty", () => {
  it("rates a word with many look-alikes above one with none", () => {
    const pool = ["light", "might", "night", "sight", "tight", "plumb"];
    expect(wordStackDifficulty("tight", pool)).toBeGreaterThan(wordStackDifficulty("plumb", pool));
  });

  it("adds for repeated letters", () => {
    const pool = ["sheep", "shape", "crown"];
    expect(wordStackDifficulty("sheep", pool)).toBeGreaterThan(wordStackDifficulty("shape", pool));
  });
});

describe("hardWordPool", () => {
  it("keeps the hardest words first, and only words from the pool", () => {
    const pool = ["light", "might", "night", "plumb", "crown", "dwarf", "spoke", "quilt"];
    const hard = hardWordPool(pool, 3);
    expect(hard).toHaveLength(1);
    expect(["light", "might", "night"]).toContain(hard[0]);
  });
});

describe("wordStackHardAnswers", () => {
  it("draws every tier from the answer list, so no hard word is obscure", () => {
    for (const tier of [1, 2, 3] as const) {
      for (const word of wordStackHardAnswers(tier)) expect(WORD_STACK_ANSWERS).toContain(word);
    }
  });

  it("narrows by tier: each harder tier is a smaller slice of the one below", () => {
    const [one, two, three] = ([1, 2, 3] as const).map(wordStackHardAnswers);
    expect(one.length).toBeGreaterThan(two.length);
    expect(two.length).toBeGreaterThan(three.length);
    expect(three.length).toBeGreaterThan(30);
    for (const word of three) expect(two).toContain(word);
    for (const word of two) expect(one).toContain(word);
  });

  it("puts the classic look-alike traps in the top tier", () => {
    const top = wordStackHardAnswers(3);
    for (const word of ["tight", "sound", "share"]) expect(top).toContain(word);
  });
});
