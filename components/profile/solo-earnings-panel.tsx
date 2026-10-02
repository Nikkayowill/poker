import { Gauge } from "lucide-react";
import type { RankProgress } from "@/lib/progression/rank";
import type { SoloEarningsSummary } from "@/lib/progression/solo-earnings";
import { RankJewel } from "./rank-jewel";

/**
 * The solo rank readout: rank points, tier jewel, the running net Gold, and a
 * difficulty gauge showing which stake bands that Gold came from. No win-loss
 * record on purpose; those stay in private friend matches.
 *
 * Sits directly under the rank strip because it is the reason for the rank:
 * rank counts the wins among exactly these wagers, and a win on a harder band
 * counts for more. Losses and stake size do not move it. Numbers
 * come from the same ProgressionSnapshot as the strip, so the two cannot
 * disagree.
 */

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function signed(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${compact.format(Math.abs(value))}`;
}

export function SoloEarningsPanel({
  summary,
  rank,
}: {
  summary: SoloEarningsSummary;
  rank: RankProgress;
}) {
  const { difficulty } = summary;
  const played = summary.totalStaked > 0;
  const needle = difficulty.needle === null ? null : Math.round(difficulty.needle * 100);

  return (
    <section className="earnings-strip" aria-label="Solo earnings">
      <div className="earnings-stats">
        <div className="earnings-stat">
          <small>Rank points</small>
          <strong>{compact.format(rank.points)}</strong>
          <span>from solo wagers</span>
        </div>
        <div className="earnings-stat">
          <small>Tier</small>
          <strong className="earnings-tier">
            <RankJewel tier={rank.tier.id} size={20} shine={false} />
            {rank.tier.name}
          </strong>
          <span>{rank.nextTier ? `${compact.format(rank.toNext ?? 0)} to ${rank.nextTier.name}` : "Top tier"}</span>
        </div>
        <div className="earnings-stat">
          <small>Net Gold</small>
          <strong className={summary.net < 0 ? "earnings-down" : summary.net > 0 ? "earnings-up" : undefined}>
            {signed(summary.net)}
          </strong>
          <span>{compact.format(summary.totalStaked)} staked</span>
        </div>
      </div>

      <div className="earnings-gauge">
        <div className="earnings-gauge-head">
          <small>
            <Gauge size={11} aria-hidden="true" /> Difficulty
          </small>
          <strong>{difficulty.label ?? (played ? "Nothing won yet" : "Not played yet")}</strong>
        </div>

        {/* The bars carry the share of earned Gold per band; the needle marks
            the average. Both are spelled out in the label below for a screen
            reader, so the graphic itself is hidden from it. */}
        <div className="earnings-bands" aria-hidden="true">
          {summary.bands.map((band) => (
            <div key={band.band} className="earnings-band" title={`${band.label}: ${Math.round(band.share * 100)}% of earned Gold`}>
              <div className="earnings-band-bar">
                <div className="earnings-band-fill" style={{ height: `${Math.max(band.share > 0 ? 8 : 0, Math.round(band.share * 100))}%` }} />
              </div>
              <span>{band.label}</span>
            </div>
          ))}
          {needle !== null && <div className="earnings-needle" style={{ left: `${needle}%` }} />}
        </div>
        <p className="sr-only">
          {summary.bands
            .filter((band) => band.share > 0)
            .map((band) => `${band.label} ${Math.round(band.share * 100)}%`)
            .join(", ") || "No earnings yet"}
        </p>
      </div>
    </section>
  );
}
