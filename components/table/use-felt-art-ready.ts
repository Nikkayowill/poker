"use client";

/**
 * Whether the 2D table's felt/rail art has actually finished loading.
 *
 * Sibling to use-webgl-support.ts, but this one genuinely changes after
 * mount. Unlike GL support, an image's load state is not knowable at
 * render time, so this is a real effect-driven value rather than a
 * useSyncExternalStore snapshot.
 *
 * `TableScene`'s own onReady fires the instant its canvas exists, which
 * says nothing about whether the CSS background-image plate underneath it
 * (see app/styles/06-table.css, 12-responsive.css) has arrived. That's
 * what left the 2D table with no equivalent to the 3D room's loading
 * splash. This hook is the missing signal: poker-table.tsx ANDs it with
 * TableScene's own mount signal before reporting the room ready.
 */

import { useEffect, useState } from "react";
import { feltSrcForViewport, ROOM_BACKDROP_SRC } from "@/lib/scene/felt-art";

/**
 * A fail-open safety net for a stalled fetch, well under the splash's own
 * 11s AUTO_HIDE_MS backstop so the natural path (the image genuinely
 * finishing) always wins first when the room is merely slow rather than
 * broken. Mirrors the two-tier timeout the 3D room already uses (its own
 * avatar-load timeout, then the splash's backstop on top of that).
 */
const FELT_ART_TIMEOUT_MS = 5_000;

function preload(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.src = src;
    image.decode().then(() => resolve(), () => resolve());
  });
}

export function useFeltArtReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const felt = feltSrcForViewport(window.innerWidth);

    const timeout = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, FELT_ART_TIMEOUT_MS);

    Promise.all([preload(felt), preload(ROOM_BACKDROP_SRC)]).then(() => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      setReady(true);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  return ready;
}
