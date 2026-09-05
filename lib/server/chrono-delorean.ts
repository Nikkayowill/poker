import "server-only";
import { ensureProfile } from "./profile-store";
import {
  advanceChronoDeloreanOffsetMs,
  readChronoDeloreanOffsetMs,
  writeChronoDeloreanOffsetMs,
} from "./chrono-delorean-store";
import type { ChronoDeloreanStatus } from "@/lib/dev/chrono-delorean-types";

/**
 * Chrono-DeLorean Mode: a sandboxed dev harness for watching a StackAcres
 * farm's own long-running clocks (crop growth, animal hunger, soil thirst,
 * Land Maintenance's per-UTC-day ceiling) resolve in minutes instead of real
 * days, without moving the system clock or rewriting a stored timestamp.
 *
 * HOW IT WORKS, in one sentence: every StackAcres service function already
 * takes an optional `now: Date` (see lib/server/stackacres-service.ts --
 * `readStackAcres`, `workStackAcres`, `feedStackAcres` and eighteen others
 * all default to `new Date()`, because lib/stackacres/units.ts's growth
 * derivation is a pure function of that argument, "There is no clock here").
 * `resolveChronoNow` reads a signed millisecond offset stored for the
 * caller's own profile and adds it to a real `Date.now()` read, and the two
 * StackAcres routes (app/api/stackacres/route.ts,
 * app/api/stackacres/actions/route.ts) pass the result through that same
 * `now` parameter instead of letting each service call default it. No new
 * clock is invented and no existing readiness guard is bypassed -- a unit is
 * still only ready when `readyAt <= now`; `now` can simply be a caller-chosen
 * point in the future, for that caller's own farm only.
 *
 * SCOPE. This shifts the `now` threaded through TypeScript service calls
 * only. A SQL `now()` inside a security-definer RPC (an `updated_at` audit
 * column, for instance) is untouched -- those are bookkeeping, not growth
 * clocks, and every growth-relevant timestamp in StackAcres
 * (`ready_at`/`last_fed_at`/`last_watered_at`) is written by the TypeScript
 * store layer from the passed-in `now`, never by a SQL default. See the
 * migration's own header for the full accounting.
 *
 * ENVIRONMENT GATING. `CHRONO_DELOREAN_ENABLED` requires BOTH a non-
 * production `NODE_ENV` AND an explicit `CHRONO_DELOREAN_MODE=1` -- the same
 * "unset or disabled means no default-open door" posture
 * lib/server/admin-auth.ts's `isCronAuthorized` takes for `CRON_SECRET`, so a
 * staging deploy that merely forgets to set `NODE_ENV=production` still
 * cannot time-travel a real farm. It is a plain top-level `const`, computed
 * once at module load from `process.env` -- the same static-`if` shape
 * components/arcade/stackacres/stackacres-world.tsx's own dev-only
 * `window.__stackacres` hook already uses, which is what lets Next's build
 * dead-code-eliminate the branch on the client and makes the disabled path on
 * the server a single boolean read with no store or database access at all.
 *
 * `resolveChronoNow` is safe to call unconditionally from a hot route: when
 * disabled it returns `new Date()` before touching a profile or a store, so
 * a production deploy pays nothing for this file existing. The mutating
 * functions below (`setChronoDeloreanOffset`, `advanceChronoDeloreanOffset`,
 * `resetChronoDeloreanOffset`) are reached only from
 * app/api/dev/chrono-delorean/route.ts, which itself 404s before calling any
 * of them when the flag is off -- they still assert it here too, so a future
 * call site added without reading this file fails loudly in every
 * environment where it must, rather than silently time-shifting a real farm.
 */
export const CHRONO_DELOREAN_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.CHRONO_DELOREAN_MODE === "1";

/** Matches the CHECK constraint on chrono_delorean_offsets.offset_ms -- kept
 *  here too so a caller gets the same refusal before a round trip to the
 *  store, not just from a database error message. */
export const CHRONO_DELOREAN_MAX_OFFSET_MS = 365 * 24 * 60 * 60 * 1000;

export class ChronoDeloreanDisabledError extends Error {
  constructor() {
    super("Chrono-DeLorean Mode is not enabled in this environment.");
    this.name = "ChronoDeloreanDisabledError";
  }
}

export class ChronoDeloreanRangeError extends Error {
  constructor() {
    super("A Chrono-DeLorean offset must be within +/-365 days.");
    this.name = "ChronoDeloreanRangeError";
  }
}

function assertEnabled(): void {
  if (!CHRONO_DELOREAN_ENABLED) throw new ChronoDeloreanDisabledError();
}

function assertInRange(ms: number): void {
  if (
    !Number.isSafeInteger(ms) ||
    ms < -CHRONO_DELOREAN_MAX_OFFSET_MS ||
    ms > CHRONO_DELOREAN_MAX_OFFSET_MS
  ) {
    throw new ChronoDeloreanRangeError();
  }
}

/**
 * The `now` a StackAcres route should use for this caller, real time plus
 * whatever offset (if any) is stored for their own profile.
 *
 * Deliberately swallows nothing but the disabled case: a store error (a
 * genuine Supabase failure reading the offset) is left to throw and surface
 * as a 500, the same as any other StackAcres read failing, rather than
 * silently falling back to real time and hiding a broken harness behind a
 * plausible-looking clock.
 */
export async function resolveChronoNow(token: string): Promise<Date> {
  if (!CHRONO_DELOREAN_ENABLED) return new Date();
  const profile = await ensureProfile(token);
  const offsetMs = await readChronoDeloreanOffsetMs(profile.id);
  return offsetMs === 0 ? new Date() : new Date(Date.now() + offsetMs);
}

export type { ChronoDeloreanStatus };

/** The full status the dev panel renders: whether the harness is even live,
 *  the raw offset, and both clocks side by side. Callable even when
 *  disabled -- it answers `{ enabled: false, offsetMs: 0, ... }` rather than
 *  throwing, since the panel's own poll needs a shape to render either way. */
export async function readChronoDeloreanStatus(token: string): Promise<ChronoDeloreanStatus> {
  const realNow = new Date();
  if (!CHRONO_DELOREAN_ENABLED) {
    const iso = realNow.toISOString();
    return { enabled: false, offsetMs: 0, realNowIso: iso, simulatedNowIso: iso };
  }
  const profile = await ensureProfile(token);
  const offsetMs = await readChronoDeloreanOffsetMs(profile.id);
  return {
    enabled: true,
    offsetMs,
    realNowIso: realNow.toISOString(),
    simulatedNowIso: new Date(realNow.getTime() + offsetMs).toISOString(),
  };
}

/** Sets the caller's own offset to an absolute value. */
export async function setChronoDeloreanOffset(
  token: string,
  offsetMs: number,
): Promise<ChronoDeloreanStatus> {
  assertEnabled();
  assertInRange(offsetMs);
  const profile = await ensureProfile(token);
  await writeChronoDeloreanOffsetMs(profile.id, offsetMs);
  return readChronoDeloreanStatus(token);
}

/** Advances (or rewinds, for a negative delta) the caller's own offset by a
 *  signed amount, atomically -- see advanceChronoDeloreanOffsetMs's own
 *  comment for why this is a dedicated store call rather than a
 *  read-then-write from here. */
export async function advanceChronoDeloreanOffset(
  token: string,
  deltaMs: number,
): Promise<ChronoDeloreanStatus> {
  assertEnabled();
  if (!Number.isSafeInteger(deltaMs) || deltaMs === 0) {
    throw new RangeError("A Chrono-DeLorean advance must be a non-zero integer of milliseconds.");
  }
  const profile = await ensureProfile(token);
  // This read-then-check is advisory, not the guard: a concurrent advance
  // between this read and the atomic write below could make it stale, same
  // as any TOCTOU check ahead of a locked write. It exists to answer a
  // friendly ChronoDeloreanRangeError in the ordinary case; the database
  // CHECK constraint on offset_ms is what actually holds under the race, at
  // the cost of a raw constraint-violation error surfacing instead on that
  // rarer path. Acceptable here because a lost race just means the request
  // is refused either way -- nothing settles at an out-of-range value.
  const current = await readChronoDeloreanOffsetMs(profile.id);
  assertInRange(current + deltaMs);
  await advanceChronoDeloreanOffsetMs(profile.id, deltaMs);
  return readChronoDeloreanStatus(token);
}

/** Back to real time -- an absolute set to zero, not a delete, so the row
 *  (and its updated_at) stays as a record that this farm was ever shifted. */
export async function resetChronoDeloreanOffset(token: string): Promise<ChronoDeloreanStatus> {
  assertEnabled();
  const profile = await ensureProfile(token);
  await writeChronoDeloreanOffsetMs(profile.id, 0);
  return readChronoDeloreanStatus(token);
}
