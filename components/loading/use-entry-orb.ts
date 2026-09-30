"use client";

import { useEffect, useRef } from "react";
import { releaseOrb } from "@/lib/loading/orb-transition";

/**
 * Sign-in turns into the lobby without the URL changing, so the orb layer
 * can't tell on its own when to burst. The entry buttons start the orb
 * (see Lobby) and this releases it once the attempt settles: the gate opened,
 * or the request finished either way and the card has its answer to show.
 */
export function useEntryOrb(entryComplete: boolean, signInPending: boolean) {
  const previous = useRef({ entryComplete, signInPending });
  useEffect(() => {
    const before = previous.current;
    previous.current = { entryComplete, signInPending };
    if ((entryComplete && !before.entryComplete) || (!signInPending && before.signInPending)) releaseOrb();
  }, [entryComplete, signInPending]);
}
