"use client";

import { useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { ArrowLeft, Backpack, Dna } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import type { CrossbreedItem } from "@/lib/stackacres/crossbreed-items";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import type { MachineItemId } from "@/lib/stackacres/machine-items";
import {
  GUIDE_DESTINATION_LABELS,
  GUIDE_ITEM_IDS,
  isCrossbreedGuideItem,
  isObtainable,
  resourceGuideEntry,
  type GuideDestinationId,
  type GuideItemId,
  type ResourceGuideEntry,
} from "@/lib/stackacres/resource-guide";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The Resource Guide: everything the player can hold, and for each item what
 * it is for, where to get more and a button to go there.
 *
 * Same sheet chrome and pointer containment as the Workshop: the scene reads
 * raw pointer events off its host element, so a press in here is stopped here.
 * The content itself comes from lib/stackacres/resource-guide.ts.
 */

export interface ResourceGuideSheetProps {
  inventory: StackAcresInventory;
  crossbreedInventory: Partial<Record<CrossbreedItem, number>>;
  /** Open straight onto one item, e.g. from a row in the Workshop. */
  initialItem?: GuideItemId | null;
  /** The farm closes this sheet and opens the screen. */
  onOpenDestination: (destination: GuideDestinationId) => void;
  onClose: () => void;
}

function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

function heldOf(item: GuideItemId, inventory: StackAcresInventory, crossbreed: Partial<Record<CrossbreedItem, number>>) {
  return isCrossbreedGuideItem(item) ? (crossbreed[item] ?? 0) : inventoryQuantity(inventory, item as MachineItemId);
}

function ItemIcon({ entry, size }: { entry: ResourceGuideEntry; size: number }) {
  // The hybrids have no painted icon yet.
  if (isCrossbreedGuideItem(entry.item)) return <Dna size={size} aria-hidden="true" />;
  return <StackAcresIcon name={entry.icon as PainterName} size={size} />;
}

export function ResourceGuideSheet({
  inventory,
  crossbreedInventory,
  initialItem = null,
  onOpenDestination,
  onClose,
}: ResourceGuideSheetProps) {
  const [selected, setSelected] = useState<GuideItemId | null>(initialItem);
  const [showAll, setShowAll] = useState(false);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  const held = GUIDE_ITEM_IDS.filter((item) => heldOf(item, inventory, crossbreedInventory) > 0);
  const listed = showAll ? GUIDE_ITEM_IDS : held;
  const entry = selected ? resourceGuideEntry(selected) : null;
  const quantity = selected ? heldOf(selected, inventory, crossbreedInventory) : 0;

  return (
    <div
      className="sa-sheet-scrim"
      role="presentation"
      onMouseDown={contain(onBackdropMouseDown)}
      onPointerDown={contain()}
      onPointerUp={contain()}
      onPointerMove={contain()}
      onTouchStart={contain()}
      onTouchMove={contain()}
      onClick={contain()}
      onWheel={contain()}
    >
      <section
        className="sa-sheet sa-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-guide-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Backpack size={13} aria-hidden="true" /> Resource Guide
            </p>
            <h2 id="sa-guide-title">{entry ? entry.label : "What you are carrying"}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="sa-sheet-close" onClick={contain(onClose)}>
            Done
          </button>
        </header>

        {entry && selected ? (
          <div className="sa-guide-detail">
            <button type="button" className="sa-guide-back" onClick={contain(() => setSelected(null))}>
              <ArrowLeft size={14} aria-hidden="true" /> All items
            </button>

            <div className="sa-guide-hero">
              <ItemIcon entry={entry} size={36} />
              <div>
                <p className="sa-guide-qty">You have {quantity.toLocaleString()}</p>
                <p className="sa-guide-desc">{entry.description}</p>
              </div>
            </div>

            <p className="sa-group-label">What it is for</p>
            <ul className="sa-guide-rows" aria-label="Uses">
              {entry.uses.map((use) => (
                <li key={`${use.kind}:${use.label}`}>
                  <span className="sa-guide-row-text">
                    <strong>{use.label}</strong>
                    {use.detail && <small>{use.detail}</small>}
                  </span>
                  {use.destination && (
                    <button
                      type="button"
                      className="sa-cta sa-guide-go"
                      onClick={contain(() => onOpenDestination(use.destination!))}
                    >
                      {GUIDE_DESTINATION_LABELS[use.destination]}
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <p className="sa-group-label">Where to get more</p>
            <ul className="sa-guide-rows" aria-label="Sources">
              {entry.sources.map((source) => (
                <li key={source.label} className={clsx(!source.open && "is-closed")}>
                  <span className="sa-guide-row-text">
                    <strong>{source.label}</strong>
                    {!source.open && <small>Not open yet. {source.note}</small>}
                  </span>
                  {source.open && source.destination && (
                    <button
                      type="button"
                      className="sa-cta sa-guide-go"
                      onClick={contain(() => onOpenDestination(source.destination!))}
                    >
                      {GUIDE_DESTINATION_LABELS[source.destination]}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!isObtainable(selected) && (
              <p className="sa-sheet-note">You cannot get more of this yet, so use what you have wisely.</p>
            )}
          </div>
        ) : (
          <>
            <p className="sa-sheet-note">Tap anything to see what it is for and where to get more.</p>
            {listed.length === 0 ? (
              <p className="sa-workshop-empty">Nothing yet. Chop a tree, cast a line or harvest a bed.</p>
            ) : (
              <ul className="sa-guide-list">
                {listed.map((item) => {
                  const row = resourceGuideEntry(item);
                  const count = heldOf(item, inventory, crossbreedInventory);
                  return (
                    <li key={item}>
                      <button
                        type="button"
                        className={clsx("sa-guide-item", count === 0 && "is-empty")}
                        aria-label={`${row.label}, ${count.toLocaleString()} held`}
                        onClick={contain(() => setSelected(item))}
                      >
                        <ItemIcon entry={row} size={22} />
                        <span className="sa-guide-item-name">{row.label}</span>
                        <strong>{count.toLocaleString()}</strong>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" className="sa-cta sa-guide-toggle" onClick={contain(() => setShowAll((value) => !value))}>
              {showAll ? "Only what I have" : `Show all ${GUIDE_ITEM_IDS.length} items`}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
