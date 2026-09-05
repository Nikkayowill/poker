import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CHRONO_DELOREAN_ENABLED,
  advanceChronoDeloreanOffset,
  readChronoDeloreanStatus,
  resetChronoDeloreanOffset,
  setChronoDeloreanOffset,
} from "@/lib/server/chrono-delorean";
import { isAdminAuthorized } from "@/lib/server/admin-auth";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * Chrono-DeLorean Mode's own control surface: read or move the time offset
 * applied to the CALLER'S OWN StackAcres farm. See
 * lib/server/chrono-delorean.ts for the full mechanism and its scope.
 *
 * THREE GATES, checked in order, and the first two are checked before either
 * cookie is even read:
 *
 *   1. `CHRONO_DELOREAN_ENABLED` -- off outside a non-production build with
 *      `CHRONO_DELOREAN_MODE=1` set. A disabled build answers 404 with no
 *      session lookup, no admin check and no store access at all, so this
 *      route costs a production deploy nothing beyond the boolean read.
 *   2. `isAdminAuthorized` -- the same short-lived signed admin cookie every
 *      /api/admin/* route requires (lib/server/admin-auth.ts). A 404 rather
 *      than 401/403, matching that convention: a prober gets no signal that
 *      this route exists at all.
 *   3. A real player session (`readSessionToken`) -- this is deliberately
 *      NOT an admin-picks-any-profileId endpoint the way /api/admin/gold/
 *      adjust is. Chrono-DeLorean Mode only ever time-shifts the browser's
 *      OWN farm, the same identity every other StackAcres route resolves
 *      from this same cookie -- there is no way to point it at another
 *      player's account, which is what keeps a "sandboxed" harness sandboxed
 *      rather than a second, wider admin power.
 *
 * Deliberately outside StackAcres's own access gate
 * (lib/server/stackacres-access.ts's `tokenHasStackAcresAccess`): a developer
 * testing time-shifted behavior does not need to already be granted the
 * floor, and this route moves no Gold and touches no unit -- it is pure
 * metadata about a clock.
 */
const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), offsetMs: z.number().int() }),
  z.object({ op: z.literal("advance"), deltaMs: z.number().int().refine((v) => v !== 0) }),
  z.object({ op: z.literal("reset") }),
]);

function guard(request: NextRequest): NextResponse | null {
  if (!CHRONO_DELOREAN_ENABLED) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!isAdminAuthorized(request)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return null;
}

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "dev:chrono-delorean:read", 60, 60 * 1000);
  if (limited) return limited;

  const blocked = guard(request);
  if (blocked) return blocked;

  const token = readSessionToken(request);
  if (!token) return NextResponse.json({ error: "No session to time-shift." }, { status: 400 });

  return NextResponse.json(await readChronoDeloreanStatus(token));
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "dev:chrono-delorean:write", 30, 60 * 1000);
  if (limited) return limited;

  const blocked = guard(request);
  if (blocked) return blocked;

  const token = readSessionToken(request);
  if (!token) return NextResponse.json({ error: "No session to time-shift." }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send a valid op." }, { status: 400 });
  }

  try {
    const status = await (async () => {
      switch (parsed.data.op) {
        case "set":
          return setChronoDeloreanOffset(token, parsed.data.offsetMs);
        case "advance":
          return advanceChronoDeloreanOffset(token, parsed.data.deltaMs);
        case "reset":
          return resetChronoDeloreanOffset(token);
      }
    })();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not move that clock.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
