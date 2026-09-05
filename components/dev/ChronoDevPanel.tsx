"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ChronoDeloreanStatus } from "@/lib/dev/chrono-delorean-types";
import {
  getChronoSimulatableGame,
  resetChronoTimeScale,
  setChronoTimeScale,
  type ChronoSimulatableGame,
} from "@/lib/dev/chrono-simulation-engine";

const CONTROL_URL = "/api/dev/chrono-delorean";

/** Named jumps the panel offers alongside a free-typed absolute date. Each
 *  key doubles as the submit button's own `op` value, read back out of the
 *  submitted FormData in `performChronoAction` below -- there is no second
 *  table anywhere else this has to stay in sync with. */
const ADVANCE_PRESETS: Readonly<Record<string, number>> = {
  "advance-1h": 60 * 60 * 1000,
  "advance-6h": 6 * 60 * 60 * 1000,
  "advance-1d": 24 * 60 * 60 * 1000,
  "advance-1w": 7 * 24 * 60 * 60 * 1000,
  "rewind-1d": -24 * 60 * 60 * 1000,
};

/** The multiplier applied to Phaser's own clock (see
 *  lib/dev/chrono-simulation-engine.ts) while the auto-advance loop below is
 *  running, so whatever tween is mid-flight visibly races rather than
 *  freezing for the loop's own real-time step interval. */
const LOOP_VISUAL_TIME_SCALE = 40;

/** How much simulated time one auto-advance tick moves, and how often (real
 *  milliseconds) a tick fires. A day per tick at this cadence walks a week
 *  of simulated growth in under five real seconds. */
const LOOP_STEP_MS = 24 * 60 * 60 * 1000;
const LOOP_TICK_INTERVAL_MS = 700;

interface ChronoActionState {
  status: ChronoDeloreanStatus | null;
  error: string | null;
}

const INITIAL_ACTION_STATE: ChronoActionState = { status: null, error: null };

async function postChronoOp(body: Record<string, unknown>): Promise<ChronoActionState> {
  try {
    const response = await fetch(CONTROL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload &&
        typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : `Request failed (${response.status}).`;
      return { status: null, error: message };
    }
    return { status: payload as ChronoDeloreanStatus, error: null };
  } catch {
    return { status: null, error: "Could not reach the Chrono-DeLorean control route." };
  }
}

async function runChronoAction(formData: FormData): Promise<ChronoActionState> {
  const op = formData.get("op");
  if (typeof op !== "string") return { status: null, error: "No operation submitted." };

  if (op === "reset") return postChronoOp({ op: "reset" });

  if (op === "set-absolute") {
    const raw = formData.get("datetime");
    if (typeof raw !== "string" || raw.length === 0) {
      return { status: null, error: "Pick a date and time first." };
    }
    const target = new Date(raw).getTime();
    if (!Number.isFinite(target)) return { status: null, error: "That is not a valid date." };
    return postChronoOp({ op: "set", offsetMs: Math.round(target - Date.now()) });
  }

  const deltaMs = ADVANCE_PRESETS[op];
  if (deltaMs === undefined) return { status: null, error: `Unknown operation "${op}".` };
  return postChronoOp({ op: "advance", deltaMs });
}

function formatOffset(offsetMs: number): string {
  if (offsetMs === 0) return "real time";
  const sign = offsetMs > 0 ? "+" : "-";
  const abs = Math.abs(offsetMs);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const parts = [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(
    (part): part is string => Boolean(part),
  );
  return `${sign}${parts.length > 0 ? parts.join(" ") : "<1m"}`;
}

/**
 * Chrono-DeLorean Mode's developer debug panel: the one on-screen surface for
 * moving a StackAcres farm's simulated clock and watching its own scene react.
 *
 * STRIPPED FROM PRODUCTION, TWICE OVER. This component checks
 * `NODE_ENV`/`NEXT_PUBLIC_CHRONO_DELOREAN_ENABLED` itself and renders `null`
 * before doing anything else, so mounting it unconditionally from a server
 * component (see app/(lobby)/games/stackacres/page.tsx) is safe -- but the
 * mount site ALSO gates on the same two variables server-side, so a
 * production RSC payload never contains this component's output, and Next's
 * client bundler dead-code-eliminates the branch that would have imported it.
 * Belt and suspenders on purpose: either gate alone is already sufficient,
 * matching the "no default-open door" posture the rest of this feature takes
 * (lib/server/chrono-delorean.ts's own header explains the pairing).
 *
 * The mutating buttons below can still 404 even when this panel renders --
 * that is correct, not a bug to route around: `/api/dev/chrono-delorean`
 * additionally requires a signed admin session
 * (lib/server/admin-auth.ts's `isAdminAuthorized`), which this component has
 * no way to check client-side (it is an HttpOnly cookie an HMAC verifies
 * server-side). A developer without that cookie sees the panel and an error
 * telling them the request failed, never a silent no-op.
 */
export function ChronoDevPanel() {
  const enabled =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_CHRONO_DELOREAN_ENABLED === "1";

  const [minimized, setMinimized] = useState(true);
  const [status, setStatus] = useState<ChronoDeloreanStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);
  const [daysToRun, setDaysToRun] = useState(7);
  const loopRemainingRef = useRef(0);

  // Wraps runChronoAction so a successful mutation applies its own answer to
  // `status` the moment it lands, rather than the panel waiting on the next
  // poll tick or (react-hooks/set-state-in-effect's objection) mirroring
  // `useActionState`'s own returned state into `status` via a second effect.
  // This runs from a form submission, a discrete event -- not an effect body
  // -- so setState here is exactly the "subscribe and update on a callback"
  // shape the lint rule's own guidance endorses.
  const performChronoAction = useCallback(
    async (_previous: ChronoActionState, formData: FormData): Promise<ChronoActionState> => {
      const result = await runChronoAction(formData);
      if (result.status) setStatus(result.status);
      return result;
    },
    [],
  );

  const [actionState, formAction, isActionPending] = useActionState(
    performChronoAction,
    INITIAL_ACTION_STATE,
  );

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch(CONTROL_URL, { cache: "no-store" });
      if (!response.ok) {
        setPollError(response.status === 404 ? "Not available (env or admin gate)." : `HTTP ${response.status}`);
        setStatus(null);
        return;
      }
      const payload = (await response.json()) as ChronoDeloreanStatus;
      setStatus(payload);
      setPollError(null);
    } catch {
      setPollError("Could not reach the Chrono-DeLorean control route.");
    }
  }, []);

  // Every mutation (the action below, or a loop tick) updates local state
  // straight from its own response, but a second open tab or a stray manual
  // curl call would not -- this poll is what catches that, at a cadence cheap
  // enough to leave running the whole time the panel is mounted.
  //
  // The initial call is deferred a tick (matching e.g. components/poker-
  // app.tsx's refreshPushState effect): react-hooks/set-state-in-effect
  // still flags an awaited async call as reachable from the effect body, and
  // a setTimeout callback is where the linter stops tracing.
  useEffect(() => {
    if (!enabled) return;
    const kick = window.setTimeout(() => void refreshStatus(), 0);
    const timer = window.setInterval(() => void refreshStatus(), 4000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [enabled, refreshStatus]);

  // The auto-advance loop: steps LOOP_STEP_MS of simulated time forward every
  // LOOP_TICK_INTERVAL_MS of real time, for as many ticks as `daysToRun`
  // asked for. Speeds up Phaser's own clock for the duration (see
  // lib/dev/chrono-simulation-engine.ts) so a growth tween that finished
  // server-side several simulated days ago visibly catches up on screen
  // instead of sitting mid-animation until the next real interaction.
  useEffect(() => {
    if (!looping) return;

    let cancelled = false;
    const game: ChronoSimulatableGame | null = getChronoSimulatableGame();
    if (game) setChronoTimeScale(game, LOOP_VISUAL_TIME_SCALE);

    const timer = window.setInterval(() => {
      if (cancelled) return;
      if (loopRemainingRef.current <= 0) {
        setLooping(false);
        return;
      }
      loopRemainingRef.current -= 1;
      void postChronoOp({ op: "advance", deltaMs: LOOP_STEP_MS }).then((result) => {
        if (!cancelled && result.status) setStatus(result.status);
      });
    }, LOOP_TICK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      const liveGame = getChronoSimulatableGame();
      if (liveGame) resetChronoTimeScale(liveGame);
    };
  }, [looping]);

  if (!enabled) return null;

  const startLoop = () => {
    loopRemainingRef.current = Math.max(1, Math.round(daysToRun));
    setLooping(true);
  };
  const stopLoop = () => setLooping(false);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        zIndex: 2147483000,
        fontFamily: "ui-monospace, monospace",
        fontSize: 12,
        color: "#e8e8f0",
        background: "rgba(18, 16, 28, 0.94)",
        border: "1px solid #6b5bd6",
        borderRadius: 10,
        boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
        width: minimized ? 168 : 280,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setMinimized((value) => !value)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "6px 10px",
          background: "#3a2f7a",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontWeight: 700,
          letterSpacing: "0.02em",
        }}
      >
        {"⏱"} Chrono-DeLorean {minimized ? "▸" : "▾"}
      </button>

      {!minimized && (
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ opacity: 0.85 }}>
            {status
              ? `Sim: ${formatOffset(status.offsetMs)}`
              : pollError
                ? pollError
                : "Loading…"}
          </div>
          {status && (
            <div style={{ opacity: 0.6, fontSize: 11 }}>
              {new Date(status.simulatedNowIso).toLocaleString()}
            </div>
          )}

          <form action={formAction} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.keys(ADVANCE_PRESETS).map((op) => (
              <button
                key={op}
                type="submit"
                name="op"
                value={op}
                disabled={isActionPending}
                style={presetButtonStyle}
              >
                {op.replace("advance-", "+").replace("rewind-", "-")}
              </button>
            ))}
            <button type="submit" name="op" value="reset" disabled={isActionPending} style={presetButtonStyle}>
              reset
            </button>
          </form>

          <form action={formAction} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="datetime-local"
              name="datetime"
              style={{ flex: 1, fontSize: 11, background: "#1c1930", color: "#fff", border: "1px solid #4a417a" }}
            />
            <input type="hidden" name="op" value="set-absolute" />
            <button type="submit" disabled={isActionPending} style={presetButtonStyle}>
              jump
            </button>
          </form>

          {actionState.error && <div style={{ color: "#ff8a8a" }}>{actionState.error}</div>}

          <div style={{ borderTop: "1px solid #3a2f7a", paddingTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="number"
              min={1}
              max={365}
              value={daysToRun}
              onChange={(event) => setDaysToRun(Number(event.target.value) || 1)}
              disabled={looping}
              style={{ width: 48, fontSize: 11, background: "#1c1930", color: "#fff", border: "1px solid #4a417a" }}
            />
            <span style={{ opacity: 0.7 }}>days</span>
            {looping ? (
              <button type="button" onClick={stopLoop} style={presetButtonStyle}>
                stop
              </button>
            ) : (
              <button type="button" onClick={startLoop} style={presetButtonStyle}>
                run loop
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const presetButtonStyle: CSSProperties = {
  background: "#2c2456",
  color: "#e8e8f0",
  border: "1px solid #4a417a",
  borderRadius: 6,
  padding: "3px 7px",
  cursor: "pointer",
  fontSize: 11,
};
