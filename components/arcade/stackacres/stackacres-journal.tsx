"use client";

import { Check, MapPin, X } from "lucide-react";
import clsx from "clsx";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import type { JournalCue, JournalStep, JournalView } from "@/lib/stackacres/journal";
import { journalChapterLabel } from "@/lib/stackacres/journal";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";

/**
 * The Journal sheet, and the chip that opens it.
 *
 * Replaces the goals sheet, which listed the six chapters and nothing else.
 * Three blocks, in the order a player actually asks the questions: what is
 * waiting on me, what is my farm working toward, and how far does it reach.
 * See lib/stackacres/journal.ts for why they are one sheet rather than five
 * screens.
 *
 * Every number here is derived, never fetched: the sheet re-renders off the
 * same state the optimistic layer patches, so a bed watered a moment ago is
 * already off the "gone dry" line before the server has answered.
 */

/** Ray's face matches the register of the line, not the player's mood. */
const CUE_PORTRAIT: Record<JournalCue["kind"], string> = {
  hungry: "ray-sad",
  collect: "ray-happy",
  contract: "ray-happy",
  harvest: "ray-happy",
  water: "ray-thinking",
  caller: "ray-surprised",
  build: "ray-happy",
  gather: "ray-thinking",
  reach: "ray-thinking",
  idle: "ray-neutral",
};

function NowBlock({ cue }: { cue: JournalCue }) {
  return (
    <div className="sa-journal-now" data-cue={cue.kind}>
      <img src={`/stackacres-td/portraits/${CUE_PORTRAIT[cue.kind]}.png`} alt="" />
      <div>
        <p className="sa-journal-now-line">&ldquo;{cue.line}&rdquo;</p>
        {cue.where && (
          <p className="sa-journal-where">
            <MapPin size={12} aria-hidden="true" /> {cue.where}
          </p>
        )}
      </div>
    </div>
  );
}

function StepLines({ step }: { step: JournalStep }) {
  return (
    <li className={step.built ? "is-built" : undefined}>
      <span className="sa-journal-step-head">
        {step.built && <Check size={12} aria-hidden="true" />} {step.name}
        {!step.built && <span className="sa-journal-place"> in the {step.place}</span>}
      </span>
      {!step.built && (
        <>
          <span className="sa-journal-costs">
            {/* A met line shows what it cost, not "20,000 / 200 Gold": the
                ratio is there to show a shortfall, and there isn't one. */}
            {step.lines.map((line) => (
              <span key={line.label} className={line.met ? "is-met" : undefined}>
                {line.met ? (
                  <>
                    <Check size={11} aria-hidden="true" /> {line.need.toLocaleString()} {line.label}
                  </>
                ) : (
                  `${line.have.toLocaleString()} / ${line.need.toLocaleString()} ${line.label}`
                )}
              </span>
            ))}
          </span>
          {step.lines
            .filter((line) => !line.met && line.source !== null)
            .map((line) => (
              <span key={`${line.label}-source`} className="sa-journal-source">
                {line.source}
              </span>
            ))}
        </>
      )}
      {step.opens && <span className="sa-journal-opens">{step.opens}</span>}
    </li>
  );
}

export function StackAcresJournalSheet({ view, onClose }: { view: JournalView; onClose: () => void }) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="profile-modal htp-modal" role="dialog" aria-modal="true" aria-labelledby="sa-journal-title">
        <header className="profile-modal-header">
          <div>
            <span>STACKACRES</span>
            <h2 id="sa-journal-title">The Journal</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="sa-journal">
          <NowBlock cue={view.now} />

          {view.waiting.length > 0 && (
            <section className="sa-journal-block" aria-labelledby="sa-journal-waiting">
              <h3 id="sa-journal-waiting">While you were out</h3>
              <ul className="sa-journal-waiting">
                {view.waiting.map((row) => (
                  <li key={row.key} className={row.ready ? "is-ready" : undefined}>
                    <span className="sa-journal-waiting-label">{row.label}</span>
                    <span className="sa-journal-waiting-detail">{row.detail}</span>
                    {row.fill !== null && (
                      <span className="sa-journal-meter" aria-hidden="true">
                        <span style={{ width: `${Math.min(1, Math.max(0, row.fill)) * 100}%` }} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="sa-journal-block" aria-labelledby="sa-journal-farm">
            <h3 id="sa-journal-farm">Your farm</h3>
            <ol className="sa-goals-list">
              {view.chapters.map((chapter) => (
                <li key={chapter.number} className={clsx(chapter.done && "is-done", chapter.current && "is-current")}>
                  <span className="sa-goals-num" aria-hidden="true">
                    {chapter.done ? <Check size={14} /> : chapter.number}
                  </span>
                  <div>
                    <h4>
                      {chapter.title}
                      {chapter.done && <span className="sa-sr"> (done)</span>}
                    </h4>
                    <p>{chapter.blurb}</p>
                    <ul>
                      {chapter.steps.map((step) => (
                        <StepLines key={step.kind} step={step} />
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="sa-journal-block" aria-labelledby="sa-journal-reach">
            <h3 id="sa-journal-reach">
              Your reach <span className="sa-journal-standing">Standing {view.standing} of {view.standingMax}</span>
            </h3>
            <ul className="sa-journal-reach">
              {view.reach.map((step) => (
                <li key={step.flag} className={step.done ? "is-done" : undefined}>
                  <span className="sa-journal-tick" aria-hidden="true">
                    {step.done ? <Check size={12} /> : null}
                  </span>
                  <span>
                    {step.label}
                    {step.cost && !step.done && <span className="sa-journal-opens">{step.cost}</span>}
                    {step.brings.length > 0 && (
                      <span className="sa-journal-opens">Brings {step.brings.join(" and ")}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {view.nextMilestoneOpens.length > 0 && (
              <p className="sa-journal-foot">
                Any one more opens {view.nextMilestoneOpens.join(", ")}.
              </p>
            )}
            {view.callers.length > 0 && (
              <ul className="sa-journal-callers">
                {view.callers.map((caller) => (
                  <li key={caller.traveler} className={caller.state === "ready" ? "is-ready" : undefined}>
                    <strong>{caller.name}</strong>{" "}
                    {caller.state === "waiting"
                      ? "is about, and you've not spoken yet"
                      : caller.state === "ready"
                        ? `is ready for: ${caller.detail}`
                        : caller.detail}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

/**
 * The Journal's own entry point. It used to read "Mill · Gold 0 / 200"
 * forever, then "Chapter 1 · Bread / Water the wheat" forever -- either way, a
 * permanent sentence of text sitting over the map. Same standing-badge
 * posture as the Forge and Crossbreeding Bed entries next to it in the HUD
 * (`.sa-prestige-badge`) now: worth a glance, not a paragraph. The current
 * cue, the chapter and the readiness bar are all still one tap away, in the
 * same Journal sheet this button already opened.
 */
export function StackAcresJournalChip({ view, onOpen }: { view: JournalView; onOpen: () => void }) {
  const label = journalChapterLabel(view);
  const chapter = view.currentChapter;
  return (
    <button
      type="button"
      className="sa-prestige-badge"
      onClick={onOpen}
      title={label ? `${label}: ${view.now.short}` : "The Journal"}
    >
      <StackAcresPixelIcon name="journal" />
      <strong>{chapter ? `${chapter.number}/${view.chapters.length}` : "done"}</strong>
    </button>
  );
}
