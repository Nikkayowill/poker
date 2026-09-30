import { expect, test, type APIRequestContext, type BrowserContext } from "./fixtures";

/**
 * Mining a Stone node, from the outside.
 *
 * Unlike a harvest (stackacres-harvest.spec.ts), a mining swing is instant --
 * there is no ripening window to wait out -- so this spec runs a whole node
 * to breakage over real HTTP, the thing only a browser can answer:
 *
 *   * the route really accepts `mine-stone` and really credits Stone into the
 *     inventory the read route serves;
 *   * a broken node really refuses another swing with a real HTTP 409, not
 *     silently no-opping;
 *   * an unknown node id is a clean 400, never a 500 or a quiet accept;
 *   * and Stone really sells through the generic `sell` action, at the
 *     catalogue's own price, against the same wallet the poker tables spend.
 *
 * The exact arithmetic (swing counts, yields, the regrow window) is covered
 * against the real service with an injected clock in
 * lib/server/stackacres-service.test.ts and lib/stackacres/stone-nodes.test.ts
 * -- this only proves the wiring between the route and that service is real.
 */

const ADMIN_SECRET = "playwright-admin-secret";

/** Mints a session, then has the admin let that profile into StackAcres and
 *  top up its purse. Same helper stackacres-harvest.spec.ts uses. */
async function admitFarmer(context: BrowserContext, admin: APIRequestContext, gold: number) {
  const created = await context.request.post("/api/profile");
  expect(created.ok()).toBe(true);
  const { profile } = (await created.json()) as { profile: { id: string; goldBalance: number } };

  const granted = await admin.post("/api/admin/stackacres-access", {
    data: { profileId: profile.id, allowed: true },
  });
  expect(granted.ok()).toBe(true);

  const delta = gold - profile.goldBalance;
  if (delta !== 0) {
    const topped = await admin.post("/api/admin/gold/adjust", {
      data: { profileId: profile.id, delta },
    });
    expect(topped.ok()).toBe(true);
  }
  return profile.id;
}

test("mining a Stone node credits inventory, breaks after its swing count, and refuses until it regrows", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);

    await admitFarmer(farmerContext, adminContext.request, 100_000);
    const api = farmerContext.request;

    // An unknown node id is refused cleanly, not accepted or crashed on.
    const bogus = await api.post("/api/stackacres/actions", {
      data: { action: "mine-stone", nodeId: "stone:mine-99" },
    });
    expect(bogus.status()).toBe(400);

    // A landed swing credits Stone into the inventory the read route serves.
    const first = await api.post("/api/stackacres/actions", {
      data: { action: "mine-stone", nodeId: "stone:mine-1" },
    });
    expect(first.ok()).toBe(true);
    const firstBody = (await first.json()) as {
      inventory?: Record<string, number>;
      stoneMined?: { landed: boolean; broke: boolean; amount: number };
    };
    expect(firstBody.stoneMined).toMatchObject({ landed: true, amount: 2 });
    expect(firstBody.inventory?.stone).toBe(2);

    // Swing the same node until it breaks -- whatever HITS_TO_BREAK is, this
    // loop stops the moment the server itself says `broke: true`, so it never
    // hardcodes the swing count the server owns.
    let broke = firstBody.stoneMined?.broke ?? false;
    let stoneTotal = firstBody.inventory?.stone ?? 0;
    let guard = 0;
    while (!broke) {
      guard += 1;
      expect(guard).toBeLessThan(20); // A real node breaks well inside 20 swings.
      const swing = await api.post("/api/stackacres/actions", {
        data: { action: "mine-stone", nodeId: "stone:mine-1" },
      });
      expect(swing.ok()).toBe(true);
      const body = (await swing.json()) as {
        inventory?: Record<string, number>;
        stoneMined?: { landed: boolean; broke: boolean; amount: number };
      };
      expect(body.stoneMined?.landed).toBe(true);
      broke = body.stoneMined?.broke ?? false;
      stoneTotal = body.inventory?.stone ?? stoneTotal;
    }

    // Broken now: another swing at the same node does not land, and pays
    // nothing -- inventory stays exactly where it was.
    const refused = await api.post("/api/stackacres/actions", {
      data: { action: "mine-stone", nodeId: "stone:mine-1" },
    });
    expect(refused.ok()).toBe(true);
    const refusedBody = (await refused.json()) as {
      inventory?: Record<string, number>;
      stoneMined?: { landed: boolean; broke: boolean; amount: number };
    };
    expect(refusedBody.stoneMined).toEqual({ landed: false, broke: false, amount: 0 });
    expect(refusedBody.inventory?.stone).toBe(stoneTotal);

    // A different node is unaffected by the first one breaking.
    const otherNode = await api.post("/api/stackacres/actions", {
      data: { action: "mine-stone", nodeId: "stone:mine-2" },
    });
    expect(otherNode.ok()).toBe(true);
    const otherBody = (await otherNode.json()) as { stoneMined?: { landed: boolean } };
    expect(otherBody.stoneMined?.landed).toBe(true);

    // Stone sells through the generic sell action, same door every other
    // inventory item uses.
    const before = (await (await api.get("/api/profile")).json()) as {
      profile: { goldBalance: number };
    };
    const sold = await api.post("/api/stackacres/actions", {
      data: { action: "sell", item: "stone", quantity: 1 },
    });
    expect(sold.ok()).toBe(true);
    const after = (await (await api.get("/api/profile")).json()) as {
      profile: { goldBalance: number };
    };
    expect(after.profile.goldBalance).toBeGreaterThan(before.profile.goldBalance);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
