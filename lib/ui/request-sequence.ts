/**
 * Ordering rules for a screen that polls and also posts actions. A poll that
 * left before an action and lands after it carries the older board, so it
 * must not be painted.
 */

/** The shape every arcade attempt, duel match and lobby table shares. */
export interface Versioned {
  readonly id: string;
  readonly version: number;
}

/** Handed out when a read starts, and handed back when it lands. */
export interface ReadTicket {
  readonly id: number;
  readonly generation: number;
}

export interface RequestSequence<S extends Versioned = Versioned> {
  /** Starts a read. Null while a write is out, so the caller can skip the fetch. */
  beginRead(): ReadTicket | null;
  /** False if a write started or finished while this read was out, or a later read already landed. */
  acceptRead(ticket: ReadTicket): boolean;
  /** Starts a write, which makes every read already out stale. Call the result once it settles. */
  beginWrite(): () => void;
  isWriting(): boolean;
  /** False if `next` is an older copy of the snapshot already taken. Otherwise records it as the latest. */
  admit(next: S | null | undefined): boolean;
  latest(): S | null;
  /** The latest version let through, or 0. What a queued action pins itself to. */
  version(): number;
}

export function createRequestSequence<S extends Versioned = Versioned>(): RequestSequence<S> {
  let generation = 0;
  let writes = 0;
  let nextReadId = 0;
  let lastAcceptedRead = 0;
  // Kept apart from `latest` so clearing the screen doesn't let an older copy back in.
  let seenId: string | null = null;
  let seenVersion = 0;
  let latest: S | null = null;

  return {
    beginRead() {
      if (writes > 0) return null;
      nextReadId += 1;
      return { id: nextReadId, generation };
    },
    acceptRead(ticket) {
      if (writes > 0 || ticket.generation !== generation || ticket.id <= lastAcceptedRead) return false;
      lastAcceptedRead = ticket.id;
      return true;
    },
    beginWrite() {
      writes += 1;
      generation += 1;
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        writes -= 1;
        // Bumped again on the way out: a read that started mid-write may have seen the old board.
        generation += 1;
      };
    },
    isWriting() {
      return writes > 0;
    },
    admit(next) {
      if (!next) {
        latest = null;
        return true;
      }
      if (next.id === seenId && next.version < seenVersion) return false;
      seenId = next.id;
      seenVersion = next.version;
      latest = next;
      return true;
    },
    latest() {
      return latest;
    },
    version() {
      return latest?.version ?? 0;
    },
  };
}

export interface ActionQueue<T> {
  push(item: T): void;
  /** Drops everything not yet sent. The one already on the wire still lands. */
  clear(): void;
  pending(): readonly T[];
  /**
   * Sends queued items one at a time, oldest first. A no-op if a drain is
   * already running, since that one picks new items up. `run` returns false
   * to drop everything still queued.
   */
  drain(run: (item: T) => Promise<boolean>): Promise<void>;
}

/**
 * Taps made while an earlier one is still on the wire, sent in order instead
 * of dropped. Serial because each action is pinned to the version before it.
 * The drain holds one write open the whole time so no poll lands in between.
 */
export function createActionQueue<T>(
  options: { sequence?: Pick<RequestSequence, "beginWrite">; onChange?: (pending: readonly T[]) => void } = {},
): ActionQueue<T> {
  let items: readonly T[] = [];
  let draining = false;

  const set = (next: readonly T[]) => {
    items = next;
    options.onChange?.(items);
  };

  return {
    push(item) {
      set([...items, item]);
    },
    clear() {
      if (items.length > 0) set([]);
    },
    pending() {
      return items;
    },
    async drain(run) {
      if (draining) return;
      draining = true;
      const done = options.sequence?.beginWrite();
      try {
        while (items.length > 0) {
          const item = items[0];
          let keepGoing = false;
          try {
            keepGoing = await run(item);
          } catch {
            keepGoing = false;
          }
          if (!keepGoing) {
            set([]);
            return;
          }
          // Found again rather than assumed first, since clear() may have run while it was out.
          const at = items.indexOf(item);
          if (at >= 0) set([...items.slice(0, at), ...items.slice(at + 1)]);
        }
      } finally {
        draining = false;
        done?.();
      }
    },
  };
}
