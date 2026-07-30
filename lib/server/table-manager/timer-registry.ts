export type TableTimerName =
  | "turn"
  | "showdown"
  | "payout"
  | "restart"
  | "checkpoint";

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Every table timeout is owned here. There are no intervals and no detached
 * timer handles, so hard cleanup can synchronously make a room idle.
 */
export class TimerRegistry {
  private readonly timers = new Map<TableTimerName, TimerHandle>();

  constructor(
    private readonly onError: (name: TableTimerName, error: unknown) => void,
  ) {}

  schedule(
    name: TableTimerName,
    delayMs: number,
    callback: () => void | Promise<void>,
  ): void {
    this.clear(name);
    const handle = setTimeout(() => {
      this.timers.delete(name);
      Promise.resolve(callback()).catch((error) => this.onError(name, error));
    }, Math.max(0, delayMs));
    this.timers.set(name, handle);
  }

  clear(name: TableTimerName): void {
    const handle = this.timers.get(name);
    if (!handle) return;
    clearTimeout(handle);
    this.timers.delete(name);
  }

  clearAll(): void {
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
  }

  has(name: TableTimerName): boolean {
    return this.timers.has(name);
  }

  get size(): number {
    return this.timers.size;
  }
}
