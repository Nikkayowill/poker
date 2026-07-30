import "server-only";
import type { TableCheckpointPort } from "./types";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface DebouncedCheckpointOptions<TState> {
  delayMs?: number;
  cloneState(state: TState): TState;
  write(state: TState): Promise<void>;
  onError(error: unknown): void;
}

/**
 * Coalesces non-critical state persistence without polling. A burst of actions
 * produces one trailing write; flush/halt synchronously take ownership of the
 * pending snapshot before awaiting I/O.
 */
export class DebouncedTableCheckpoint<TState>
  implements TableCheckpointPort<TState>
{
  private readonly delayMs: number;
  private timer: TimerHandle | null = null;
  private pending: TState | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: DebouncedCheckpointOptions<TState>) {
    this.delayMs = options.delayMs ?? 2_000;
  }

  schedule(state: TState): void {
    if (this.stopped) return;
    this.pending = this.options.cloneState(state);
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      const snapshot = this.takePending();
      if (snapshot !== null) {
        void this.queueWrite(snapshot).catch(() => undefined);
      }
    }, Math.max(0, this.delayMs));
  }

  async flush(): Promise<void> {
    this.clearTimer();
    const snapshot = this.takePending();
    if (snapshot !== null) await this.queueWrite(snapshot);
    await this.writeTail;
  }

  async halt(state: TState): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    this.pending = this.options.cloneState(state);
    await this.flush();
  }

  discard(): void {
    this.stopped = true;
    this.clearTimer();
    this.pending = null;
  }

  private queueWrite(snapshot: TState): Promise<void> {
    const result = this.writeTail.then(() => this.options.write(snapshot));
    this.writeTail = result.catch((error) => {
      this.options.onError(error);
    });
    return result;
  }

  private takePending(): TState | null {
    const snapshot = this.pending;
    this.pending = null;
    return snapshot;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
