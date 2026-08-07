import type { RewardTrigger, RewardTriggerKind } from "./triggers";

/**
 * A one-line pub/sub so anything can ask for the reward offer.
 *
 * advanceRewardWatch covers the poker table, because the table has a snapshot
 * to diff. Nothing else in this app does: /games/blackjack and /games/hi-lo
 * are their own pages with their own state, and "I just lost my last stake at
 * Blackjack" is the single most obvious moment to offer a top-up. Wiring those
 * pages to the modal directly would mean each one importing the modal, the
 * fetch, and the grant lifecycle -- three copies of a money path.
 *
 * So they publish an event instead and know nothing else. components/rewards/
 * use-game-achievements.ts is the only subscriber today, and the fact that it
 * *could* have others is the point: the emitter is what keeps the trigger side
 * and the reward side from having to know each other exists.
 *
 * Deliberately not an EventTarget and deliberately not React context. No DOM,
 * so `npm test` reaches it (vitest.config.ts collects lib/ and app/ only); no
 * provider, so a page that lives outside components/poker-app.tsx's tree can
 * still publish. The cost is that it is a module singleton -- see the reset
 * seam at the bottom, which exists for the same reason blackjack-store's does.
 */

type RewardListener = (trigger: RewardTrigger) => void;

const listeners = new Set<RewardListener>();

/**
 * Kinds already published in this browser session.
 *
 * Same one-prompt-per-kind rule advanceRewardWatch enforces through its
 * `offered` list, applied here too rather than only in the subscriber: a page
 * that publishes on every render of an empty wallet -- which is the natural
 * way to write it -- must not be able to reopen the modal in a loop.
 */
const published = new Set<RewardTriggerKind>();

/** Subscribes to reward triggers. Returns the unsubscribe, for a useEffect cleanup. */
export function onRewardTrigger(listener: RewardListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announces a moment worth offering a reward for.
 *
 * Returns whether it was delivered: false means this kind has already been
 * offered this session, which is not an error and needs no handling.
 */
export function publishRewardTrigger(trigger: RewardTrigger): boolean {
  if (published.has(trigger.kind)) return false;
  published.add(trigger.kind);
  for (const listener of listeners) listener(trigger);
  return true;
}

/**
 * The standing offer for a player who cannot afford anything.
 *
 * Named rather than left as a literal at each call site because the copy is
 * the product: three pages writing their own wording is three chances for one
 * of them to promise something the server does not pay.
 */
export function publishOutOfGold(shortfallLabel: string): boolean {
  return publishRewardTrigger({
    kind: "low-gold",
    headline: "Short of a buy-in",
    detail: shortfallLabel,
  });
}

/** Test seam only: the registry is a module singleton, so suites must not leak into each other. */
export function __resetRewardEventsForTest(): void {
  listeners.clear();
  published.clear();
}
