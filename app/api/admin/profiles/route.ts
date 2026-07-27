import { NextRequest, NextResponse } from "next/server";
import { listProfiles } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { isAdminAuthorized } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "admin:profiles:list", 20, 60 * 1000);
  if (limited) return limited;
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const profiles = await listProfiles();
    return NextResponse.json({ profiles });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list profiles.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
