import { NextRequest, NextResponse } from "next/server";
import { getAchievementsView } from "@/lib/server/achievement-store";
import { readPendingHeadsUpInviteFor } from "@/lib/server/heads-up-service";
import { getActiveHeadsUpTableFor } from "@/lib/server/heads-up-store";
import { getMissionsView } from "@/lib/server/mission-store";
import { listNotifications } from "@/lib/server/notifications-store";
import { ensureProfile } from "@/lib/server/profile-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";
import { getPendingTableInvites, TABLE_INVITE_TTL_MS } from "@/lib/server/table-invite-store";
import { HUB_SECTIONS, type HubPayload, type HubSection } from "@/lib/hub/types";
import { publicErrorMessage } from "@/lib/server/public-error";

export const runtime = "nodejs";

/**
 * Every polled lobby readout, in one request.
 *
 * The six endpoints this fronts (/api/notifications, /api/missions,
 * /api/achievements, /api/invites/pending, /api/heads-up, and the friends
 * drawer's own poll) each ran their own interval, and each one opened with
 * its own readSessionToken + ensureProfile before doing any real work. A
 * lobby sitting idle with the drawer open was six invocations and six profile
 * reads a tick for answers that all belong to the same player.
 *
 * `include` is not a convenience: it is what keeps this from being *more*
 * work than the routes it replaces. The client asks only for the sections it
 * actually has mounted, so an idle lobby still costs exactly one notification
 * read -- not a missions and achievements roll-up nobody is looking at.
 *
 * The routes this fronts all stay, even though nothing in this app polls the
 * first four any more. A browser holding a bundle from before this shipped
 * keeps calling them across the deploy, and /api/heads-up is still the
 * waiting room's own read -- it carries a POST and mints a session cookie,
 * neither of which belongs here.
 */

/** Sized for the whole poll, not per section: the client sends one request a tick. */
const POLL_LIMIT_PER_MINUTE = 60;

function parseSections(request: NextRequest): HubSection[] {
  const raw = request.nextUrl.searchParams.get("include");
  if (!raw) return [];
  const asked = new Set(raw.split(","));
  // Filtered against the catalog rather than cast: `include` is caller-supplied
  // and every entry becomes a branch below.
  return HUB_SECTIONS.filter((section) => asked.has(section));
}

/**
 * Pending heads-up challenges, matching what GET /api/heads-up answers.
 *
 * The live-table check is not an optimisation: that route suppresses invites
 * outright while the caller already has a match waiting or dealt, and the
 * friends drawer relies on it -- offering a challenge to someone mid-match
 * gives them a button that cannot work.
 */
async function headsUpInvitesFor(profile: { id: string; isRegistered: boolean }) {
  if (!profile.isRegistered) return [];
  if (await getActiveHeadsUpTableFor(profile.id)) return [];
  return readPendingHeadsUpInviteFor(profile.id);
}

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "hub:read", POLL_LIMIT_PER_MINUTE, 60 * 1000);
  if (limited) return limited;

  const sections = parseSections(request);
  if (sections.length === 0) {
    return NextResponse.json({ error: "Ask for at least one section." }, { status: 400 });
  }

  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

    // The saving this route exists for: one profile read for every section,
    // where the six routes it replaces did one each.
    const profile = await ensureProfile(token);
    const payload: HubPayload = {};

    // Invites are registered-only, matching /api/invites/pending: an invite is
    // addressed to a profile id and a guest's profile dies with its cookie.
    // A guest asking for them gets an empty list rather than a 403, because
    // one gated section must not fail the other five in the same response.
    const wants = (section: HubSection) => sections.includes(section);

    await Promise.all([
      wants("notifications")
        ? listNotifications(profile.id).then((data) => { payload.notifications = data; })
        : null,
      wants("missions")
        ? getMissionsView(profile.id).then((data) => { payload.missions = data; })
        : null,
      wants("achievements")
        ? getAchievementsView(profile.id).then((data) => { payload.achievements = data; })
        : null,
      wants("invites")
        ? (profile.isRegistered ? getPendingTableInvites(profile.id) : Promise.resolve([]))
          .then((invites) => { payload.invites = { invites, ttlMs: TABLE_INVITE_TTL_MS }; })
        : null,
      wants("headsUp")
        ? headsUpInvitesFor(profile).then((invites) => { payload.headsUp = { invites }; })
        : null,
    ].filter(Boolean));

    return NextResponse.json(payload);
  } catch (error) {
    const message = publicErrorMessage(error, "Could not load your lobby.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
