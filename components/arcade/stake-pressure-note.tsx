"use client";

import { Flame } from "lucide-react";
import {
  STAKE_PRESSURE_LABELS,
  stakePressure,
  stakePressureThreshold,
  type StakePressure,
} from "@/lib/arcade/stake-pressure";

/**
 * The lobby line that tells a player what their stake changes. Each game
 * passes the rules its own bands add; nothing shows under 10k.
 */
export function StakePressureNote({
  wager,
  rules,
}: {
  wager: number;
  rules: Partial<Record<Exclude<StakePressure, 0>, readonly string[]>>;
}) {
  const pressure = stakePressure(wager);
  if (pressure === 0) return null;
  const lines = rules[pressure] ?? [];
  if (lines.length === 0) return null;
  return (
    <div className="stake-pressure-note" role="note">
      <strong>
        <Flame size={13} aria-hidden="true" /> {STAKE_PRESSURE_LABELS[pressure]} · {stakePressureThreshold(pressure)}
      </strong>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
