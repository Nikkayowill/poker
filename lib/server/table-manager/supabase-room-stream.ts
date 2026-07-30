import "server-only";
import type {
  RealtimeChannel,
  RealtimeChannelSendResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import type { TableRoomEvent, TableRoomStream } from "./types";

const SUBSCRIBE_TIMEOUT_MS = 10_000;

/**
 * One WebSocket channel per live table. It publishes in-memory state events
 * directly; it never polls or writes a notification row to Postgres.
 */
export class SupabaseRoomStream<TPublicState>
  implements TableRoomStream<TPublicState>
{
  private channel: RealtimeChannel | null = null;
  private openPromise: Promise<void> | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly tableId: string,
  ) {}

  open(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    const opening = new Promise<void>((resolve, reject) => {
      const channel = this.client.channel(`table:${this.tableId}`, {
        config: { private: false },
      });
      this.channel = channel;
      let finished = false;
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (this.channel === channel) this.channel = null;
        void this.client
          .removeChannel(channel)
          .catch(() => undefined)
          .finally(() => reject(error));
      };
      const timeout = setTimeout(() => {
        fail(new Error(`Realtime room ${this.tableId} did not subscribe.`));
      }, SUBSCRIBE_TIMEOUT_MS);

      channel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          fail(error ?? new Error(`Realtime room ${this.tableId} failed: ${status}.`));
        }
      });
    });
    const tracked = opening.catch((error) => {
      if (this.openPromise === tracked) this.openPromise = null;
      throw error;
    });
    this.openPromise = tracked;
    return tracked;
  }

  async publish(event: TableRoomEvent<TPublicState>): Promise<void> {
    await this.open();
    const channel = this.channel;
    if (!channel) {
      throw new Error(`Realtime room ${this.tableId} was closed before publish.`);
    }
    const response: RealtimeChannelSendResponse = await channel.send({
      type: "broadcast",
      event: event.type,
      payload: event,
    });
    if (response !== "ok") {
      throw new Error(`Realtime publish failed for ${this.tableId}: ${response}.`);
    }
  }

  async close(): Promise<void> {
    const channel = this.channel;
    this.channel = null;
    this.openPromise = null;
    if (!channel) return;
    await this.client.removeChannel(channel);
  }
}

/** Useful for local tests and explicitly configured single-process demos. */
export class NoopRoomStream<TPublicState>
  implements TableRoomStream<TPublicState>
{
  async open(): Promise<void> {}
  async publish(): Promise<void> {}
  async close(): Promise<void> {}
}
