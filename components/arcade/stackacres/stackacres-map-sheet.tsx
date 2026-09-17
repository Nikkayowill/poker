"use client";

import { Lock, MapPin, X } from "lucide-react";
import clsx from "clsx";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { MAP_COLUMNS, MAP_PLACES, MAP_ROWS, type MapPlaceId } from "@/lib/stackacres/map-places";

/**
 * The world map: where everything is, where the farmer is standing, and which
 * gates are still shut.
 *
 * This replaced the How to Play modal and the standing hint caption (Kayo,
 * 2026-09-17): a player who can see the whole farm and walk to any part of it
 * does not need a wall of rules, and a caption repeating the controls forever
 * is only ever read once.
 *
 * A shut place is greyed but still tappable, and walks the farmer to its gate
 * rather than into it -- "show me where that is" is the question a locked
 * place on a map actually asks, and the gate itself already says what opens
 * it (stackacres-sector-modal.tsx).
 */

export interface MapPlaceState {
  readonly id: MapPlaceId;
  readonly label: string;
  readonly col: number;
  readonly row: number;
  readonly open: boolean;
  /** What opens it, for a shut place. */
  readonly locked: string | null;
  /** Where the farmer is standing right now. */
  readonly here: boolean;
}

export interface StackAcresMapSheetProps {
  places: readonly MapPlaceState[];
  onTravel: (id: MapPlaceId) => void;
  onClose: () => void;
}

export function StackAcresMapSheet({ places, onTravel, onClose }: StackAcresMapSheetProps) {
  const { closeButtonRef } = useModalDismiss(onClose);

  return (
    <div className="sa-sheet-scrim" role="dialog" aria-modal="true" aria-label="The map">
      <div className="sa-sheet sa-map-sheet">
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <MapPin size={13} aria-hidden="true" /> The map
            </p>
            <h2>Where to next?</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="sa-sheet-close"
            aria-label="Close the map"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div
          className="sa-map-grid"
          style={{ "--sa-map-cols": MAP_COLUMNS, "--sa-map-rows": MAP_ROWS } as React.CSSProperties}
        >
          {places.map((place) => (
            <button
              key={place.id}
              type="button"
              className={clsx("sa-map-place", { "is-shut": !place.open, "is-here": place.here })}
              style={{ gridColumn: place.col + 1, gridRow: place.row + 1 }}
              onClick={() => onTravel(place.id)}
            >
              <span className="sa-map-place-name">
                {!place.open && <Lock size={11} aria-hidden="true" />}
                {place.label}
              </span>
              {place.here ? (
                <span className="sa-map-here">
                  <MapPin size={12} aria-hidden="true" /> You are here
                </span>
              ) : (
                place.locked && <span className="sa-map-place-note">{place.locked}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The places in map order, with the state the sheet paints each one in. */
export function mapPlaceStates(
  here: MapPlaceId,
  isOpen: (id: MapPlaceId) => boolean,
  lockedNote: (id: MapPlaceId) => string | null,
): MapPlaceState[] {
  return MAP_PLACES.map((place) => {
    const open = isOpen(place.id);
    return {
      id: place.id,
      label: place.label,
      col: place.col,
      row: place.row,
      open,
      locked: open ? null : lockedNote(place.id),
      here: place.id === here,
    };
  });
}
