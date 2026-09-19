"use client";

import { Check, X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  limitingNeed,
  nextStep,
  stepReadiness,
  type Chapter,
  type ChapterView,
  type Need,
} from "@/lib/stackacres/chapters";
import type { MachineKind } from "@/lib/stackacres/machines";
import { seedsOpenedBy } from "@/lib/stackacres/seed-unlocks";

const needText = (need: Need) => `${need.label} ${need.have.toLocaleString()} / ${need.need.toLocaleString()}`;

/** The top-left goal: which chapter you're on and how close the next building is. */
export function StackAcresGoalChip({ view, onOpen }: { view: ChapterView; onOpen: () => void }) {
  const step = nextStep(view);
  if (!step) return null;
  return (
    <button type="button" className="sa-goal" onClick={onOpen} title="Your farm goals">
      <span className="sa-goal-top">
        Chapter {view.chapter.number} &middot; {view.chapter.title}
      </span>
      <span className="sa-goal-line">
        {step.name} &middot; {needText(limitingNeed(step))}
      </span>
      <span className="sa-goal-bar" aria-hidden="true">
        <span style={{ width: `${stepReadiness(step) * 100}%` }} />
      </span>
    </button>
  );
}

/** All six chapters, with what the current building still needs. */
export function StackAcresGoalsSheet({ views, currentNumber, onClose }: { views: ChapterView[]; currentNumber: number | null; onClose: () => void }) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="profile-modal htp-modal" role="dialog" aria-modal="true" aria-labelledby="sa-goals-title">
        <header className="profile-modal-header">
          <div>
            <span>STACKACRES</span>
            <h2 id="sa-goals-title">Farm goals</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <ol className="sa-goals-list">
          {views.map((view) => (
            <li key={view.chapter.number} className={view.done ? "is-done" : view.chapter.number === currentNumber ? "is-current" : undefined}>
              <span className="sa-goals-num" aria-hidden="true">
                {view.done ? <Check size={14} /> : view.chapter.number}
              </span>
              <div>
                <h3>
                  {view.chapter.title}
                  {view.done && <span className="sa-sr"> (done)</span>}
                </h3>
                <p>{view.chapter.blurb}</p>
                <ul>
                  {view.steps.map((step) => (
                    <li key={step.kind} className={step.built ? "is-built" : undefined}>
                      {step.built ? (
                        <>
                          <Check size={12} aria-hidden="true" /> {step.name}
                        </>
                      ) : (
                        <>
                          {step.name}: {step.needs.map(needText).join(", ")}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Ray's word when a chapter is finished, and what comes next. */
export function StackAcresChapterCard({ chapter, built, next, onClose }: { chapter: Chapter; built: ReadonlySet<MachineKind>; next: ChapterView | null; onClose: () => void }) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  const opened = seedsOpenedBy(chapter.steps, built);
  const nextBuilding = next ? nextStep(next) : null;
  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="profile-modal htp-modal" role="dialog" aria-modal="true" aria-labelledby="sa-chapter-title">
        <header className="profile-modal-header">
          <div>
            <span>CHAPTER {chapter.number} DONE</span>
            <h2 id="sa-chapter-title">{chapter.title}</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="htp-body">
          <img src="/stackacres-td/portraits/ray-happy.png" alt="" className="sa-ray-welcome-portrait" />
          <p>&ldquo;{chapter.doneLine}&rdquo;</p>
          {opened && <p className="sa-chapter-opened">{opened}.</p>}
          <p className="sa-chapter-next">
            {next && nextBuilding
              ? `Next up, chapter ${next.chapter.number}: ${next.chapter.title}. ${nextBuilding.name} costs ${nextBuilding.needs.map((need) => `${need.need.toLocaleString()} ${need.label}`).join(" and ")}.`
              : "That's every chapter done. The farm is yours."}
          </p>
          <button type="button" className="sa-cta" onClick={onClose}>
            Thanks, Ray
          </button>
        </div>
      </section>
    </div>
  );
}
