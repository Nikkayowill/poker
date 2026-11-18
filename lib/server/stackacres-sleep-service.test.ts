import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { NOT_SLEEPY, STACKACRES_DAY_MS, STACKACRES_HOUR_MS, WAKE_HOUR, gameHourAt } from "@/lib/stackacres/clock";
import { ensureProfile } from "./profile-store";
import { __resetStackAcresClockForTest, writeStackAcresClockOffset } from "./stackacres-clock-store";
import { insertStackAcresHiredHand } from "./stackacres-hired-hand-store";
import { beginStackAcresDay, readStackAcres, sleepStackAcres } from "./stackacres-service";
import { __resetStackAcresForTest } from "./stackacres-store";

/** A real moment that is `hour` o'clock on a farm that has never slept. */
const at = (hour: number) => new Date(2_000 * STACKACRES_DAY_MS + hour * STACKACRES_HOUR_MS);

async function newFarm(): Promise<string> {
  const token = randomUUID();
  await ensureProfile(token);
  return token;
}

describe("sleeping in the farmhouse bed", () => {
  beforeEach(() => {
    __resetStackAcresForTest();
    __resetStackAcresClockForTest();
  });

  it("reads the clock with no offset and the server's own now", async () => {
    const token = await newFarm();
    const now = at(9);
    const view = await readStackAcres(token, now);
    expect(view.clock).toEqual({ offsetMs: 0, serverNowMs: now.getTime(), fresh: true });
  });

  it("wakes at exactly 6 AM when slept at night", async () => {
    for (const hour of [18, 22, 3]) {
      const token = await newFarm();
      const now = at(hour);
      const view = await sleepStackAcres(token, now);
      expect(gameHourAt(view.clock.serverNowMs, view.clock.offsetMs)).toBe(WAKE_HOUR);
      expect((await readStackAcres(token, now)).clock.offsetMs).toBe(view.clock.offsetMs);
    }
  });

  it("changes nothing but the clock", async () => {
    const token = await newFarm();
    const now = at(22);
    const before = await readStackAcres(token, now);
    const after = await sleepStackAcres(token, now);
    expect(after.profile.goldBalance).toBe(before.profile.goldBalance);
    expect(after.energy).toEqual(before.energy);
    expect(after.units).toEqual(before.units);
    expect(after.clock.offsetMs).toBe(8 * STACKACRES_HOUR_MS);
  });

  it("refuses by day with the friendly line", async () => {
    const token = await newFarm();
    await expect(sleepStackAcres(token, at(12))).rejects.toThrow(NOT_SLEEPY);
    expect((await readStackAcres(token, at(12))).clock.offsetMs).toBe(0);
  });

  it("refuses a second sleep right after, because it is morning", async () => {
    const token = await newFarm();
    const now = at(23);
    const first = await sleepStackAcres(token, now);
    await expect(sleepStackAcres(token, new Date(now.getTime() + 1_000))).rejects.toThrow(NOT_SLEEPY);
    expect((await readStackAcres(token, now)).clock.offsetMs).toBe(first.clock.offsetMs);
  });

  it("lets only one of two racing sleeps move the clock", async () => {
    const token = await newFarm();
    const now = at(20);
    const results = await Promise.allSettled([sleepStackAcres(token, now), sleepStackAcres(token, now)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await readStackAcres(token, now)).clock.offsetMs).toBe(10 * STACKACRES_HOUR_MS);
  });

  it("only writes over the offset it read", async () => {
    const profile = await ensureProfile(randomUUID());
    expect(await writeStackAcresClockOffset(profile.id, 0, 100, at(20))).toBe(true);
    expect(await writeStackAcresClockOffset(profile.id, 0, 200, at(20))).toBe(false);
    expect(await writeStackAcresClockOffset(profile.id, 100, 200, at(20))).toBe(true);
  });
});

describe("a new farm's first morning", () => {
  beforeEach(() => {
    __resetStackAcresForTest();
    __resetStackAcresClockForTest();
  });

  it("starts at 6 AM whatever time of day the player arrives", async () => {
    for (const hour of [0, 5.9, 6, 12, 18, 23.5]) {
      const token = await newFarm();
      const now = at(hour);
      const view = await beginStackAcresDay(token, now);
      expect(gameHourAt(view.clock.serverNowMs, view.clock.offsetMs)).toBeCloseTo(WAKE_HOUR, 5);
      expect(view.clock.fresh).toBe(false);
      expect((await readStackAcres(token, now)).clock.offsetMs).toBe(view.clock.offsetMs);
    }
  });

  it("is written once, so a second call or another tab leaves the morning alone", async () => {
    const token = await newFarm();
    const first = await beginStackAcresDay(token, at(20));
    const again = await beginStackAcresDay(token, at(21));
    expect(again.clock.offsetMs).toBe(first.clock.offsetMs);
  });

  it("leaves a farm that has already slept as it is", async () => {
    const token = await newFarm();
    const slept = await sleepStackAcres(token, at(22));
    const view = await beginStackAcresDay(token, at(23));
    expect(view.clock.offsetMs).toBe(slept.clock.offsetMs);
  });

  it("never moves the clock under a hired hand, whose wage is paid by game day", async () => {
    const token = randomUUID();
    const profile = await ensureProfile(token);
    await insertStackAcresHiredHand(profile.id, "Earl", 2_000, at(10));
    expect((await readStackAcres(token, at(20))).clock.fresh).toBe(false);
    expect((await beginStackAcresDay(token, at(20))).clock.offsetMs).toBe(0);
  });
});
