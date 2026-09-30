import { expect, test, type APIRequestContext, type BrowserContext } from "./fixtures";

/**
 * Chopping a tree, from the outside.
 *
 * Same API-level posture as stackacres-harvest.spec.ts's first test rather
 * than a canvas-driven one. The real behaviour worth confirming end to end is
 * the server-authoritative part a Phaser tap ultimately triggers: a swing fills
 * the shelf with Wood, several swings fell the tree, and a felled tree
 * refuses another swing until its own respawn clock clears (asserted from
 * `lib/stackacres/wood.test.ts`'s injected-clock coverage, not repeated here
 * with a real eight-minute wait).
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
  return profile.id;
}

test("chopping a tree fills the barn with Wood and felling it takes a few swings", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const farmerContext = await browser.newContext();
  try {
    const unlocked = await adminContext.request.post("/api/admin/session", {
      data: { secret: ADMIN_SECRET },
    });
    expect(unlocked.ok()).toBe(true);
    await admitFarmer(farmerContext, adminContext.request);
    const api = farmerContext.request;

    // A tree the app hasn't been asked about yet reads as standing and
    // full-health -- one entry per WOOD_NODE_IDS, always present.
    const opened = await api.get("/api/stackacres");
    expect(opened.ok()).toBe(true);
    const view = (await opened.json()) as {
      woodNodes: { nodeId: string; ready: boolean; hitsRemaining: number }[];
      inventory?: Record<string, number>;
    };
    const before = view.woodNodes.find((node) => node.nodeId === "homestead-1");
    expect(before).toMatchObject({ ready: true, hitsRemaining: 3 });

    // Not a real tree: the schema refuses it before any of this ever runs.
    const badNode = await api.post("/api/stackacres/actions", {
      data: { action: "chop-tree", nodeId: "not-a-real-tree" },
    });
    expect(badNode.status()).toBe(400);

    let wood = 0;
    for (let swing = 1; swing <= 3; swing++) {
      const response = await api.post("/api/stackacres/actions", {
        data: { action: "chop-tree", nodeId: "homestead-1" },
      });
      expect(response.ok()).toBe(true);
      const data = (await response.json()) as {
        woodChopped: { nodeId: string; quantity: number; felled: boolean } | null;
        woodNodes: { nodeId: string; ready: boolean; hitsRemaining: number }[];
        inventory: Record<string, number>;
      };
      expect(data.woodChopped).not.toBeNull();
      wood += data.woodChopped!.quantity;
      expect(data.inventory.wood).toBe(wood);

      const node = data.woodNodes.find((entry) => entry.nodeId === "homestead-1")!;
      if (swing < 3) {
        expect(data.woodChopped!.felled).toBe(false);
        expect(node.ready).toBe(true);
        expect(node.hitsRemaining).toBe(3 - swing);
      } else {
        // The third swing fells it -- a bonus on top of the ordinary yield,
        // and the tree is a stump until its own respawn clock clears.
        expect(data.woodChopped!.felled).toBe(true);
        expect(node.ready).toBe(false);
      }
    }

    // A felled tree refuses a fourth swing outright: no Wood, no change.
    const afterFelled = await api.post("/api/stackacres/actions", {
      data: { action: "chop-tree", nodeId: "homestead-1" },
    });
    expect(afterFelled.ok()).toBe(true);
    const stillFelled = (await afterFelled.json()) as {
      woodChopped: unknown | null;
      inventory: Record<string, number>;
    };
    expect(stillFelled.woodChopped).toBeNull();
    expect(stillFelled.inventory.wood).toBe(wood);

    // A different tree is entirely unaffected -- each node is its own row.
    const otherTree = await api.post("/api/stackacres/actions", {
      data: { action: "chop-tree", nodeId: "homestead-2" },
    });
    expect(otherTree.ok()).toBe(true);
    const otherData = (await otherTree.json()) as {
      woodChopped: { felled: boolean; quantity: number } | null;
    };
    expect(otherData.woodChopped).not.toBeNull();
    expect(otherData.woodChopped!.felled).toBe(false);
  } finally {
    await farmerContext.close();
    await adminContext.close();
  }
});
