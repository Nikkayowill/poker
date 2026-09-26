import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/admin-auth";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { reconcileOrphanedGoldDebits } from "@/lib/server/profile-store";
import { sweepDuelEscrow } from "@/lib/server/pvp-match-service";

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
 * SLA. Safe to call more often or by hand -- an empty scan just returns
 * { found: 0, refunded: 0 }.
 *
 * Scheduled once daily in vercel.json, not hourly: this project is on
 * Vercel's Hobby tier, which rejects the deploy outright for any cron
 * expression that would fire more than once a day (confirmed by an actual
 * failed deploy, not a hypothetical). That means an orphaned debit can sit
 * unrefunded for up to ~24h in production today. If that's not tight
 * enough, either upgrade past Hobby or trigger this route more often from
 * an external scheduler (e.g. Upstash QStash) instead of vercel.json's
 * crons -- the route itself doesn't care who calls it, only that
 * CRON_SECRET is presented.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "cron:reconcile-stale-stakes", 10, 60 * 1000);
  if (limited) return limited;

  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    // Duels first: a claim whose match was written but never linked gets its
    // acceptor debit confirmed here, which keeps the pass below from
    // refunding an ante that is sitting in a live pot.
    const duels = await sweepDuelEscrow().catch((error: unknown) => {
      console.error("cron.reconcile.duel_sweep_failed", { error });
      return null;
    });
    // Without the duel sweep, the orphan pass could refund an acceptor's ante
    // that is in a live pot. Skip it this run; the next run does both, so a
    // refund is only ever late, never wrong.
    if (!duels) return NextResponse.json({ error: "Duel sweep failed; orphan pass skipped." }, { status: 500 });
    const result = await reconcileOrphanedGoldDebits(15);
    return NextResponse.json({ ...result, duels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not run the stake reconciliation sweep.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
