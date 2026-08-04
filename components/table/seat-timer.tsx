"use client";

import clsx from "clsx";
import { useFuse, useFuseDigit } from "./use-fuse";

/**
 * The turn clock, as a fuse burning around the seat rather than a bar under
 * the controls.
 *
 * Self-contained on purpose. PlayerSeat is memoised with a hand-written
 * comparator, so feeding it a value that changes four times a second would
 * either re-render the entire seat -- figure, cards, plate -- on every tick,
 * or, if the comparator were left alone, silently never update at all.
 *
 * It used to run its own 250ms interval and re-render itself on each tick,
 * with a CSS transition smoothing the gaps between the four samples a second
 * it produced. Now it renders once per turn: useFuse hands the two timestamps
 * to the stylesheet as a duration and a negative delay, and the browser
 * animates the arc and the colour without React in the loop at all. Only the
 * digit still ticks, and it ticks through a ref rather than through state.
 *
 * Drawn with stroke-dashoffset rather than a conic-gradient: conic repaints
 * poorly on mobile, and six of these can be on screen during a hand.
 */

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SeatTimer({
  startedAt,
  deadlineAt,
  large = false,
}: {
  startedAt: string | null;
  deadlineAt: string | null;
  large?: boolean;
}) {
  const fuseRef = useFuse(startedAt, deadlineAt);
  const digitRef = useFuseDigit(startedAt, deadlineAt);

  const deadline = Date.parse(deadlineAt ?? "");
  const started = Date.parse(startedAt ?? "");
  if (!Number.isFinite(deadline) || !Number.isFinite(started)) return null;
  if (deadline - started <= 0) return null;

  return (
    <span
      ref={fuseRef as React.RefObject<HTMLSpanElement>}
      className={clsx("seat-timer", large && "seat-timer-large")}
      role="timer"
      // Replaced by useFuseDigit on its first frame; this is what a screen
      // reader gets in the gap before it, and if scripting never runs.
      aria-label="Time to act"
      // The dash length the keyframes animate towards. Passed as a property
      // rather than written into the stylesheet because it is derived from the
      // radius, and the two must not be able to drift apart.
      style={{ ["--fuse-circumference" as string]: CIRCUMFERENCE }}
    >
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="seat-timer-track" cx="18" cy="18" r={RADIUS} />
        <circle
          className="seat-timer-fuse"
          cx="18"
          cy="18"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
        />
      </svg>
      <b ref={digitRef as React.RefObject<HTMLElement>} aria-hidden="true" />
    </span>
  );
}
