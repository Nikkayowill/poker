import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MINT_GRID_PLOTS, MINT_NODE_TYPES } from "@/lib/mint/nodes";
import {
  buyMintPlot,
  harvestMintPlot,
  plantMintNodeOnPlot,
  toMintErrorResponse,
} from "@/lib/server/mint-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own treasury. `buy-plot` and `plant` DEBIT the caller
 * -- see the ordering rules in lib/server/mint-service.ts -- and `harvest`
 * credits a settled node exactly once, guarded by version.
 *
 * No `version` field in any action: each handler reads the live row itself
 * and the guarded write settles at most once, so a stale client gets a 409
 * carrying the true grid rather than a torn write.
 */
const plotIndexSchema = z.number().int().min(1).max(MINT_GRID_PLOTS);

const buySchema = z.object({ action: z.literal("buy-plot"), plotIndex: plotIndexSchema });
const plantSchema = z.object({
  action: z.literal("plant"),
  plotIndex: plotIndexSchema,
  nodeType: z.enum(MINT_NODE_TYPES),
});
const harvestSchema = z.object({ action: z.literal("harvest"), plotIndex: plotIndexSchema });

const bodySchema = z.discriminatedUnion("action", [buySchema, plantSchema, harvestSchema]);

export async function POST(request: NextRequest) {
  // Every action here moves Gold at most once and the guards make replays
  // idempotent; 60/min covers a fast Pulse-replant ritual with a wide margin.
  const limited = enforceRateLimit(request, "mint:act", 60, 60 * 1000);
  if (limited) return limited;

  const token = readOrCreateSessionToken(request);
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Send a plot and an action." }, { status: 400 }),
        token,
      );
    }

    // Harvesting stays open to a suspended account: it only returns Gold
    // already committed, same posture as resigning while banned. Staking
    // more is what's gated.
    if (parsed.data.action !== "harvest" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const result =
      parsed.data.action === "buy-plot"
        ? await buyMintPlot(token, parsed.data.plotIndex)
        : parsed.data.action === "plant"
          ? await plantMintNodeOnPlot(token, { plotIndex: parsed.data.plotIndex, nodeType: parsed.data.nodeType })
          : await harvestMintPlot(token, parsed.data.plotIndex);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toMintErrorResponse(error), token);
  }
}
