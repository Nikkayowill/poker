import "server-only";

/**
 * A tiny in-process "cached until stale" holder.
 *
 * Server stores each grew their own copy of this exact shape (`{ at, value }`
 * plus a manual `now - at > ttlMs` check): mission-store.ts's and
 * achievement-store.ts's catalog reads. Both are read-mostly, in-process,
 * single-value caches with no shared-invalidation needs -- a real distributed
 * cache would be the wrong tool for either. This is the one copy; a future fix (stale-on-error
 * fallback, a concurrent-miss race) only has to land here.
 */
export interface TtlCache<T> {
  /** The cached value if it's still within `ttlMs` of when it was set, else null. */
  read(now?: number): T | null;
  write(value: T, now?: number): void;
  /** Test seam: forces the next read() to miss. */
  reset(): void;
}

export function createTtlCache<T>(ttlMs: number): TtlCache<T> {
  let cached: { at: number; value: T } | null = null;
  return {
    read(now = Date.now()) {
      if (!cached || now - cached.at >= ttlMs) return null;
      return cached.value;
    },
    write(value, now = Date.now()) {
      cached = { at: now, value };
    },
    reset() {
      cached = null;
    },
  };
}
