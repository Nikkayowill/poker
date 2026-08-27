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
  max,
  onChange,
  leading,
}: {
  ariaLabel: string;
  picks: readonly number[];
  value: number;
  min: number;
  /**
   * The ceiling, if this surface has one. Quick picks above it are not
   * offered and the custom field clamps to it, so the picker can never hand
   * back an amount the server is about to refuse. Ante Up passes the board's
   * own ceiling here (lib/arcade/ante-up-stakes.ts); the duel lobby has none.
   */
  max?: number;
  onChange: (next: number) => void;
  /** An extra button ahead of the quick picks, e.g. Ante Up's "Free" (wager 0). */
  leading?: { label: string; value: number };
}) {
  const ceiling = max ?? Number.POSITIVE_INFINITY;
  const offered = picks.filter((option) => option <= ceiling);

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
      {offered.map((option) => (
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
          max={max}
          step={100}
          value={value}
          onChange={(event) =>
            onChange(Math.min(ceiling, Math.max(0, Math.round(Number(event.target.value) || 0))))
          }
        />
      </label>
    </div>
  );
}
