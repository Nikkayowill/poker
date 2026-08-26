"use client";

import { useCallback, useState } from "react";

/**
 * "Copy to clipboard, then flash a checkmark for a moment" -- the same
 * try/writeText/flash/silently-swallow-the-catch shape used to be hand-copied
 * at every call site (the room code, a profile id, an invite link, an admin
 * row's id). Failure is always silent by design: whatever was being copied
 * stays visible on screen either way, so there is nothing to recover from a
 * denied clipboard permission.
 *
 * Tracks the copied *value* rather than a bare boolean so a caller copying
 * one of several possible values (admin-dashboard's per-row ids) can tell
 * which one just landed, and so a stale reset can never clobber a newer copy
 * -- the reset only clears the flag if it is still the value that set it.
 */
export function useClipboardCopy(resetAfterMs = 1800) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.setTimeout(() => {
        setCopiedValue((current) => (current === value ? null : current));
      }, resetAfterMs);
    } catch {
      // Clipboard access can be denied by browser policy; whatever was being
      // copied is still visible on screen, so there is nothing to recover.
    }
  }, [resetAfterMs]);

  return { copiedValue, copy };
}
