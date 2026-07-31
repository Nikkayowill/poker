"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

/**
 * The turn clock, as a fuse burning around the seat rather than a bar under
 * the controls.
 *
 * Self-contained on purpose. PlayerSeat is memoised with a hand-written
 * comparator, so feeding it a value that changes four times a second would
 * either re-render the entire seat -- figure, cards, plate -- on every tick,
 * or, if the comparator were left alone, silently never update at all. Taking
 * the two ISO strings and running its own interval means the only thing that
 * repaints is this element, and the props it receives stay stable.
 *
 * Drawn with stroke-dashoffset rather than a conic-gradient: conic repaints
 * poorly on mobile, and six of these can be on screen during a hand.
 */

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Green while there is time, then a deliberate slide to red at the end. */
function toneFor(fraction: number): string {
  if (fraction > 0.6) return "safe";
  if (fraction > 0.35) return "warn";
  if (fraction > 0.15) return "urgent";
  return "critical";
}

export function SeatTimer({
  startedAt,
  deadlineAt,
  large = false,
}: {
  startedAt: string | null;
  deadlineAt: string | null;
  large?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineAt) return;
    // 250ms rather than requestAnimationFrame: the ring transitions between
    // ticks in CSS, so a faster loop would spend frames to draw the same arc.
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [deadlineAt]);

  const deadline = Date.parse(deadlineAt ?? "");
  const started = Date.parse(startedAt ?? "");
  if (!Number.isFinite(deadline) || !Number.isFinite(started)) return null;

  const total = deadline - started;
  if (total <= 0) return null;

  const fraction = Math.max(0, Math.min(1, (deadline - now) / total));
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));

  return (
    <span
      className={clsx("seat-timer", `seat-timer-${toneFor(fraction)}`, large && "seat-timer-large")}
      role="timer"
      aria-label={`${seconds} seconds to act`}
    >
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="seat-timer-track" cx="18" cy="18" r={RADIUS} />
        <circle
          className="seat-timer-fuse"
          cx="18"
          cy="18"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          // Full ring at 1, empty at 0. The stroke is rotated to start at the
          // top in CSS so it reads as a clock rather than starting at 3 o'clock.
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <b aria-hidden="true">{seconds}</b>
    </span>
  );
}
