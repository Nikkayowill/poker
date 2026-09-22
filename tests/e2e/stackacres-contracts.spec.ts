import { expect, test, type APIRequestContext, type BrowserContext } from "./fixtures";

/**
 * The Town Board over HTTP: one open order at a time, and one pass a day.
 *
 * The pass is the release valve on a board that is one slot wide and cannot
 * be cancelled. It moves no Gold, so what matters here is the wiring and the
 * day limit rather than any money ordering.
 */

const ADMIN_SECRET = "playwright-admin-secret";

async function admitFarmer(context: BrowserContext, admin: APIRequestContext, gold: number) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };
  expect(
    (await admin.post("/api/admin/stackacres-access", { data: { profileId: profile.id, allowed: true } })).ok(),
  ).toBe(true);
  expect(
    (await admin.post("/api/admin/gold/adjust", { data: { profileId: profile.id, delta: gold - profile.goldBalance } })).ok(),
  ).toBe(true);
  return profile.id;
}

interface ContractView {
  contract: { id: string; item: string; quantity: number; status: string } | null;
}

test("an order can be passed on once a day, and the town posts another", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext();
  try {
    expect((await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 100_000);
    const api = farmerContext.request;

    // The Oven asks for Gold alone -- no Wood to chop over HTTP -- and it
    // makes a good the town has rungs for, so the board has something to draw.
    expect((await api.post("/api/stackacres/actions", { data: { action: "place-machine", kind: "oven" } })).ok()).toBe(true);

    const opened = await api.post("/api/stackacres/actions", { data: { action: "request-contract" } });
    expect(opened.ok()).toBe(true);
    const first = ((await opened.json()) as ContractView).contract;
    expect(first).not.toBeNull();

    const goldBefore = (await (await api.get("/api/profile")).json()) as { profile: { goldBalance: number } };

    const passed = await api.post("/api/stackacres/actions", { data: { action: "pass-contract" } });
    expect(passed.ok()).toBe(true);
    const second = ((await passed.json()) as ContractView).contract;
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first!.id);
    expect(second!.status).toBe("open");

    // A pass moves nothing.
    const goldAfter = (await (await api.get("/api/profile")).json()) as { profile: { goldBalance: number } };
    expect(goldAfter.profile.goldBalance).toBe(goldBefore.profile.goldBalance);

    // And there is only one a day.
    const again = await api.post("/api/stackacres/actions", { data: { action: "pass-contract" } });
    expect(again.status()).toBe(409);
    expect((await again.json()) as { error?: string }).toMatchObject({
      error: expect.stringContaining("already passed"),
    });

    // The order it refused to pass is still on the board.
    const still = ((await (await api.get("/api/stackacres")).json()) as ContractView).contract;
    expect(still!.id).toBe(second!.id);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});

test("passing with an empty board is refused and spends nothing", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext();
  try {
    expect((await adminContext.request.post("/api/admin/session", { data: { secret: ADMIN_SECRET } })).ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request, 100_000);
    const api = farmerContext.request;
    expect((await api.post("/api/stackacres/actions", { data: { action: "place-machine", kind: "oven" } })).ok()).toBe(true);

    const empty = await api.post("/api/stackacres/actions", { data: { action: "pass-contract" } });
    expect(empty.status()).toBe(409);

    // The day was not spent: a real order can still be passed.
    expect((await api.post("/api/stackacres/actions", { data: { action: "request-contract" } })).ok()).toBe(true);
    expect((await api.post("/api/stackacres/actions", { data: { action: "pass-contract" } })).ok()).toBe(true);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
