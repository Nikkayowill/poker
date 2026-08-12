"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import clsx from "clsx";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import {
  FIRST_RUN_DONE,
  FIRST_RUN_STEPS,
  FIRST_RUN_STORAGE_KEY,
  firstRunProgressLabel,
  nextFirstRunStep,
  shouldShowFirstRun,
} from "@/lib/lobby/first-run";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  browserPreferenceStorage,
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/profile/stored-preference";

/** Nothing mutates this key from outside the tab, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};

/** The server has no storage, so it renders no strip and the client fills it in. */
const serverSnapshot = () => null;

function readRetirementFlag(): string | null {
  return readStoredPreference(browserPreferenceStorage(), {
    key: FIRST_RUN_STORAGE_KEY,
    parse: (raw) => raw,
  });
}

/**
 * The one numbered strip at the top of the hub, and the app's only onboarding.
 *
 * All of the rules -- what the steps are, what retires it, how the counter
 * reads -- are in `lib/lobby/first-run.ts` where `npm test` can see them. This
 * file is the markup and the two pieces of browser state: which step is
 * showing, and whether the strip has retired.
 *
 * WHY useSyncExternalStore AND NOT useStoredPreference
 *
 * The app's other localStorage values go through `useStoredPreference`, which
 * deliberately *defers* the restored value by a tick so the server's markup is
 * not swapped underneath a hydration in progress. That is right for a mute --
 * one frame at the wrong volume is nothing -- and wrong here: a deferred read
 * means every returning player watches an onboarding strip appear and then
 * vanish on every single load of the hub, which is a worse impression than the
 * strip itself ever makes.
 *
 * `useSyncExternalStore` is the shape that fits: it renders the *server*
 * snapshot (null -- no storage exists there, so no strip) and then the client
 * snapshot in the same commit as hydration, with no effect, no deferred
 * setState, and no mismatch to reconcile. Nothing outside this tab writes the
 * key, so the subscribe callback has nothing to listen to; retirement inside
 * the tab is held in ordinary state beside it.
 */
export function FirstRunStrip({
  /** Opens the buy-in modal -- the same handler the Texas Hold'em tile drives. */
  onTakeSeat,
  profile,
}: {
  onTakeSeat: () => void;
  profile: PlayerProfile;
}) {
  const stored = useSyncExternalStore(noSubscribe, readRetirementFlag, serverSnapshot);
  /** Retired during this render pass, before the storage read would notice. */
  const [retiredNow, setRetiredNow] = useState(false);
  const [index, setIndex] = useState(0);

  const retire = useCallback(() => {
    setRetiredNow(true);
    writeStoredPreference(browserPreferenceStorage(), FIRST_RUN_STORAGE_KEY, FIRST_RUN_DONE);
  }, []);

  const advance = () => {
    const next = nextFirstRunStep(index);
    if (next === null) retire();
    else setIndex(next);
  };

  if (retiredNow) return null;
  if (!shouldShowFirstRun(stored, profile.isRegistered)) return null;

  const step = FIRST_RUN_STEPS[Math.min(index, FIRST_RUN_STEPS.length - 1)];
  if (!step) return null;

  return (
    <section className="first-run" aria-label="Getting started">
      <header className="first-run-head">
        <span className="lobby-kicker">Start here</span>
        <span className="first-run-count">{firstRunProgressLabel(index)}</span>
      </header>

      <p className="first-run-body">{step.body}</p>

      <div className="first-run-actions">
        {/* The primary carries the accent as a line and the light off it, not
            as a fill: the gold Play/Join controls elsewhere in the hub are the
            things a player is meant to find first, and an onboarding hint that
            outshouts them has its priorities backwards. */}
        {step.action.kind === "link" ? (
          <Link className="first-run-go" href={step.action.href} onClick={() => { tapSound(); retire(); }}>
            {step.actionLabel}
          </Link>
        ) : (
          <button
            type="button"
            className="first-run-go"
            onClick={() => {
              selectSound();
              retire();
              onTakeSeat();
            }}
          >
            {step.actionLabel}
          </button>
        )}
        <button type="button" className="first-run-next" onClick={() => { tapSound(); advance(); }}>
          {step.nextLabel}
        </button>
      </div>

      {/* One dash per step. aria-hidden because the counter above already
          states the same position in words, and a screen reader should hear
          it once. */}
      <div className="first-run-ticks" aria-hidden="true">
        {FIRST_RUN_STEPS.map((each, position) => (
          <span key={each.id} className={clsx("first-run-tick", position <= index && "is-done")} />
        ))}
      </div>
    </section>
  );
}

/**
 * Retires the strip from outside it -- called when a player reaches a table.
 *
 * Exported rather than duplicated in components/poker-app.tsx so the key and
 * the value are written in exactly one place. The strip is unmounted at the
 * moment this fires -- Lobby has been replaced by PokerTable -- so the flag,
 * not a prop, is what makes the retirement stick when the player stands up
 * and comes back.
 */
export function retireFirstRunStrip(): void {
  const storage = browserPreferenceStorage();
  // Read first so a player who finished the strip weeks ago does not have the
  // key rewritten on every table they join.
  const already = readStoredPreference(storage, {
    key: FIRST_RUN_STORAGE_KEY,
    parse: (raw) => raw,
  });
  if (already === FIRST_RUN_DONE) return;
  writeStoredPreference(storage, FIRST_RUN_STORAGE_KEY, FIRST_RUN_DONE);
}
