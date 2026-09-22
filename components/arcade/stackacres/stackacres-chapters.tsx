"use client";

import { X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { nextStep, type Chapter, type ChapterView } from "@/lib/stackacres/chapters";
import type { MachineKind } from "@/lib/stackacres/machines";
import { seedsOpenedBy } from "@/lib/stackacres/seed-unlocks";

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
