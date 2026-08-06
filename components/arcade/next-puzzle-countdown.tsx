"use client";

import { useEffect, useState } from "react";

/**
 * "Next puzzle in 4:12:08".
 *
 * The server sends the remaining milliseconds with every response rather than
 * the client working out when the next UTC midnight is. That keeps one
 * definition of the day boundary -- lib/arcade/puzzles/daily.ts -- instead of
 * a second one in the browser that could disagree with it, which on a device
 * with a wrong clock is exactly what would happen.
 *
 * Ticking once a second re-renders only this component, and only on a finished
 * board. The table's turn clock learned the hard way that a 4Hz state tick
 * re-rendering a whole tree is a real cost (see use-fuse.ts); one second on a
 * leaf node with three numbers in it is not the same thing.
 */
export function NextPuzzleCountdown({ deadline }: { deadline: number }) {
  // An absolute deadline plus a ticking clock, rather than a remaining-ms
  // counter an effect resets and the interval decrements. Two reasons, and the
  // lint rules that flag the alternatives are right about both: subtracting
  // from state inside an effect is the cascading-render pattern, and it drifts
  // -- a throttled background tab fires the interval late, and a counter that
  // subtracts a fixed second per late tick runs slow for the rest of its life.
  // Reading the clock instead is self-correcting.
  //
  // The deadline is computed by the caller when the response arrives, which is
  // both the moment the server's figure was accurate and a place where reading
  // the clock is not an impure call during render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const total = Math.floor(Math.max(0, deadline - now) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    <p className="puzzle-countdown">
      Next puzzle in <strong>{hours}:{pad(minutes)}:{pad(seconds)}</strong>
    </p>
  );
}
