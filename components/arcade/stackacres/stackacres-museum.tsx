"use client";

import { X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { STACKACRES_ITEM_CATALOGUE } from "@/lib/stackacres/items";
import { MUSEUM_EXHIBITS, MUSEUM_EXHIBIT_CATALOGUE, type MuseumRegistry } from "@/lib/stackacres/museum";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * Ray's Museum: the barn's own exhibition hall, reached by tapping the barn
 * on the map (see `onBarnTap` in stackacres-scene.ts / stackacres-world.tsx).
 * Reuses the same `.profile-overlay` / `.profile-modal` shell
 * StackAcresRayWelcome and HowToPlayModal already use.
 *
 * Read-only. There is no "donate" button here -- donation is automatic, the
 * first time an item is ever collected (see collectStackAcres's own doc),
 * and this is purely where a player comes to see what they have found.
 */
export function StackAcresMuseum({
  museum,
  onClose,
}: {
  museum: MuseumRegistry;
  onClose: () => void;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  const donatedCount = Object.values(museum).filter(Boolean).length;
  const totalCount = Object.keys(museum).length;

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section
        className="profile-modal htp-modal sa-museum-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-museum-title"
      >
        <header className="profile-modal-header">
          <div>
            <span>RAY&rsquo;S MUSEUM</span>
            <h2 id="sa-museum-title">
              {donatedCount} of {totalCount} found
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="htp-body sa-museum-body">
          <p className="sa-museum-intro">
            &ldquo;Every kind of thing this farm ever grew, one shelf apiece. First time you bring me
            something new, I&rsquo;ll pay you a finder&rsquo;s bonus for it.&rdquo;
          </p>
          {MUSEUM_EXHIBITS.map((exhibitId) => {
            const exhibit = MUSEUM_EXHIBIT_CATALOGUE[exhibitId];
            return (
              <section key={exhibitId} className="sa-museum-exhibit" aria-labelledby={`sa-exhibit-${exhibitId}`}>
                <h3 id={`sa-exhibit-${exhibitId}`} className="sa-group-label">
                  {exhibit.label}
                </h3>
                <p className="sa-museum-exhibit-blurb">{exhibit.blurb}</p>
                <ul className="sa-museum-items">
                  {exhibit.items.map((item) => {
                    const donated = museum[item] === true;
                    const def = STACKACRES_ITEM_CATALOGUE[item];
                    return (
                      <li
                        key={item}
                        className={donated ? "sa-museum-item is-found" : "sa-museum-item is-unfound"}
                      >
                        <span className="sa-museum-item-badge" aria-hidden="true">
                          <StackAcresIcon name={def.icon as PainterName} size={26} />
                        </span>
                        <span className="sa-museum-item-name">
                          {donated ? def.plural : "???"}
                        </span>
                        <span className="sa-museum-item-status">
                          {donated ? "Found" : "Not yet found"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <p className="sa-museum-hint">
            {donatedCount < totalCount
              ? "Collect from every kind of crop and animal at least once to fill every shelf."
              : "Every shelf is full. Ray thanks you for it."}
          </p>
        </div>
      </section>
    </div>
  );
}
