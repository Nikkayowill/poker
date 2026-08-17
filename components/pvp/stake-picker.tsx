"use client";

import clsx from "clsx";

/**
 * The stake/wager quick-pick row: round-number buttons plus a custom field,
 * shared by the duel lobby and Ante Up's wager step -- same `.duel-tiers`
 * markup, same "pick a round number or type your own" idiom, just with
 * different floors and an optional leading "Free" option for Ante Up's
 * practice mode. Extracted once both grew it independently.
 */
export function StakePicker({
  ariaLabel,
  picks,
  value,
  min,
  onChange,
  leading,
}: {
  ariaLabel: string;
  picks: readonly number[];
  value: number;
  min: number;
  onChange: (next: number) => void;
  /** An extra button ahead of the quick picks, e.g. Ante Up's "Free" (wager 0). */
  leading?: { label: string; value: number };
}) {
  return (
    <div className="duel-tiers" role="group" aria-label={ariaLabel}>
      {leading && (
        <button
          type="button"
          className={clsx("duel-tier", leading.value === value && "duel-tier-active")}
          onClick={() => onChange(leading.value)}
          aria-pressed={leading.value === value}
        >
          {leading.label}
        </button>
      )}
      {picks.map((option) => (
        <button
          key={option}
          type="button"
          className={clsx("duel-tier", option === value && "duel-tier-active")}
          onClick={() => onChange(option)}
          aria-pressed={option === value}
        >
          {option.toLocaleString()}
        </button>
      ))}
      <label className="duel-tier-custom">
        <span>Custom</span>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          step={100}
          value={value}
          onChange={(event) => onChange(Math.max(0, Math.round(Number(event.target.value) || 0)))}
        />
      </label>
    </div>
  );
}
