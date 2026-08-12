"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import clsx from "clsx";
import { selectSound } from "@/lib/audio/ui-sounds";

/**
 * "Share with friends" for a finished daily puzzle.
 *
 * Native share sheet first, clipboard second. On a phone -- which is where a
 * result actually gets posted -- `navigator.share` opens the OS drawer, so the
 * grid goes straight into iMessage, WhatsApp or wherever the player's group
 * chat lives. On a desktop browser without the API it falls back to copying,
 * which is what a player would have done by hand anyway.
 *
 * ## Three details that are easy to get wrong
 *
 * **The API must be called inside the gesture.** Safari on iOS rejects
 * `navigator.share` if the promise chain awaits anything first -- the user
 * activation is spent by then. So the click handler calls it directly rather
 * than, say, fetching a fresh snapshot and sharing that. The text is prepared
 * before the click, not during it.
 *
 * **A cancelled share is not a failure.** Dismissing the sheet rejects with an
 * AbortError, and treating that as "native share did not work, fall back to
 * clipboard" would silently write to the clipboard of a player who had just
 * decided not to share. Aborts return quietly and change nothing.
 *
 * **The link goes in the text, not in `url`.** Several share targets, given
 * both, keep the URL and drop the text -- which posts a bare link where the
 * emoji grid should be, losing the entire point. One text field, link on its
 * own last line, is what survives the most targets intact.
 */

/** How long the confirmation sits before the button returns to its resting label. */
const TOAST_MS = 2400;

type ShareOutcome = "shared" | "copied" | "failed";

export function ShareResultButton({
  text,
  title,
  label = "Share with friends",
  className,
}: {
  /** The finished result, grid and all. Built by lib/arcade/puzzles/share.ts. */
  text: string;
  /** Subject line for the native sheet. */
  title: string;
  label?: string;
  className?: string;
}) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const timer = useRef<number | null>(null);

  const announce = useCallback((next: ShareOutcome) => {
    setOutcome(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOutcome(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const share = useCallback(async () => {
    // Called first and unawaited-before, so the user activation is still live.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text });
        announce("shared");
        return;
      } catch (error) {
        // The player dismissed the sheet. That is a decision, not a fault --
        // falling through to the clipboard here would write behind their back.
        if (error instanceof Error && error.name === "AbortError") return;
        // Anything else (no compatible target, a policy block) is worth
        // falling back for.
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      announce("copied");
    } catch {
      // Clipboard access can be denied by browser policy, and there is nowhere
      // left to go -- the grid is on screen, so say so rather than pretending.
      announce("failed");
    }
  }, [announce, text, title]);

  return (
    <div className={clsx("puzzle-share", className)}>
      <button type="button" className="puzzle-share-button" onClick={() => { selectSound(); void share(); }}>
        {outcome === "copied" || outcome === "shared"
          ? <Check size={16} aria-hidden="true" />
          : <Share2 size={16} aria-hidden="true" />}
        {label}
      </button>

      {/* Polite, not assertive: a confirmation should not interrupt a screen
          reader mid-sentence. The region is always mounted so the update is
          announced as a change rather than as new content appearing. */}
      <p className={clsx("puzzle-toast", outcome && "puzzle-toast-on")} role="status" aria-live="polite">
        {outcome === "shared" && "Shared."}
        {outcome === "copied" && (
          <>
            <Copy size={12} aria-hidden="true" /> Copied — paste it anywhere.
          </>
        )}
        {outcome === "failed" && "Could not copy. Select the grid above instead."}
      </p>
    </div>
  );
}
