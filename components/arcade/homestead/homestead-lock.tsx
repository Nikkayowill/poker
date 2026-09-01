"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { tapSound } from "@/lib/audio/ui-sounds";

/**
 * The door. Takes the access code, and on success reloads rather than swapping
 * the farm in place -- the page is a server component that reads the pass
 * cookie, so a reload is what makes it re-decide, and it is one line instead
 * of lifting the whole farm's data fetch into a client boundary it does not
 * otherwise need.
 *
 * Deliberately says nothing about who the code is for or how to get one. A
 * locked door that explains itself is an invitation to ask, and the answer is
 * always going to be "someone tells you".
 */
export function HomesteadLock() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || code.trim().length === 0) return;
    tapSound();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/homestead/unlock", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
      if (response.status === 429) {
        setError("Too many tries. Give it a few minutes.");
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "That code did not work.");
    } catch {
      setError("Could not reach the farm. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="duel-shell ante-shell hs-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink />
        </div>
      </header>

      <div className="hs-gate">
        <div className="hs-gate-card">
          <span className="hs-gate-icon" aria-hidden="true">
            <KeyRound size={20} />
          </span>
          {/* Same class the farm's own screen uses for its title, so the door
              and the room behind it are named in one voice. */}
          <div className="ante-lobby-heading">
            <h1>StackChips Homestead</h1>
          </div>
          <p>A farm of crops and livestock. It is not open to everyone yet — you need the code.</p>
          <form onSubmit={submit}>
            <label className="hs-gate-label" htmlFor="hs-code">
              Access code
            </label>
            <input
              id="hs-code"
              className="hs-gate-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={busy}
            />
            <button type="submit" className="hs-cta" disabled={busy || code.trim().length === 0}>
              {busy ? "Checking…" : "Open the gate"}
            </button>
          </form>
          {error && (
            <p className="duel-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
