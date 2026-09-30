import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Keeps a screen fresh from a ping channel with no polling.
 *
 * Nothing asks the server on a timer, so the watcher has to cover every way
 * a ping can be missed:
 *
 *  - a change between the screen's first load and the subscription going
 *    live, and any gap while the socket drops and reconnects. Both are closed
 *    by reading again each time the channel reports SUBSCRIBED;
 *  - a tab that was hidden when a ping arrived, read again on return;
 *  - a device that went offline, read again when it comes back.
 *
 * A ping landing mid-read queues one more read instead of starting a second.
 */

export interface InvalidationClient {
  channel(name: string): RealtimeChannel;
  removeChannel(channel: RealtimeChannel): unknown;
}

export interface WatchInvalidationsOptions {
  supabase: InvalidationClient;
  channelName: string;
  event: string;
  refresh: () => Promise<unknown>;
}

/** Returns the stop function for the effect's cleanup. */
export function watchInvalidations({ supabase, channelName, event, refresh }: WatchInvalidationsOptions): () => void {
  let stopped = false;
  let running = false;
  let queued = false;

  const refreshLatest = () => {
    if (stopped) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    queued = false;
    void refresh().finally(() => {
      running = false;
      if (queued) refreshLatest();
    });
  };

  const onVisibility = () => {
    if (!document.hidden) refreshLatest();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", refreshLatest);

  const channel = supabase
    .channel(channelName)
    .on("broadcast", { event }, () => {
      if (!document.hidden) refreshLatest();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") refreshLatest();
    });

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", refreshLatest);
    void supabase.removeChannel(channel);
  };
}
