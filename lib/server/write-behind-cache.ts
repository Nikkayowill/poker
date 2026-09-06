import "server-only";

/**
 * Generic in-memory write-behind cache: `set()` updates local memory
 * instantly and returns without awaiting anything; the actual persistence
 * call is debounced and coalesced into a batched flush a few seconds later,
 * so a burst of rapid mutations to the same key costs one network write
 * instead of one per mutation.
 *
 * WHERE THIS IS SAFE TO USE, AND WHERE IT IS NOT
 * ------------------------------------------------------------------------
 * StackChips is served from Vercel serverless functions (see vercel.json's
 * cron config and `next start`), not one long-running process. A pending
 * timer here only survives as long as ITS function instance stays warm --
 * if the instance freezes or gets recycled before the timer fires, whatever
 * hasn't flushed yet is silently lost. That makes this the wrong tool for
 * any write covered by this codebase's money-ordering rules (see root
 * CLAUDE.md): a Gold credit/debit, an inventory adjustment, a
 * version-guarded settlement -- anywhere losing the last few seconds of
 * writes on a cold instance would be a real bug, not a cosmetic hiccup.
 * Use this ONLY for state that is genuinely fine to lose a few seconds of
 * on a rare instance recycle -- a draft/UI-only value, a "last viewed X"
 * cursor, telemetry -- never anything `spendGold`/`creditGold`/
 * `adjustStackAcresInventory`-adjacent or anything a version column guards.
 *
 * Each serverless instance also holds its OWN copy of a cache built from
 * this class (same as every other store's globalThis Map in this
 * codebase) -- two concurrent requests landing on two different instances
 * debounce independently, so this is last-write-wins ACROSS instances too,
 * not a single global debounce window. The `flush` callback passed in
 * should be a plain upsert of the latest value, not something that assumes
 * it is the only writer racing itself.
 *
 * CONCURRENCY WITHIN ONE INSTANCE: Node is single-threaded, so there is no
 * data race in the C/Java sense -- what actually needs guarding is
 * reentrancy across `await` points:
 *  - `get`/`set`/`discard` never await, so two calls can never interleave
 *    mid-update.
 *  - A `set()` on a key that is mid-flush is never lost: a flush cycle
 *    reads each dirty key's CURRENT value out of the store at the moment it
 *    flushes, not the value at the moment the key was marked dirty, so the
 *    newest write always wins and a superseded value is never sent over the
 *    wire.
 *  - Only one flush cycle runs at a time (`flushing` below); a `set()` that
 *    lands mid-cycle re-dirties its key so it is picked up by the NEXT
 *    cycle rather than racing the one already in flight.
 *  - A flush that throws re-dirties its key for the next cycle instead of
 *    dropping the write, and reports the error via `onFlushError` rather
 *    than throwing out of `set()` (which is fire-and-forget by design).
 */

export interface WriteBehindCacheOptions<K, V> {
  /** How long to coalesce rapid writes before flushing, in ms. Default 3000
   *  ("every few seconds"), matching this cache's stated purpose. */
  flushIntervalMs?: number;
  /** Persist one key's current value. Called once per dirty key per flush
   *  cycle, in no particular order. Throwing re-dirties the key for retry
   *  on the next cycle rather than losing the write. */
  flush: (key: K, value: V) => Promise<void>;
  /** Observability hook -- a flush failure never throws out of `set()`, so
   *  without this a repeated failure is otherwise silent until the key
   *  eventually succeeds. */
  onFlushError?: (key: K, value: V, error: unknown) => void;
}

export class WriteBehindCache<K, V> {
  private readonly store = new Map<K, V>();
  private readonly dirty = new Set<K>();
  private readonly flushIntervalMs: number;
  private readonly flushOne: (key: K, value: V) => Promise<void>;
  private readonly onFlushError?: (key: K, value: V, error: unknown) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(options: WriteBehindCacheOptions<K, V>) {
    this.flushIntervalMs = options.flushIntervalMs ?? 3000;
    this.flushOne = options.flush;
    this.onFlushError = options.onFlushError;
  }

  /** Instant, memory-only read of the latest value this instance has seen
   *  for `key` -- including anything set() but not yet flushed. */
  get(key: K): V | undefined {
    return this.store.get(key);
  }

  /** Instant, memory-only write. Never awaits or throws; the corresponding
   *  network write is scheduled for the next debounce window. */
  set(key: K, value: V): void {
    this.store.set(key, value);
    this.dirty.add(key);
    this.scheduleFlush();
  }

  /** Drops a key from memory without flushing it -- for state that turned
   *  out not to need persisting after all (e.g. a draft the player
   *  discarded before the debounce window closed). */
  discard(key: K): void {
    this.store.delete(key);
    this.dirty.delete(key);
  }

  /** True if `key` has been set() since its last successful flush. */
  isDirty(key: K): boolean {
    return this.dirty.has(key);
  }

  /** Forces an immediate flush of everything currently dirty, bypassing the
   *  debounce window. Call this before ending a response you know is the
   *  last write for a while (this narrows, but per this file's own header
   *  does not eliminate, the cold-instance loss window), or from a test
   *  that needs to assert on the persisted side without waiting out the
   *  timer. */
  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.runFlushCycle();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runFlushCycle();
    }, this.flushIntervalMs);
  }

  private async runFlushCycle(): Promise<void> {
    if (this.flushing) {
      // A cycle is already running (e.g. flushNow() raced the timer) --
      // piggyback on it instead of starting a second overlapping cycle.
      await this.flushing;
      return;
    }

    const keys = Array.from(this.dirty);
    this.dirty.clear();

    this.flushing = (async () => {
      for (const key of keys) {
        const value = this.store.get(key);
        if (value === undefined) continue; // discarded since it was marked dirty
        try {
          await this.flushOne(key, value);
        } catch (error) {
          this.dirty.add(key); // retry next cycle rather than lose it
          this.onFlushError?.(key, value, error);
        }
      }
    })();

    try {
      await this.flushing;
    } finally {
      this.flushing = null;
      if (this.dirty.size > 0) this.scheduleFlush();
    }
  }
}
