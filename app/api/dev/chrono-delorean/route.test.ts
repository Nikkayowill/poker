import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level proof of the three gates app/api/dev/chrono-delorean/route.ts
 * documents, in the order it checks them, plus the request/response contract
 * the panel depends on. See lib/server/chrono-delorean.test.ts for the
 * offset arithmetic itself -- this file is about the HTTP surface, not the
 * math underneath it.
 *
 * `CHRONO_DELOREAN_ENABLED` is a top-level const, so proving the 404 path
 * (env disabled) and the working path (env enabled) both need a fresh module
 * graph per environment -- see chrono-delorean.test.ts's own header for why
 * `vi.resetModules()` plus a dynamic `import()` is used throughout instead of
 * one static import at the top of the file.
 */

const ADMIN_SECRET = "route-test-admin-secret";

interface LoadedRoute {
  GET: (request: NextRequest) => Promise<Response>;
  POST: (request: NextRequest) => Promise<Response>;
  createAdminSessionToken: (now?: number) => string;
  ensureProfile: (token: string) => Promise<{ id: string }>;
}

async function loadRoute(env: { nodeEnv?: string; mode?: string; adminSecret?: string }): Promise<LoadedRoute> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env.nodeEnv ?? "test");
  if (env.mode === undefined) {
    delete process.env.CHRONO_DELOREAN_MODE;
  } else {
    vi.stubEnv("CHRONO_DELOREAN_MODE", env.mode);
  }
  if (env.adminSecret === undefined) {
    delete process.env.ADMIN_SECRET;
  } else {
    vi.stubEnv("ADMIN_SECRET", env.adminSecret);
  }
  const route = await import("./route");
  const { createAdminSessionToken } = await import("@/lib/server/admin-auth");
  const { ensureProfile } = await import("@/lib/server/profile-store");
  return { GET: route.GET, POST: route.POST, createAdminSessionToken, ensureProfile };
}

function request(
  method: "GET" | "POST",
  cookies: Record<string, string>,
  body?: unknown,
): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
  return new NextRequest("https://stackchips.test/api/dev/chrono-delorean", {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CHRONO_DELOREAN_MODE;
  delete process.env.ADMIN_SECRET;
});

describe("gate 1: CHRONO_DELOREAN_ENABLED", () => {
  it("404s with no cookies at all when the env flag is unset -- cheapest possible refusal", async () => {
    const { GET } = await loadRoute({ nodeEnv: "development" });
    const response = await GET(request("GET", {}));
    expect(response.status).toBe(404);
  });

  it("404s even carrying a valid admin cookie when NODE_ENV=production", async () => {
    const enabled = await loadRoute({ nodeEnv: "development", mode: "1", adminSecret: ADMIN_SECRET });
    const adminToken = enabled.createAdminSessionToken();

    // Reload as production -- the admin token above was minted under a
    // different HMAC-relevant `now`/env stub cycle, but that does not matter
    // here: gate 1 must refuse before gate 2 (isAdminAuthorized) is ever
    // reached, so an invalid or absent admin cookie must not change the
    // outcome.
    const prod = await loadRoute({ nodeEnv: "production", mode: "1", adminSecret: ADMIN_SECRET });
    const response = await prod.GET(
      request("GET", { river_room_admin_session: adminToken, river_session: randomUUID() }),
    );
    expect(response.status).toBe(404);
  });
});

describe("gate 2: isAdminAuthorized", () => {
  it("404s a real player session with no admin cookie", async () => {
    const { GET, ensureProfile } = await loadRoute({
      nodeEnv: "development",
      mode: "1",
      adminSecret: ADMIN_SECRET,
    });
    const token = randomUUID();
    await ensureProfile(token);
    const response = await GET(request("GET", { river_session: token }));
    expect(response.status).toBe(404);
  });

  it("404s a garbage admin cookie", async () => {
    const { GET } = await loadRoute({ nodeEnv: "development", mode: "1", adminSecret: ADMIN_SECRET });
    const response = await GET(
      request("GET", { river_room_admin_session: "not-a-real-token", river_session: randomUUID() }),
    );
    expect(response.status).toBe(404);
  });
});

describe("gate 3: a real player session", () => {
  it("400s a valid admin cookie with no player session cookie", async () => {
    const { GET, createAdminSessionToken } = await loadRoute({
      nodeEnv: "development",
      mode: "1",
      adminSecret: ADMIN_SECRET,
    });
    const adminToken = createAdminSessionToken();
    const response = await GET(request("GET", { river_room_admin_session: adminToken }));
    expect(response.status).toBe(400);
  });
});

describe("with every gate satisfied", () => {
  async function setUp() {
    const loaded = await loadRoute({ nodeEnv: "development", mode: "1", adminSecret: ADMIN_SECRET });
    const adminToken = loaded.createAdminSessionToken();
    const playerToken = randomUUID();
    await loaded.ensureProfile(playerToken);
    const cookies = { river_room_admin_session: adminToken, river_session: playerToken };
    return { ...loaded, cookies };
  }

  it("GET answers enabled:true with offsetMs 0 for a farm never shifted before", async () => {
    const { GET, cookies } = await setUp();
    const response = await GET(request("GET", cookies));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ enabled: true, offsetMs: 0 });
    expect(body.realNowIso).toBe(body.simulatedNowIso);
  });

  it("POST set moves the offset, and a follow-up GET sees it", async () => {
    const { GET, POST, cookies } = await setUp();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const setResponse = await POST(request("POST", cookies, { op: "set", offsetMs: oneDayMs }));
    expect(setResponse.status).toBe(200);
    expect((await setResponse.json()).offsetMs).toBe(oneDayMs);

    const getResponse = await GET(request("GET", cookies));
    expect((await getResponse.json()).offsetMs).toBe(oneDayMs);
  });

  it("POST advance is additive on top of whatever set already put there", async () => {
    const { POST, cookies } = await setUp();
    const oneDayMs = 24 * 60 * 60 * 1000;
    await POST(request("POST", cookies, { op: "set", offsetMs: oneDayMs }));

    const advanceResponse = await POST(request("POST", cookies, { op: "advance", deltaMs: oneDayMs }));
    expect((await advanceResponse.json()).offsetMs).toBe(oneDayMs * 2);
  });

  it("POST reset returns to offsetMs 0", async () => {
    const { POST, cookies } = await setUp();
    await POST(request("POST", cookies, { op: "set", offsetMs: 999_999 }));
    const resetResponse = await POST(request("POST", cookies, { op: "reset" }));
    expect((await resetResponse.json()).offsetMs).toBe(0);
  });

  it("rejects a malformed body with 400 rather than a 500", async () => {
    const { POST, cookies } = await setUp();
    const response = await POST(request("POST", cookies, { op: "advance", deltaMs: 0 }));
    expect(response.status).toBe(400);
  });

  it("rejects an out-of-range set with 400, carrying the friendly range message", async () => {
    const { POST, cookies } = await setUp();
    const tooFar = 366 * 24 * 60 * 60 * 1000;
    const response = await POST(request("POST", cookies, { op: "set", offsetMs: tooFar }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/365 days/);
  });

  it("scopes the offset to the caller's own session -- two different tokens never see each other's shift", async () => {
    const loaded = await loadRoute({ nodeEnv: "development", mode: "1", adminSecret: ADMIN_SECRET });
    const adminToken = loaded.createAdminSessionToken();
    const tokenA = randomUUID();
    const tokenB = randomUUID();
    await loaded.ensureProfile(tokenA);
    await loaded.ensureProfile(tokenB);

    await loaded.POST(
      request("POST", { river_room_admin_session: adminToken, river_session: tokenA }, {
        op: "set",
        offsetMs: 5_000_000,
      }),
    );

    const statusForB = await loaded.GET(
      request("GET", { river_room_admin_session: adminToken, river_session: tokenB }),
    );
    expect((await statusForB.json()).offsetMs).toBe(0);
  });
});
