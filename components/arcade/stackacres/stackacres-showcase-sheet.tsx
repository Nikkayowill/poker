"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Eye, X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  FARM_VISIBILITIES,
  FARM_VISIBILITY_BLURBS,
  FARM_VISIBILITY_LABELS,
  SHOWCASE_REACTIONS,
  emptyReactionCounts,
  type FarmVisibility,
  type ShowcaseReactionCounts,
} from "@/lib/stackacres/showcase";

/**
 * "Who can visit my farm", and what the visitors thought.
 *
 * Its own sheet rather than a row in the Journal: the Journal answers "what
 * now", and this is a setting about other people. Fetched on open rather than
 * carried in the farm's own view, because nobody needs this number on the HUD
 * and the farm read is already the heaviest request in the app.
 *
 * Private is the default and stays the default. Nothing in here turns
 * anything on by being opened.
 */

interface Settings {
  visibility: FarmVisibility;
  reactions: ShowcaseReactionCounts;
}

export function StackAcresShowcaseSheet({
  profileId,
  onClose,
}: {
  profileId: string;
  onClose: () => void;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/stackacres/showcase", { cache: "no-store" });
        if (!response.ok) throw new Error("load failed");
        const body = (await response.json()) as Settings;
        if (!cancelled) setSettings(body);
      } catch {
        if (!cancelled) setError("Couldn't load your visitor setting.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback(
    async (visibility: FarmVisibility) => {
      if (saving) return;
      setSaving(true);
      setError(null);
      // Shown straight away, then reconciled: the same optimistic posture
      // every other farm control takes. A refusal puts the old value back
      // because the response carries the setting the server actually holds.
      setSettings((current) => (current ? { ...current, visibility } : current));
      try {
        const response = await fetch("/api/stackacres/showcase", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility }),
        });
        if (!response.ok) throw new Error("save failed");
        setSettings((await response.json()) as Settings);
      } catch {
        setError("Couldn't save that. Try again.");
        try {
          const fresh = await fetch("/api/stackacres/showcase", { cache: "no-store" });
          if (fresh.ok) setSettings((await fresh.json()) as Settings);
        } catch {
          // The banner above already says the setting on screen may be stale.
        }
      } finally {
        setSaving(false);
      }
    },
    [saving],
  );

  const reactions = settings?.reactions ?? emptyReactionCounts();
  const total = SHOWCASE_REACTIONS.reduce((sum, reaction) => sum + reactions[reaction.id], 0);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section
        className="profile-modal htp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-showcase-title"
      >
        <header className="profile-modal-header">
          <div>
            <span>STACKACRES</span>
            <h2 id="sa-showcase-title">Farm visitors</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="sa-showcase">
          {error && (
            <p className="sa-showcase-error" role="alert">
              {error}
            </p>
          )}

          <fieldset className="sa-showcase-choices">
            <legend>Who can look around your farm</legend>
            {FARM_VISIBILITIES.map((visibility) => (
              <button
                key={visibility}
                type="button"
                className={clsx("sa-showcase-choice", {
                  "is-on": settings?.visibility === visibility,
                })}
                aria-pressed={settings?.visibility === visibility}
                disabled={!settings || saving}
                onClick={() => void choose(visibility)}
              >
                <strong>{FARM_VISIBILITY_LABELS[visibility]}</strong>
                <span>{FARM_VISIBILITY_BLURBS[visibility]}</span>
              </button>
            ))}
          </fieldset>

          <p className="sa-showcase-note">
            A visitor can pan and pinch around your farm. They can&apos;t plant, harvest, move
            anything or spend a single Gold, and nothing they do changes your farm.
          </p>

          <section className="sa-showcase-tally" aria-label="Reactions left on your farm">
            <h3>What visitors said</h3>
            {total === 0 ? (
              <p className="sa-showcase-note">Nobody has left a reaction yet.</p>
            ) : (
              <ul>
                {SHOWCASE_REACTIONS.map((reaction) => (
                  <li key={reaction.id}>
                    <span>{reaction.label}</span>
                    <strong>{reactions[reaction.id]}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Link href={`/games/stackacres/visit/${profileId}`} className="sa-cta sa-showcase-preview">
            <Eye size={14} aria-hidden="true" />
            See your farm the way a visitor does
          </Link>
        </div>
      </section>
    </div>
  );
}

/** The sheet's entry point, in the same standing-badge row as the Journal,
 *  the Forge and the Crossbreeding Bed. */
export function StackAcresShowcaseChip({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="sa-prestige-badge"
      onClick={onOpen}
      /* The badge is icon-only, so the label has to be said rather than
         left to the title attribute. */
      aria-label="Farm visitors"
      title="Farm visitors"
      data-label="Visitors"
    >
      <Eye size={13} aria-hidden="true" />
    </button>
  );
}
