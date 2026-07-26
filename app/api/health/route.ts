import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server/game-store";
import { readSupabaseRuntimeConfig } from "@/lib/server/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET() {
  try {
    const config = readSupabaseRuntimeConfig();
    if (!config) {
      return NextResponse.json(
        {
          status: "development",
          persistence: "memory",
          checkedAt: new Date().toISOString(),
        },
        { headers: noStoreHeaders },
      );
    }

    const supabase = adminClient();
    if (!supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("game_signals")
      .select("version")
      .limit(1);
    if (error) throw error;

    return NextResponse.json(
      {
        status: "ok",
        persistence: "supabase",
        database: "reachable",
        realtime: Boolean(config.url && config.publicKey) ? "configured" : "unavailable",
        checkedAt: new Date().toISOString(),
      },
      { headers: noStoreHeaders },
    );
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        persistence: "unavailable",
        checkedAt: new Date().toISOString(),
      },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
