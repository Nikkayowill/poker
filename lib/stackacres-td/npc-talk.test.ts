import { describe, expect, it } from "vitest";
import { seededRandom } from "./npc-routine";
import { allLines, composeChat, pairKeys, talkers } from "./npc-talk";

describe("npc chat lines", () => {
  it("fit a small bubble and are plain punctuation", () => {
    for (const { who, topic, text } of allLines()) {
      expect(text.length, `${who} ${topic}: ${text}`).toBeLessThanOrEqual(48);
      expect(text, `${who} ${topic}`).not.toMatch(/[—–]/);
    }
  });

  it("has a voice for every topic for everyone who talks", () => {
    for (const who of talkers()) expect(allLines().filter((line) => line.who === who && line.topic !== "pair").length).toBeGreaterThanOrEqual(7 * 4 + 3);
  });

  it("gives every pair a chat of two or three lines from the two of them, in order", () => {
    const names = talkers();
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        for (let seed = 0; seed < 20; seed++) {
          const chat = composeChat(a, b, 12, seededRandom(seed))!;
          expect(chat.lines.length).toBeGreaterThanOrEqual(2);
          expect(chat.lines.length).toBeLessThanOrEqual(3);
          expect(new Set(chat.lines.map((line) => line.who))).toEqual(new Set([a, b]));
          expect(chat.lines[0].who).not.toBe(chat.lines[1].who);
          for (let i = 1; i < chat.lines.length; i++) expect(chat.lines[i].at).toBeGreaterThan(chat.lines[i - 1].at);
          expect(chat.duration).toBeGreaterThan(chat.lines.at(-1)!.at);
        }
      }
    }
  });

  it("has something of its own for every pair of people", () => {
    const names = talkers();
    const expected = names.flatMap((a) => names.filter((b) => a < b).map((b) => `${a}|${b}`));
    expect([...pairKeys()].sort()).toEqual(expected.sort());
  });

  it("uses a pair's own exchange about half the time, never twice running, and only the pair's own two voices", () => {
    let paired = 0;
    for (let seed = 0; seed < 200; seed++) {
      const chat = composeChat("pierre", "ray", 12, seededRandom(seed))!;
      if (chat.topic === "pair") paired += 1;
      expect(composeChat("pierre", "ray", 12, seededRandom(seed), "pair")!.topic).not.toBe("pair");
    }
    expect(paired).toBeGreaterThan(60);
    expect(paired).toBeLessThan(140);
  });

  it("does not repeat the last topic, and keeps supper for the day", () => {
    for (let seed = 0; seed < 60; seed++) {
      expect(composeChat("ray", "ivy", 12, seededRandom(seed), "hens")!.topic).not.toBe("hens");
      expect(composeChat("ray", "ivy", 6, seededRandom(seed))!.topic).not.toBe("supper");
    }
  });

  it("is the same chat for the same seed, and says nothing for someone with no voice", () => {
    expect(composeChat("ray", "pierre", 9, seededRandom(4))).toEqual(composeChat("ray", "pierre", 9, seededRandom(4)));
    expect(composeChat("ray", "stranger", 9, seededRandom(4))).toBeNull();
  });
});
