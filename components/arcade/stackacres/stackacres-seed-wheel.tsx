"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { StackAcresCrop } from "@/lib/stackacres/catalogue";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The seed wheel: which crop the seed pouch sows.
 *
 * Tapping the pouch on the belt opens this beside it, and tapping a token picks
 * that crop. It is the gel dock's row (`.sa-gel-token`,
 * `.sa-gel-scroll` in 52-stackacres.css, kept) without the drag: the dock used
 * to make the player haul a token into a circle pinned on the tapped tile, and
 * that gesture is gone along with the tap-then-drag flow it belonged to. A tap
 * is the whole commitment now.
 *
 * Because nothing has to be dragged out of the row any more, the row also hands
 * the touch straight back to the browser for native horizontal scrolling
 * (`.sa-seed-wheel` sets `touch-action: pan-x` over the token's own `none`),
 * which is what the old dock had to fight with `rowGesture` to fake.
 *
 * An empty wheel used to offer a button through to Ray's shop. Seeds come off
 * the farmyard's berry bushes now (lib/stackacres/forage.ts), which is both
 * free and the first thing a new farm can do, so the empty row just says where
 * to look and does not send anyone shopping.
 */

export interface SeedWheelItem {
  stock: StackAcresCrop;
  label: string;
  icon: PainterName;
  /** Seeds of this crop on hand. A zero-count crop is shown greyed rather than hidden,
   *  so the player can see what they have run out of. */
  qty: number;
}

export interface StackAcresSeedWheelProps {
  items: readonly SeedWheelItem[];
  /** The crop currently on the wheel, drawn as held. */
  picked: StackAcresCrop | null;
  onPick: (stock: StackAcresCrop) => void;
  onClose: () => void;
}

export function StackAcresSeedWheel({ items, picked, onPick, onClose }: StackAcresSeedWheelProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const empty = items.length === 0;

  // Opens with the row focused, and Escape closes it, the same as every other
  // sheet on this screen.
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sa-seed-wheel" role="group" aria-label="Seeds">
      <button
        type="button"
        className="sa-gel-close"
        aria-label="Close"
        ref={empty ? firstRef : undefined}
        onClick={onClose}
      >
        ×
      </button>
      {empty ? (
        <div className="sa-gel-empty">
          <p>No seeds on hand. Pick the berry bushes around the farmyard.</p>
        </div>
      ) : (
        <div className={clsx("sa-gel-scroll", { "is-scrollable": items.length > 3 })}>
          {items.map((item, index) => (
            <button
              key={item.stock}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              role="radio"
              aria-checked={picked === item.stock}
              className={clsx("sa-gel-token", { "is-held": picked === item.stock, "is-spent": item.qty < 1 })}
              onClick={() => onPick(item.stock)}
            >
              <StackAcresIcon name={item.icon} size={24} />
              <span className="sa-gel-name">{item.label}</span>
              <span className="sa-gel-qty">×{item.qty}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
