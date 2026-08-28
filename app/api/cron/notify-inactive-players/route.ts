import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/admin-auth";
import { isInLocalSendWindow, isSameLocalDay } from "@/lib/push/send-window";
import { pickComeBackPushCopy } from "@/lib/push/copy";
import { sendPushToSubscription } from "@/lib/server/push-service";
import {
  markPushSubscriptionNotified,
  pushSubscriptionsForInactivePlayers,
} from "@/lib/server/push-subscription-store";

export const runtime = "nodejs";

/** Loose lower bound for "hasn't claimed daily Gold recently" -- see pushSubscriptionsForInactivePlayers's own comment on why this doesn't need to be a precise day boundary. */
const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The "come back and claim your Gold" push. Runs hourly (see vercel.json)
 * and, per candidate, only actually sends during that player's own local
 * send hour (lib/push/send-window.ts) -- a player with no stored timezone
 * yet falls back to the original fixed-UTC-hour behavior there, so nobody
 * silently stops getting notified just because their browser hasn't
 * reported a zone (see app/api/profile/timezone/route.ts).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    const now = new Date();
    const candidates = await pushSubscriptionsForInactivePlayers(new Date(now.getTime() - RECENCY_WINDOW_MS));

    let sent = 0;
    await Promise.all(candidates.map(async (subscription) => {
      if (!isInLocalSendWindow(subscription.timezone, now)) return;
      // Belt and suspenders against a re-run within the same local day: the
      // store query already loosely filters on the daily-Gold claim, but a
      // cron retry (Vercel does retry a failed invocation) must not
      // re-notify a subscription already reached today.
      if (subscription.lastNotifiedAt && isSameLocalDay(subscription.timezone, new Date(subscription.lastNotifiedAt), now)) return;

      const seed = [...subscription.profileId].reduce((sum, char) => sum + char.charCodeAt(0), 0) + now.getUTCDate();
      await sendPushToSubscription(subscription, {
        title: "StackChips",
        body: pickComeBackPushCopy(seed),
        url: "/",
      });
      await markPushSubscriptionNotified(subscription.id, now);
      sent += 1;
    }));

    return NextResponse.json({ sent, candidates: candidates.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not run the notification sweep.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
