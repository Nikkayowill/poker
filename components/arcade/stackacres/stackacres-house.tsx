"use client";

import { useEffect, useState } from "react";
import { Archive, Clock, CookingPot, House, Utensils, X, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { ENERGY_MAX } from "@/lib/stackacres/energy";
import { StackAcresKitchen, type KitchenTab, type StackAcresKitchenProps } from "./stackacres-kitchen";

/**
 * The player's own house, opened by tapping it on the Homestead. It is the
 * kitchen: cook, eat, age jars and set the Farm Kitchen's order. Ray lives
 * elsewhere and has his own tap (story and gifts), so nothing of his is here.
 *
 * Same centered, tabbed popup as the barn's store (`.sa-store-*`), since both
 * are played on a phone on its side: one section on screen at a time, laid
 * out across the width instead of down a long scroll.
 */

const HOUSE_TABS: { id: KitchenTab; label: string; icon: LucideIcon }[] = [
  { id: "cook", label: "Cook", icon: CookingPot },
  { id: "eat", label: "Eat", icon: Utensils },
  { id: "cellar", label: "Cellar", icon: Archive },
  { id: "farm_kitchen", label: "Farm Kitchen", icon: Clock },
];

export interface StackAcresHouseProps extends Omit<StackAcresKitchenProps, "tab"> {
  /** A refusal from a button in here; the page's own banner sits behind the scrim. */
  error: string | null;
  onClose: () => void;
}

export function StackAcresHouse({ error, onClose, ...kitchen }: StackAcresHouseProps) {
  const [tab, setTab] = useState<KitchenTab>("cook");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="sa-store-scrim sa-house-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Your house"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sa-store-card sa-house-card">
        <header className="sa-store-head">
          <House size={20} aria-hidden="true" className="sa-house-mark" />
          <h2>Your House</h2>
          <span className="sa-house-energy" title="Energy. Fishing uses it. Eat to fill it up.">
            Energy <strong>{kitchen.energy}</strong>/{ENERGY_MAX}
          </span>
          <button type="button" className="sa-store-close" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {error && <p className="duel-error" role="alert">{error}</p>}

        <div className="sa-store-tabs" role="tablist" aria-label="House room">
          {HOUSE_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={clsx("sa-store-tab", tab === id && "sa-store-tab-active")}
              onClick={() => setTab(id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="sa-store-panel" role="tabpanel">
          <StackAcresKitchen tab={tab} {...kitchen} />
        </div>
      </div>
    </div>
  );
}
