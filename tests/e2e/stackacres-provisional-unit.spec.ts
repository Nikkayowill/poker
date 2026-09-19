import { expect, test, type APIRequestContext, type BrowserContext } from "./fixtures";

/**
 * The unit id a browser invents, arriving at the route.
 *
 * A crop sown optimistically stands on screen under this browser's own id
 * (`sa-optimistic-N`, lib/stackacres/optimistic-actions.ts) until the create
 * lands, and a finger is perfectly capable of watering that sprout first.
 * The client now waits the create out and re-points the action at the real
 * row, so such an id should never leave the browser at all -- but the route
 * is the thing that used to answer one with Postgres' own "invalid input
 * syntax for type uuid", which reached the player as "Could not load that
 * unit" on a crop standing right in front of them. This holds it to a clean
 * refusal that says nothing about the storage underneath.
 */

const ADMIN_SECRET = "playwright-admin-secret";

async function admitFarmer(context: BrowserContext, admin: APIRequestContext) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string } };
  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);
}

test("a provisional unit id is refused cleanly, not as a database error", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext();
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request);

    for (const body of [
      { action: "water", unitId: "sa-optimistic-2" },
      { action: "feed", unitId: "sa-optimistic-2" },
      { action: "collect", unitIds: ["sa-optimistic-2"] },
    ]) {
      const response = await farmerContext.request.post("/api/stackacres/actions", { data: body });
      expect(response.status(), `${body.action} should be refused as a bad request`).toBe(400);
      const said = JSON.stringify(await response.json()).toLowerCase();
      expect(said).not.toContain("uuid");
      expect(said).not.toContain("could not load that unit");
    }
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
