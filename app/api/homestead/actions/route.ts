import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  HOMESTEAD_FEED_IDS,
  HOMESTEAD_GRID_PLOTS,
  HOMESTEAD_STOCK,
} from "@/lib/homestead/catalogue";
import {
  buyHomesteadFeed,
  buyHomesteadPlot,
  clearHomesteadPlot,
  collectHomestead,
  feedHomestead,
  stockHomestead,
  toHomesteadErrorResponse,
} from "@/lib/server/homestead-service";
import { isBanned } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readOrCreateSessionToken, withRequestSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Acts on the caller's own farm. `buy-plot`, `stock`, `buy-feed`, `feed` and
 * `clear` all DEBIT the caller -- see the ordering rules in
 * lib/server/homestead-service.ts -- and `collect` credits a settled plot
 * exactly once, guarded by version.
 *
 * No `version` field in any action: each handler reads the live row itself and
 * the guarded write settles at most once, so a stale client gets a 409
 * carrying the true grid rather than a torn write.
 *
 * Open to any caller. The Homestead was briefly behind an admin session while
 * it was unreleased; that is gone, and the only thing keeping it unadvertised
 * now is its `unlisted` catalog status, which keeps it off the arcade floor.
 * Anyone with the URL can play it, so treat it as live for anything that
 * moves Gold.
 */
const plotIndexSchema = z.number().int().min(1).max(HOMESTEAD_GRID_PLOTS);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("buy-plot"), plotIndex: plotIndexSchema }),
  z.object({
    action: z.literal("stock"),
    plotIndex: plotIndexSchema,
    stock: z.enum(HOMESTEAD_STOCK as unknown as [string, ...string[]]),
  }),
  z.object({ action: z.literal("collect"), plotIndex: plotIndexSchema }),
  z.object({ action: z.literal("feed"), plotIndex: plotIndexSchema }),
  z.object({ action: z.literal("clear"), plotIndex: plotIndexSchema }),
  z.object({
    action: z.literal("buy-feed"),
    itemId: z.enum(HOMESTEAD_FEED_IDS as unknown as [string, ...string[]]),
  }),
]);

export async function POST(request: NextRequest) {
  // Every action here moves Gold at most once and the guards make replays
  // idempotent; 60/min covers a fast Hen Coop restocking ritual plus feeding
  // with a wide margin.
  const limited = enforceRateLimit(request, "homestead:act", 60, 60 * 1000);
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

    // Collecting stays open to a suspended account: it only returns Gold
    // already committed, same posture as resigning while banned. Spending
    // more is what's gated.
    if (parsed.data.action !== "collect" && (await isBanned(token))) {
      return withRequestSessionCookie(
        request,
        NextResponse.json({ error: "Your account has been suspended." }, { status: 403 }),
        token,
      );
    }

    const action = parsed.data;
    const result =
      action.action === "buy-plot"
        ? await buyHomesteadPlot(token, action.plotIndex)
        : action.action === "stock"
          ? await stockHomestead(token, { plotIndex: action.plotIndex, stock: action.stock })
          : action.action === "collect"
            ? await collectHomestead(token, action.plotIndex)
            : action.action === "feed"
              ? await feedHomestead(token, action.plotIndex)
              : action.action === "clear"
                ? await clearHomesteadPlot(token, action.plotIndex)
                : await buyHomesteadFeed(token, action.itemId);
    return withRequestSessionCookie(request, NextResponse.json(result), token);
  } catch (error) {
    return withRequestSessionCookie(request, toHomesteadErrorResponse(error), token);
  }
}
