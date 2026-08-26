"use client";

import { useEffect, useRef } from "react";

/**
 * Drives a turn clock from CSS rather than from React.
 *
 * Both fuses, the ring around a seat and the bar under the action controls,
 * used to be animated by a `setInterval` that called `setState` four times a
 * second. For the ring that re-rendered one memoised seat; for the bar the
 * state lived in PokerTable, the root of the table tree, so every seat, every
 * card and every plate re-rendered 4Hz for the whole of every turn. That is
 * what the stutter was: not a slow animation, but a fast one competing with a
 * render.
 *
 * What replaces it is the observation that a turn clock is fully described
 * before it starts. The server sends the two timestamps; the elapsed time and
 * the duration follow from them, and from there the browser can run the whole
 * animation itself. This hook writes exactly two custom properties onto the
 * element and then does nothing until the deadline changes:
 *
 *   --fuse-duration  how long the whole turn is
 *   --fuse-delay     negative elapsed, so a clock joined late (a reload, a
 *                    reconnect, a seat that mounts mid-turn) starts part-way
 *                    through instead of restarting from full
 *
 * The stylesheet reads those and animates. No component re-renders while a
 * turn runs.
 *
 * Returns null-safety by doing nothing: given no deadline it clears the
 * properties, and the stylesheet's `animation` shorthand collapses to nothing
 * without them.
 */
export function useFuse(startedAt: string | null, deadlineAt: string | null) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const deadline = Date.parse(deadlineAt ?? "");
    const started = Date.parse(startedAt ?? "");
    const total = deadline - started;
    if (!Number.isFinite(deadline) || !Number.isFinite(started) || total <= 0) {
      element.style.removeProperty("--fuse-duration");
      element.style.removeProperty("--fuse-delay");
      return;
    }

    // Clamped into the turn: a clock that mounts after its own deadline gets
    // a delay of exactly -total, which lands the animation on its final frame
    // rather than somewhere past the end of the keyframe list.
    const elapsed = Math.max(0, Math.min(total, Date.now() - started));
    element.style.setProperty("--fuse-duration", `${total}ms`);
    element.style.setProperty("--fuse-delay", `-${elapsed}ms`);
  }, [startedAt, deadlineAt]);

  return ref;
}

/**
 * The seconds remaining, written straight into an element's text.
 *
 * Separate from useFuse because it is the one part of a turn clock that CSS
 * cannot express: `content` cannot count, and animating a registered numeric
 * property still cannot render itself as text. So this ticks, but outside
 * React, writing through a ref and only when the whole second it would
 * display actually changes, which is at most once a second and never a render.
 *
 * requestAnimationFrame rather than an interval so it stops while the tab is
 * in the background and resyncs on return, instead of drifting and then
 * catching up in a burst.
 */
export function useFuseDigit(startedAt: string | null, deadlineAt: string | null) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const deadline = Date.parse(deadlineAt ?? "");
    if (!Number.isFinite(deadline)) return;

    let frame = 0;
    let shown = -1;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (seconds !== shown) {
        shown = seconds;
        const element = ref.current;
        if (element) {
          element.textContent = String(seconds);
          // The label is the accessible value here; the digit itself is
          // aria-hidden, since a bare number read out of context is noise.
          element.parentElement?.setAttribute("aria-label", `${seconds} seconds to act`);
        }
      }
      if (seconds > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAt, deadlineAt]);

  return ref;
}
