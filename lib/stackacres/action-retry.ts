export type ActionAttempt<T> = { response: Response; data: T; attempts: number };

export type ActionRetryOptions = {
  /** Wait before each retry; one entry per retry. */
  delaysMs?: readonly number[];
  /** Per-attempt cutoff, so a hung connection counts as a lost answer. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_DELAYS_MS = [400, 1200] as const;
const DEFAULT_TIMEOUT_MS = 12_000;
const GATEWAY_STATUSES = new Set([502, 503, 504]);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends an action and reads its JSON, retrying when the answer got lost: the
 * request threw, timed out, came back as a gateway error, or the body did not
 * parse. Every attempt carries the same intent key (the caller builds `send`
 * around it), so a write that already landed is replayed by the server rather
 * than run twice. Anything with a real status, refusals and 429 included, is
 * returned as is. Throws the last error once the retries run out.
 */
export async function sendActionWithRetry<T>(
  send: (attempt: number, signal: AbortSignal) => Promise<Response>,
  options: ActionRetryOptions = {},
): Promise<ActionAttempt<T>> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = options.sleep ?? wait;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await send(attempt, signal);
      if (GATEWAY_STATUSES.has(response.status)) throw new Error(`gateway ${response.status}`);
      if (response.status === 429 || response.status === 401) {
        return { response, data: undefined as T, attempts: attempt };
      }
      const data = (await response.json()) as T;
      return { response, data, attempts: attempt };
    } catch (error) {
      const delay = delays[attempt - 1];
      if (delay === undefined) throw error;
      await sleep(delay);
    }
  }
}
