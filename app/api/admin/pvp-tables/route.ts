import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancelWaitingPvpTable, listWaitingPvpTables } from "@/lib/server/admin-live-tables";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:pvp-tables", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const tables = await listWaitingPvpTables();
    return NextResponse.json({ tables });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load waiting PvP tables.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

const bodySchema = z.object({
  kind: z.enum(["heads-up", "cribbage", "sit-and-go"]),
  tableId: z.string().uuid(),
});

/**
 * Force-cancels one waiting (pre-deal) table and refunds every seated
 * player -- see lib/server/admin-live-tables.ts's own header for why this
 * is scoped to one admin-picked table rather than an automatic sweep.
 */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:pvp-tables:cancel", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Provide a valid kind and tableId." }, { status: 400 });
    }
    const result = await cancelWaitingPvpTable(parsed.data.kind, parsed.data.tableId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel that table.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
