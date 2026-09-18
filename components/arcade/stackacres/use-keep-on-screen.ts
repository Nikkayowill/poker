"use client";

import { useLayoutEffect, useRef } from "react";

/** Gap kept between a nudged card and the edge of the screen, in CSS px. */
const EDGE = 8;

/**
 * Keeps a speech-bubble card (hung beside a character's head) fully on
 * screen. On a phone held sideways the screen is only ~390px tall, so a
 * bubble opened by someone near the right or bottom edge used to run off it.
 *
 * Runs after every render, since the card's size changes with what it shows.
 * A card that would spill off the right side moves to the left of the
 * character instead of on top of them; anything still over an edge is slid
 * back in. Uses the `translate` property so it never fights the card's own
 * `transform` entrance animation.
 */
export function useKeepOnScreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    card.style.translate = "";
    const box = card.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    let dx = 0;
    let dy = 0;
    if (box.right > width - EDGE) {
      // The card hangs 16px right of the pin, so the mirror spot is its own
      // width plus both 16px gaps back to the left.
      const flipped = -(box.width + 32);
      dx = box.left + flipped >= EDGE ? flipped : width - EDGE - box.right;
    }
    if (box.left + dx < EDGE) dx = EDGE - box.left;
    if (box.bottom > height - EDGE) dy = height - EDGE - box.bottom;
    if (box.top + dy < EDGE) dy = EDGE - box.top;
    if (dx !== 0 || dy !== 0) card.style.translate = `${dx}px ${dy}px`;
  });
  return ref;
}
