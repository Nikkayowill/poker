"use client";

import { ChevronRight, Compass, X } from "lucide-react";
import clsx from "clsx";
import {
  actionProgress,
  isActionable,
  missingRequirements,
  missingSummary,
  type NextAction,
} from "@/lib/stackacres/next-action";

/**
 * The Farm Planner panel: one objective, pinned over the map.
 *
 * The Journal (./stackacres-journal.tsx) answers the same question in full,
 * but only once the player taps its badge. This is the standing version of
 * its top line, and it carries the three things a sheet does not need and a
 * panel does: the objective on its own line, what is still missing with where
 * each missing thing comes from, and a button straight to the screen that
 * finishes it. Everything it shows comes from lib/stackacres/next-action.ts,
 * which reads the Journal's own ladder -- there is no second idea here of
 * what matters most.
 *
 * DISMISSIBLE, AND IT STAYS DISMISSED. A standing line of text over the map
 * is exactly what was taken off this screen when the Journal replaced the old
 * goal chip, so the panel is never forced: dismissing it leaves the small
 * `Next` button in its place, which brings it straight back. The choice is
 * kept per device in `localStorage` (the same place the farm already keeps
 * `sa-ray-welcomed` and the picked cutter), not on the profile -- it is a
 * preference about this screen, not farm state, and there is nothing for the
 * server to be authoritative about.
 *
 * It re-renders off the snapshot like everything else on this screen, so an
 * objective finished by an optimistic tap is already gone before the server
 * has answered.
 */

function Requirement({
  label,
  have,
  need,
  source,
}: {
  label: string;
  have: number;
  need: number;
  source: string | null;
}) {
  return (
    <li className={have >= need ? "is-met" : undefined}>
      <span className="sa-next-req-line">
        <span className="sa-next-req-label">{label}</span>
        <span className="sa-next-req-count">
          {have.toLocaleString()} / {need.toLocaleString()}
        </span>
      </span>
      {source && <span className="sa-next-req-source">{source}</span>}
    </li>
  );
}

export function StackAcresNextActionPanel({
  action,
  onGo,
  onDismiss,
}: {
  action: NextAction;
  onGo: (action: NextAction) => void;
  onDismiss: () => void;
}) {
  const missing = missingRequirements(action);
  const summary = missingSummary(action);
  const progress = actionProgress(action);
  return (
    <aside
      className={clsx("sa-next", { "is-ready": isActionable(action) })}
      data-cue={action.cue}
      aria-labelledby="sa-next-title"
    >
      <div className="sa-next-head">
        <span className="sa-next-kicker">
          <Compass size={12} aria-hidden="true" /> Next
        </span>
        <button
          type="button"
          className="sa-next-dismiss"
          onClick={onDismiss}
          aria-label="Hide what to do next"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {/* `role="status"` so a screen reader hears the new objective when one
          replaces another, rather than only on first render. */}
      <div role="status">
        <h2 id="sa-next-title" className="sa-next-title">
          {action.title}
        </h2>
        <p className="sa-next-why">{action.why}</p>
      </div>

      {action.requirements.length > 0 && (
        <>
          <span className="sa-next-meter" aria-hidden="true">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
          {summary ? (
            <p className="sa-next-missing">
              <strong>Missing:</strong> {summary}
            </p>
          ) : (
            <p className="sa-next-missing is-met">Everything it needs is in hand.</p>
          )}
          <ul className="sa-next-reqs">
            {(summary ? missing : action.requirements).map((requirement) => (
              <Requirement
                key={requirement.label}
                label={requirement.label}
                have={requirement.have}
                need={requirement.need}
                source={requirement.source}
              />
            ))}
          </ul>
        </>
      )}

      {/* `sa-cta` is the farm's own sprout-green 9-slice button paint
          (52-stackacres.css); `sa-next-go` only adds this panel's layout. */}
      {action.button && (
        <button type="button" className="sa-cta sa-next-go" onClick={() => onGo(action)}>
          <span>{action.button.label}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
    </aside>
  );
}

/** What sits in the panel's place once it has been dismissed. Small enough to
 *  ignore, obvious enough to find again. */
export function StackAcresNextActionReopen({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="sa-prestige-badge sa-next-reopen" onClick={onOpen}>
      <Compass size={13} aria-hidden="true" />
      <span>Next</span>
    </button>
  );
}
