import { NextRequest, NextResponse } from "next/server";
import { countActiveGames } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:tables", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const counts = await countActiveGames();
    return NextResponse.json(counts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not count active tables.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
