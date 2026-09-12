import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetStackAcresRevisionsForTest,
  bumpStackAcresRevision,
  readStackAcresRevision,
} from "./stackacres-revision-store";

beforeEach(() => {
  __resetStackAcresRevisionsForTest();
});

describe("stackacres revision store", () => {
  it("starts at 0 for a profile nothing has bumped yet", async () => {
    expect(await readStackAcresRevision("p1")).toBe(0);
  });

  it("bumps by exactly one and hands back the new value", async () => {
    expect(await bumpStackAcresRevision("p1")).toBe(1);
    expect(await bumpStackAcresRevision("p1")).toBe(2);
    expect(await bumpStackAcresRevision("p1")).toBe(3);
    expect(await readStackAcresRevision("p1")).toBe(3);
  });

  it("keeps one profile's count clear of another's", async () => {
    await bumpStackAcresRevision("p1");
    await bumpStackAcresRevision("p1");
    await bumpStackAcresRevision("p2");

    expect(await readStackAcresRevision("p1")).toBe(2);
    expect(await readStackAcresRevision("p2")).toBe(1);
  });
});
