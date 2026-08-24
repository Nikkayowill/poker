import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/server/admin-auth";
import { isSameUtcDay } from "@/lib/profile/daily-gold";
import { pickComeBackPushCopy } from "@/lib/push/copy";
import { sendPushToSubscription } from "@/lib/server/push-service";
import {
  markPushSubscriptionNotified,
  pushSubscriptionsForInactivePlayers,
} from "@/lib/server/push-subscription-store";

export const runtime = "nodejs";

/**
 * The daily "come back and claim your Gold" push -- one run, one nudge per
 * subscribed device that hasn't claimed today's daily Gold yet. Scheduled
 * in vercel.json.
 *
 * A single fixed UTC time is a real, known limitation: this app has no
 * per-player timezone stored anywhere (registration is email/Google, not a
 * profile field), so "evening" here means evening somewhere and the middle
 * of the night somewhere else. Picking a time that lands in the afternoon
 * across most of the US is the practical compromise until timezone capture
 * exists; adjust the vercel.json schedule directly rather than trying to
 * fix this here.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    const now = new Date();
    const utcDayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const candidates = await pushSubscriptionsForInactivePlayers(utcDayStart);

    let sent = 0;
    await Promise.all(candidates.map(async (subscription) => {
      // Belt and suspenders against a same-day re-run: the store query
      // already filters on the daily-Gold claim, but a cron retry (Vercel
      // does retry a failed invocation) must not re-notify a subscription
      // this same run already reached.
      if (subscription.lastNotifiedAt && isSameUtcDay(new Date(subscription.lastNotifiedAt), now)) return;

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
