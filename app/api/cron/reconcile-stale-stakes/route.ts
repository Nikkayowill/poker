import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/admin-auth";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { reconcileOrphanedGoldDebits } from "@/lib/server/profile-store";

export const runtime = "nodejs";

/**
 * Refunds a staked-game debit that never got a matching settlement/refund
 * credit -- the process died (crash, deploy, function timeout) between
 * debiting a stake and creating the thing it paid for. Only finds debits
 * made through spendGoldByProfileLedgered; call sites still on the older
 * spendGoldByProfile have no ledger row and are invisible to this sweep.
 *
 * 15 minutes is generous room for an in-flight request to finish its own
 * create-or-refund before this treats it as orphaned; it is not a tuned
 * SLA. Scheduled hourly in vercel.json; safe to call more often or by hand
 * -- an empty scan just returns { found: 0, refunded: 0 }.
 *
 * Vercel's free Hobby tier silently limits cron schedules to once a day
 * regardless of what vercel.json says -- confirm the project's actual plan
 * before relying on the hourly cadence below. If it's Hobby, either upgrade
 * or trigger this route from an external scheduler (e.g. Upstash QStash);
 * the route itself doesn't care who calls it, only that CRON_SECRET is
 * presented.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "cron:reconcile-stale-stakes", 10, 60 * 1000);
  if (limited) return limited;

  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    const result = await reconcileOrphanedGoldDebits(15);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not run the stake reconciliation sweep.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
