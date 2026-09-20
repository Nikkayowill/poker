"use client";

import clsx from "clsx";
import type { BuildCost } from "@/lib/stackacres/build-cost";

/** What a machine costs, one line per part, with what the player holds.
 *  Same shape as the Workshop's recipe lines: the have-count is what tells a
 *  player why the button below is grey. */
export function BuildCostLines({ cost }: { cost: BuildCost }) {
  return (
    <p className="sa-build-cost">
      <span className="sa-build-where">Built in the {cost.place}</span>
      {cost.lines.map((line) => (
        <span key={line.label} className={clsx("sa-build-cost-item", { "is-short": !line.met })}>
          {line.need.toLocaleString()} {line.label}
          {Number.isFinite(line.have) && <em> (have {line.have.toLocaleString()})</em>}
        </span>
      ))}
    </p>
  );
}
