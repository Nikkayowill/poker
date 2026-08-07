import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRewardEventsForTest, onRewardTrigger, publishOutOfGold, publishRewardTrigger } from "./events";
import type { RewardTrigger } from "./triggers";

const OFFER: RewardTrigger = { kind: "big-pot", headline: "Big pot", detail: "Nice." };

beforeEach(() => {
  __resetRewardEventsForTest();
});

describe("reward events", () => {
  it("delivers a trigger to every subscriber", () => {
    const first = vi.fn();
    const second = vi.fn();
    onRewardTrigger(first);
    onRewardTrigger(second);

    expect(publishRewardTrigger(OFFER)).toBe(true);
    expect(first).toHaveBeenCalledWith(OFFER);
    expect(second).toHaveBeenCalledWith(OFFER);
  });

  it("delivers each kind once per session", () => {
    // A page that publishes from a render -- which is the natural way to write
    // "the player has no Gold left" -- must not be able to reopen the modal in
    // a loop.
    const listener = vi.fn();
    onRewardTrigger(listener);

    expect(publishRewardTrigger(OFFER)).toBe(true);
    expect(publishRewardTrigger(OFFER)).toBe(false);
    expect(publishRewardTrigger({ ...OFFER, detail: "Different words, same kind." })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onRewardTrigger(listener);
    unsubscribe();

    publishRewardTrigger(OFFER);
    expect(listener).not.toHaveBeenCalled();
  });

  it("publishes the out-of-gold offer under the low-gold kind", () => {
    const listener = vi.fn();
    onRewardTrigger(listener);

    publishOutOfGold("You need 1,000 Gold to sit down.");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "low-gold", detail: "You need 1,000 Gold to sit down." }),
    );
  });

  it("does not throw when nobody is listening", () => {
    // The arcade pages publish whether or not poker-app.tsx is mounted.
    expect(() => publishRewardTrigger(OFFER)).not.toThrow();
  });
});
