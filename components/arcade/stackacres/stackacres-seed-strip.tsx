"use client";

import { useEffect, useRef } from "react";
import {
  isStackAcresCrop,
  type SeedStock,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import type { BuyOption } from "@/lib/stackacres/district-panel";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The Long Meadow's own planting menu -- a horizontal scroll strip, not the
 * ring ./stackacres-radial-menu.tsx still uses everywhere else.
 *
 * WHY THIS EXISTS AND THE RING DOES NOT COVER IT. The ring lays every option
 * out on a fixed 100-degree arc at a fixed radius, sized for a couple of
 * buy options -- fine for three livestock kinds, broken for the Long
 * Meadow's 22 crops: the per-item spread collapses until buttons render
 * almost fully stacked on top of each other, and only whichever one paints
 * on top is tappable. A scroll strip has no such ceiling; it just gets
 * longer.
 *
 * FILTERED TO WHAT'S OWNED, and this is the actual fix, not merely the
 * layout. A crop is bought from Ray's seed shelf ahead of time
 * (buyStackAcresSeed) and only shows up here once at least one seed of it is
 * on the shelf -- `options` is the district's full buyable list, exactly
 * what buyOptionsForZone returns, and this component is what narrows it to
 * `seedStock`. A crop the player has never bought seed for is not merely
 * disabled, it never appears -- an empty strip points at the shop instead.
 *
 * PROPS MIRROR StackAcresRadialMenuProps on purpose (`at`, `options`,
 * `districtLabel`, `busy`, `onSeed`, `onClose`, `onManage`, `extraActions`),
 * so stackacres-farm.tsx's call site swaps between the two components for
 * nothing more than which zone was tapped -- see that file's own render
 * branch. `onSeed` still dispatches the identical `{ action: "stock", stock
 * }`; the seed it spends is consumed server-side, not named in the request.
 */

/** Which painter stands for a crop, matching the ring's own STOCK_ICON table
 *  restricted to crops -- the same seed is never drawn as two pictures.
 *  Livestock never reaches this component (see the header), so there is no
 *  livestock entry to keep in sync here. */
const CROP_ICON: Partial<Record<StackAcresStock, PainterName>> = {
  artichoke: "ico-artichoke",
  beet: "ico-beet",
  brokoly: "ico-brokoly",
  cabbage: "ico-cabbage",
  carrot: "ico-carrot",
  corn: "ico-corn",
  corn2: "ico-corn2",
  cucumber: "ico-cucumber",
  eggplant: "ico-eggplant",
  garlic: "ico-garlic",
  grap: "ico-grap",
  grap2: "ico-grap2",
  onion: "ico-onion",
  pepper: "ico-pepper",
  poppy: "ico-poppy",
  potato: "ico-potato",
  pumpkin: "ico-pumpkin",
  sunflowe_broken: "ico-sunflowe_broken",
  sunflower: "ico-sunflower",
  tomato: "ico-tomato",
  wheat1: "ico-wheat",
  wheat2: "ico-wheat2",
};

/** How many seeds of this stock the shelf holds. Always 0 for anything that
 *  isn't a crop -- this component is meadow-only, but the type is the
 *  broader `StackAcresStock` (the shape `BuyOption.stock` already carries),
 *  so the guard is what keeps the lookup honest rather than an unsafe cast. */
function heldSeeds(seedStock: SeedStock, stock: StackAcresStock): number {
  return isStackAcresCrop(stock) ? seedStock[stock] ?? 0 : 0;
}

export interface StackAcresSeedStripProps {
  /** Where the finger landed, in pixels inside .sa-field. Only its `x` is
   *  used -- the strip docks along the bottom of the field rather than
   *  orbiting the tap the way the ring does, since a strip long enough to
   *  scroll cannot also stay centered under an arbitrary fingertip without
   *  risking running off either edge of a landscape phone. */
  at: { x: number; y: number };
  /** The district's full buy list -- the same `buyOptionsForZone` result the
   *  ring and the sidebar both render. Narrowed to `seedStock` below. */
  options: readonly BuyOption[];
  /** Seeds bought from Ray but not planted yet. The whole filter. */
  seedStock: SeedStock;
  districtLabel: string;
  busy: boolean;
  onSeed: (stock: StackAcresStock) => void;
  onClose: () => void;
  onManage: () => void;
  /** Till/remove-bed buttons for the ground under the tap -- see
   *  stackacres-farm.tsx's `soilExtraActions`. Appended after the owned
   *  seeds, same as the ring does. */
  extraActions?: readonly {
    key: string;
    label: string;
    icon: PainterName;
    cost?: number;
    disabledReason?: string;
    onSelect: () => void;
  }[];
}

export function StackAcresSeedStrip({
  options,
  seedStock,
  districtLabel,
  busy,
  onSeed,
  onClose,
  onManage,
  extraActions = [],
}: StackAcresSeedStripProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const owned = options.filter((option) => heldSeeds(seedStock, option.stock) > 0);
  const empty = owned.length === 0 && extraActions.length === 0;

  useEffect(() => {
    // Deferred a tick for the same reason the ring's own effect is -- see
    // StackAcresRadialMenu's identical comment.
    const timer = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const place = districtLabel.replace(/^The /, "");

  return (
    <div className="sa-seed-strip" role="group" aria-label={`Plant at ${place}`}>
      <button type="button" className="sa-seed-strip-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {empty ? (
        <div className="sa-seed-strip-empty">
          <p>No seeds on hand.</p>
          <button type="button" className="sa-cta" ref={firstRef} onClick={onManage}>
            Visit Ray&apos;s shop
          </button>
        </div>
      ) : (
        <>
          <div className="sa-seed-strip-row">
            {owned.map((option, index) => {
              const disabled = busy || option.atCap;
              return (
                <button
                  key={option.stock}
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  className="sa-seed-chip"
                  disabled={disabled}
                  title={option.atCap ? `${option.owned}/${option.cap} full` : undefined}
                  onClick={() => onSeed(option.stock)}
                >
                  <StackAcresIcon name={CROP_ICON[option.stock] ?? "ico-plant"} size={24} />
                  <span className="sa-seed-chip-name">{option.label}</span>
                  <span className="sa-seed-chip-qty">×{heldSeeds(seedStock, option.stock)}</span>
                </button>
              );
            })}
            {extraActions.map((extraAction, offset) => (
              <button
                key={extraAction.key}
                ref={owned.length === 0 && offset === 0 ? firstRef : undefined}
                type="button"
                className="sa-seed-chip"
                disabled={busy || Boolean(extraAction.disabledReason)}
                title={extraAction.disabledReason}
                onClick={extraAction.onSelect}
              >
                <StackAcresIcon name={extraAction.icon} size={24} />
                <span className="sa-seed-chip-name">{extraAction.label}</span>
              </button>
            ))}
          </div>
          {/* Same wood button and class the ring's own handoff uses (see
              .sa-radial-more in 52-stackacres.css) -- it is the identical
              "there is more to this district than seeding" door, just
              docked under a strip instead of pinned under a ring. */}
          <button type="button" className="sa-radial-more sa-seed-strip-manage" onClick={onManage}>
            Manage {place}
          </button>
        </>
      )}
    </div>
  );
}
