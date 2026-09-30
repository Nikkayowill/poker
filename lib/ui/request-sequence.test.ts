import { describe, expect, it } from "vitest";
import { createActionQueue, createRequestSequence, type Versioned } from "./request-sequence";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Lets every pending promise callback run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("createRequestSequence reads and writes", () => {
  it("accepts a read nothing overlapped", () => {
    const sequence = createRequestSequence();
    const ticket = sequence.beginRead();
    expect(ticket).not.toBeNull();
    expect(sequence.acceptRead(ticket!)).toBe(true);
  });

  it("drops a poll that left before a write and landed after it finished", () => {
    const sequence = createRequestSequence();
    const ticket = sequence.beginRead()!;
    const done = sequence.beginWrite();
    done();
    expect(sequence.acceptRead(ticket)).toBe(false);
  });

  it("drops a poll that lands while a write is still out", () => {
    const sequence = createRequestSequence();
    const ticket = sequence.beginRead()!;
    sequence.beginWrite();
    expect(sequence.acceptRead(ticket)).toBe(false);
  });

  it("skips starting a read while a write is out", () => {
    const sequence = createRequestSequence();
    const done = sequence.beginWrite();
    expect(sequence.isWriting()).toBe(true);
    expect(sequence.beginRead()).toBeNull();
    done();
    expect(sequence.isWriting()).toBe(false);
    expect(sequence.beginRead()).not.toBeNull();
  });

  it("accepts a read that started after the write finished", () => {
    const sequence = createRequestSequence();
    sequence.beginWrite()();
    const ticket = sequence.beginRead()!;
    expect(sequence.acceptRead(ticket)).toBe(true);
  });

  it("stays writing until every overlapping write is done", () => {
    const sequence = createRequestSequence();
    const first = sequence.beginWrite();
    const second = sequence.beginWrite();
    first();
    expect(sequence.isWriting()).toBe(true);
    second();
    expect(sequence.isWriting()).toBe(false);
  });

  it("ignores a second call to the same done()", () => {
    const sequence = createRequestSequence();
    const first = sequence.beginWrite();
    const second = sequence.beginWrite();
    first();
    first();
    expect(sequence.isWriting()).toBe(true);
    second();
    expect(sequence.isWriting()).toBe(false);
  });

  it("drops an older read that lands after a newer one", () => {
    const sequence = createRequestSequence();
    const older = sequence.beginRead()!;
    const newer = sequence.beginRead()!;
    expect(sequence.acceptRead(newer)).toBe(true);
    expect(sequence.acceptRead(older)).toBe(false);
  });

  it("lets reads that land in order through", () => {
    const sequence = createRequestSequence();
    const older = sequence.beginRead()!;
    const newer = sequence.beginRead()!;
    expect(sequence.acceptRead(older)).toBe(true);
    expect(sequence.acceptRead(newer)).toBe(true);
  });
});

describe("createRequestSequence snapshots", () => {
  const snap = (id: string, version: number) => ({ id, version, label: `${id}@${version}` });

  it("refuses an older copy of the snapshot on screen", () => {
    const sequence = createRequestSequence<ReturnType<typeof snap>>();
    expect(sequence.admit(snap("a", 3))).toBe(true);
    expect(sequence.admit(snap("a", 2))).toBe(false);
    expect(sequence.latest()?.label).toBe("a@3");
    expect(sequence.version()).toBe(3);
  });

  it("takes the same version again and anything newer", () => {
    const sequence = createRequestSequence<ReturnType<typeof snap>>();
    sequence.admit(snap("a", 3));
    expect(sequence.admit(snap("a", 3))).toBe(true);
    expect(sequence.admit(snap("a", 4))).toBe(true);
    expect(sequence.version()).toBe(4);
  });

  it("takes a different attempt even at a lower version", () => {
    const sequence = createRequestSequence<Versioned>();
    sequence.admit({ id: "a", version: 9 });
    expect(sequence.admit({ id: "b", version: 1 })).toBe(true);
    expect(sequence.version()).toBe(1);
  });

  it("clears on null but still refuses an older copy afterwards", () => {
    const sequence = createRequestSequence<Versioned>();
    sequence.admit({ id: "a", version: 5 });
    expect(sequence.admit(null)).toBe(true);
    expect(sequence.latest()).toBeNull();
    expect(sequence.version()).toBe(0);
    expect(sequence.admit({ id: "a", version: 4 })).toBe(false);
  });
});

describe("createActionQueue", () => {
  it("sends one at a time, oldest first", async () => {
    const queue = createActionQueue<string>();
    const gates = [deferred<boolean>(), deferred<boolean>()];
    const started: string[] = [];
    let call = 0;
    const run = (item: string) => {
      started.push(item);
      return gates[call++].promise;
    };

    queue.push("a");
    const draining = queue.drain(run);
    queue.push("b");
    void queue.drain(run);
    await settle();
    expect(started).toEqual(["a"]);

    gates[0].resolve(true);
    await settle();
    expect(started).toEqual(["a", "b"]);

    gates[1].resolve(true);
    await draining;
    expect(queue.pending()).toEqual([]);
  });

  it("keeps a tap made mid-flight instead of dropping it", async () => {
    const queue = createActionQueue<number>();
    const sent: number[] = [];
    const gate = deferred<boolean>();
    const run = async (item: number) => {
      sent.push(item);
      if (item === 1) return gate.promise;
      return true;
    };

    queue.push(1);
    const draining = queue.drain(run);
    queue.push(2);
    void queue.drain(run);
    expect(queue.pending()).toEqual([1, 2]);

    gate.resolve(true);
    await draining;
    expect(sent).toEqual([1, 2]);
  });

  it("drops what is still queued when run says stop", async () => {
    const queue = createActionQueue<string>();
    const sent: string[] = [];
    queue.push("a");
    queue.push("b");
    queue.push("c");
    await queue.drain(async (item) => {
      sent.push(item);
      return item !== "b";
    });
    expect(sent).toEqual(["a", "b"]);
    expect(queue.pending()).toEqual([]);
  });

  it("treats a throw as a stop", async () => {
    const queue = createActionQueue<string>();
    queue.push("a");
    queue.push("b");
    await queue.drain(async () => {
      throw new Error("offline");
    });
    expect(queue.pending()).toEqual([]);
  });

  it("holds one write open for the whole drain", async () => {
    const sequence = createRequestSequence();
    const queue = createActionQueue<string>({ sequence });
    const gate = deferred<boolean>();
    queue.push("a");
    queue.push("b");
    const ticket = sequence.beginRead()!;
    const draining = queue.drain(async (item) => (item === "a" ? gate.promise : true));

    expect(sequence.isWriting()).toBe(true);
    expect(sequence.beginRead()).toBeNull();
    gate.resolve(true);
    await draining;
    expect(sequence.isWriting()).toBe(false);
    // The poll that left before the drain can't paint over it.
    expect(sequence.acceptRead(ticket)).toBe(false);
  });

  it("reports every change to the pending list", async () => {
    const seen: string[][] = [];
    const queue = createActionQueue<string>({ onChange: (pending) => seen.push([...pending]) });
    queue.push("a");
    queue.push("b");
    await queue.drain(async () => true);
    expect(seen).toEqual([["a"], ["a", "b"], ["b"], []]);
  });

  it("carries on with items pushed after a clear mid-flight", async () => {
    const queue = createActionQueue<string>();
    const sent: string[] = [];
    const gate = deferred<boolean>();
    queue.push("a");
    queue.push("b");
    const draining = queue.drain(async (item) => {
      sent.push(item);
      return item === "a" ? gate.promise : true;
    });
    queue.clear();
    queue.push("c");
    gate.resolve(true);
    await draining;
    expect(sent).toEqual(["a", "c"]);
    expect(queue.pending()).toEqual([]);
  });
});
