import { describe, expect, it, vi } from "vitest";
import { sendActionWithRetry } from "./action-retry";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noSleep = () => Promise.resolve();

describe("sendActionWithRetry", () => {
  it("returns the first answer without retrying", async () => {
    const send = vi.fn().mockResolvedValue(json({ ok: 1 }));
    const result = await sendActionWithRetry<{ ok: number }>(send, { sleep: noSleep });
    expect(result.data).toEqual({ ok: 1 });
    expect(result.attempts).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries a dropped connection and reports the attempt number", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(json({ ok: 2 }));
    const result = await sendActionWithRetry<{ ok: number }>(send, { sleep: noSleep });
    expect(result.data).toEqual({ ok: 2 });
    expect(result.attempts).toBe(2);
    expect(send.mock.calls.map((call) => call[0])).toEqual([1, 2]);
  });

  it("retries a gateway error and an unparseable body", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response("<html>", { status: 200 }))
      .mockResolvedValueOnce(json({ ok: 3 }));
    const result = await sendActionWithRetry<{ ok: number }>(send, { sleep: noSleep });
    expect(result.attempts).toBe(3);
  });

  it("does not retry a refusal", async () => {
    const send = vi.fn().mockResolvedValue(json({ error: "no" }, 400));
    const result = await sendActionWithRetry<{ error: string }>(send, { sleep: noSleep });
    expect(result.response.status).toBe(400);
    expect(result.data.error).toBe("no");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 429", async () => {
    const send = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    const result = await sendActionWithRetry(send, { sleep: noSleep });
    expect(result.response.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("throws the last error once the retries run out", async () => {
    const send = vi.fn().mockRejectedValue(new TypeError("network"));
    await expect(sendActionWithRetry(send, { sleep: noSleep })).rejects.toThrow("network");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("waits the configured delay between attempts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(new TypeError("network"));
    await expect(sendActionWithRetry(send, { sleep, delaysMs: [5, 9] })).rejects.toThrow();
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([5, 9]);
  });
});
