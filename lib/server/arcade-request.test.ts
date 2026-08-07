import { describe, expect, it } from "vitest";
import { ArcadeRequestError, toArcadeErrorResponse } from "./arcade-request";

/**
 * These pin the contract four games now share. Before it was extracted, each
 * service owned a copy, so a fix to one of them was a fix to a quarter of the
 * problem -- and nothing failed to tell you that.
 */

interface FakeSnapshot {
  id: string;
  version: number;
}

class FakeRequestError extends ArcadeRequestError<FakeSnapshot, "repeat" | "stale"> {
  readonly name = "FakeRequestError";
}

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("ArcadeRequestError", () => {
  it("keeps each game's subclass distinguishable by instanceof", () => {
    class OtherError extends ArcadeRequestError<FakeSnapshot> {}
    const error = new FakeRequestError("nope", 409);

    expect(error).toBeInstanceOf(FakeRequestError);
    expect(error).toBeInstanceOf(ArcadeRequestError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(OtherError);
  });

  it("names itself after the subclass, so a log line says which game refused", () => {
    expect(new FakeRequestError("nope", 409).name).toBe("FakeRequestError");
  });

  it("carries status, reason and round through", () => {
    const round = { id: "r1", version: 3 };
    const error = new FakeRequestError("already tried", 400, { reason: "repeat", round });

    expect(error.status).toBe(400);
    expect(error.reason).toBe("repeat");
    expect(error.round).toBe(round);
    expect(error.message).toBe("already tried");
  });

  it("leaves reason and round undefined when not given", () => {
    const error = new FakeRequestError("gone", 404);
    expect(error.reason).toBeUndefined();
    expect(error.round).toBeUndefined();
  });
});

describe("toArcadeErrorResponse", () => {
  it("answers a rejection with its own status and message", async () => {
    const response = toArcadeErrorResponse(new FakeRequestError("gone", 404), "fallback");
    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({ error: "gone" });
  });

  it("sends the round back so a desynced client can re-render from truth", async () => {
    const round = { id: "r1", version: 3 };
    const response = toArcadeErrorResponse(
      new FakeRequestError("moved on", 409, { reason: "stale", round }),
      "fallback",
    );

    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: "moved on", reason: "stale", round });
  });

  it("omits reason and round rather than sending nulls", async () => {
    // The client checks for the keys' presence, so emitting `round: undefined`
    // and emitting nothing must not be the same shape on the wire.
    const response = toArcadeErrorResponse(new FakeRequestError("gone", 404), "fallback");
    const payload = await body(response);
    expect("reason" in payload).toBe(false);
    expect("round" in payload).toBe(false);
  });

  it("maps spendGold's own refusal to a 400, not a 500", async () => {
    // "Not enough Gold." is thrown by the wallet guard, which is the authority.
    // A 500 would tell the player the app broke when in fact they are broke.
    const response = toArcadeErrorResponse(new Error("Not enough Gold."), "fallback");
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: "Not enough Gold." });
  });

  it("treats any other Error as a fault and passes its message on", async () => {
    const response = toArcadeErrorResponse(new Error("relation does not exist"), "fallback");
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({ error: "relation does not exist" });
  });

  it("falls back only for a non-Error throw", async () => {
    const response = toArcadeErrorResponse("something odd", "That hand could not be played.");
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({ error: "That hand could not be played." });
  });
});
