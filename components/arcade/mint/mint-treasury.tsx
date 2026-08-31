"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { Coins, HelpCircle } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { tapSound } from "@/lib/audio/ui-sounds";
import {
  MINT_CONCURRENT_NODE_CAP,
  MINT_NODES,
  MINT_NODE_TYPES,
  type MintNodeType,
} from "@/lib/mint/nodes";
import type { MintPlotSnapshot } from "@/lib/mint/plots";
import type { PlayerProfile } from "@/lib/profile/types";
import { MINT_STAGE_H, MINT_STAGE_W, MINT_TAP_HALF_H, MINT_TAP_HALF_W, mintTileCenter } from "./iso";
import type { MintSceneTile } from "./mint-scene";

/**
 * The Sovereign Mint: a diorama of staked, timed Gold nodes.
 *
 * Split of responsibilities: this shell owns every rule-shaped thing (data,
 * requests, selection, the action panel), the Phaser canvas underneath is
 * pure paint, and the tappable surface is a DOM overlay of real buttons
 * sharing the canvas's coordinate system through ./iso.ts -- a canvas is
 * invisible to a screen reader and unreachable by keyboard, and the poker
 * table already establishes the DOM-over-scene pattern here.
 *
 * No poll. Growth is a pure function of the timestamps the server already
 * sent, so a one-second local clock re-derives it and the only refetches are
 * mount and tab-return -- the same reasoning the GDD's "no background server
 * calculation" pillar states, applied client-side.
 */
const MintCanvas = dynamic(() => import("./mint-canvas").then((mod) => mod.MintCanvas), {
  ssr: false,
  loading: () => <div className="mint-canvas" aria-hidden="true" />,
});

const DEFAULT_RETRY_AFTER_SECONDS = 5;

interface MintResponse {
  plots: MintPlotSnapshot[];
  /** Null for a cookie-less first visit: the read route never mints a session. */
  profile: PlayerProfile | null;
  harvested?: { nodeType: MintNodeType; stake: number; payout: number };
  error?: string;
  round?: MintPlotSnapshot[];
}

const NODE_COPY: Record<MintNodeType, { label: string; duration: string; tagline: string }> = {
  pulse: { label: "Pulse", duration: "15 min", tagline: "Quick turnaround" },
  core: { label: "Core", duration: "4 hrs", tagline: "Check back later" },
  matrix: { label: "Matrix", duration: "24 hrs", tagline: "Overnight hold" },
};

function countdownLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Re-derives ripeness locally so a node flips gold without a network trip. */
function withLocalClock(plots: MintPlotSnapshot[], nowMs: number): MintPlotSnapshot[] {
  return plots.map((plot) => {
    if ((plot.state !== "growing" && plot.state !== "ripe") || !plot.maturesAt || !plot.plantedAt) return plot;
    const matures = Date.parse(plot.maturesAt);
    const planted = Date.parse(plot.plantedAt);
    if (!Number.isFinite(matures) || !Number.isFinite(planted)) return plot;
    if (matures <= nowMs) return { ...plot, state: "ripe", growthPercent: 1 };
    const pct = matures > planted ? Math.min(1, Math.max(0, (nowMs - planted) / (matures - planted))) : 1;
    return { ...plot, state: "growing", growthPercent: pct };
  });
}

export function MintTreasury() {
  const [plots, setPlots] = useState<MintPlotSnapshot[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);
  const [celebrate, setCelebrate] = useState<{ plotIndex: number; nonce: number } | null>(null);
  const [lastHarvest, setLastHarvest] = useState<{ payout: number; nonce: number } | null>(null);

  const play = useArcadeSound({ gameSounds: true });
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const applyResponse = useCallback((data: Partial<MintResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.plots) setPlots(data.plots);
  }, []);

  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/mint", { cache: "no-store" });
      if (response.status === 429) return;
      const data = (await response.json()) as Partial<MintResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped read is not worth a banner; the grid just stays as it was.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

  // Initial read, deferred a tick: the idiom every arcade table shares.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Tab-return is the one moment the server may know something this client
  // does not (another device planted, a node the phone slept through).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const anyGrowing = plots.some((plot) => plot.state === "growing" || plot.state === "ripe");
  useEffect(() => {
    if (!anyGrowing) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyGrowing]);

  const act = useCallback(
    async (body: { action: "buy-plot" | "plant" | "harvest"; plotIndex: number; nodeType?: MintNodeType }) => {
      sending.current = true;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/mint/actions", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.status === 429) {
          const header = Number(response.headers.get("Retry-After"));
          const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SECONDS;
          if (mounted.current) setError(`Too many taps. Give it ${seconds}s.`);
          return;
        }
        const data = (await response.json()) as Partial<MintResponse>;
        if (!mounted.current) return;
        if (!response.ok) {
          // A refusal carries the true grid; paint it, and only raise a
          // banner when there is no grid to speak for itself.
          if (data.round) setPlots(data.round);
          if (data.profile) setProfile(data.profile);
          if (!data.round) setError(data.error ?? "That did not go through.");
          return;
        }
        applyResponse(data);
        if (body.action === "harvest" && data.harvested) {
          play("ui");
          setCelebrate({ plotIndex: body.plotIndex, nonce: Date.now() });
          setLastHarvest({ payout: data.harvested.payout, nonce: Date.now() });
        }
      } catch {
        if (mounted.current) setError("Could not reach the treasury. Check your connection.");
      } finally {
        sending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [applyResponse, play],
  );

  const livePlots = useMemo(() => withLocalClock(plots, nowMs), [plots, nowMs]);
  const growingCount = livePlots.filter((plot) => plot.state === "growing" || plot.state === "ripe").length;
  const balance = profile?.unlimitedGold ? Infinity : (profile?.goldBalance ?? 0);

  const sceneTiles: MintSceneTile[] = useMemo(
    () =>
      livePlots.map((plot) => ({
        plotIndex: plot.plotIndex,
        state: plot.state,
        nodeType: plot.nodeType,
        growthPercent: plot.growthPercent,
        selected: plot.plotIndex === selected,
      })),
    [livePlots, selected],
  );

  const selectedPlot = selected === null ? null : (livePlots.find((plot) => plot.plotIndex === selected) ?? null);

  const tileLabel = (plot: MintPlotSnapshot): string => {
    switch (plot.state) {
      case "locked":
        return plot.purchasable
          ? `Plot ${plot.plotIndex}, locked. Unlocks for ${plot.unlockPrice?.toLocaleString()} Gold.`
          : `Plot ${plot.plotIndex}, locked. Unlock earlier plots first.`;
      case "empty":
        return `Plot ${plot.plotIndex}, empty. Plant a node here.`;
      case "growing":
        return `Plot ${plot.plotIndex}, ${NODE_COPY[plot.nodeType as MintNodeType]?.label ?? "node"} growing. Ready in ${countdownLabel(Date.parse(plot.maturesAt ?? "") - nowMs)}.`;
      case "ripe":
        return `Plot ${plot.plotIndex}, ready. Harvest ${plot.payout?.toLocaleString()} Gold.`;
    }
  };

  const selectTile = (plotIndex: number) => {
    tapSound();
    setSelected((current) => (current === plotIndex ? null : plotIndex));
  };

  return (
    <main className="duel-shell ante-shell mint-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink />
          <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How to play
          </button>
        </div>
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>{profile?.unlimitedGold ? "∞" : (profile?.goldBalance ?? 0).toLocaleString()}</strong>
        </span>
      </header>

      <div className="duel-scoreline ante-scoreline mint-scoreline">
        <div className="ante-lobby-heading">
          <h1>Sovereign Mint</h1>
        </div>
        <span className="mint-cap" aria-live="polite">
          {growingCount}/{MINT_CONCURRENT_NODE_CAP} nodes growing
        </span>
      </div>

      <div className="mint-main">
        <div className="mint-stage" role="group" aria-label="Treasury plots">
          <MintCanvas tiles={sceneTiles} celebrate={celebrate} />
          {lastHarvest && (
            <p key={lastHarvest.nonce} className="mint-harvest-toast" role="status">
              +{lastHarvest.payout.toLocaleString()} Gold
            </p>
          )}
          {loaded &&
            livePlots.map((plot) => {
              const { x, y } = mintTileCenter(plot.plotIndex);
              return (
                <button
                  key={plot.plotIndex}
                  type="button"
                  className={clsx("mint-tile-btn", `is-${plot.state}`, {
                    "is-selected": plot.plotIndex === selected,
                  })}
                  style={{
                    left: `${(x / MINT_STAGE_W) * 100}%`,
                    top: `${(y / MINT_STAGE_H) * 100}%`,
                    width: `${((MINT_TAP_HALF_W * 2) / MINT_STAGE_W) * 100}%`,
                    height: `${((MINT_TAP_HALF_H * 2) / MINT_STAGE_H) * 100}%`,
                  }}
                  aria-label={tileLabel(plot)}
                  aria-pressed={plot.plotIndex === selected}
                  onClick={() => selectTile(plot.plotIndex)}
                />
              );
            })}
        </div>

        <div className="mint-side">
          {error && <p className="duel-error" role="alert">{error}</p>}

          <section className="mint-detail" aria-live="polite">
            {!loaded ? (
              <p className="mint-hint">Surveying the grounds…</p>
            ) : selectedPlot === null ? (
              <p className="mint-hint">Tap a tile. Stake Gold into a node, come back when it&apos;s grown, harvest more back.</p>
            ) : selectedPlot.state === "locked" ? (
              <div className="mint-panel">
                <h2>Locked plot</h2>
                {selectedPlot.purchasable && selectedPlot.unlockPrice !== null ? (
                  <>
                    <p>Expand the treasury. Plots are permanent.</p>
                    <button
                      type="button"
                      className="mint-cta"
                      disabled={busy || balance < selectedPlot.unlockPrice}
                      onClick={() => void act({ action: "buy-plot", plotIndex: selectedPlot.plotIndex })}
                    >
                      Unlock for {selectedPlot.unlockPrice.toLocaleString()} Gold
                    </button>
                    {balance < selectedPlot.unlockPrice && <GoldShortfallHint needed={selectedPlot.unlockPrice} compact />}
                  </>
                ) : (
                  <p>Plots unlock in order. Buy the cheaper ones first.</p>
                )}
              </div>
            ) : selectedPlot.state === "empty" ? (
              <div className="mint-panel">
                <h2>Plant a node</h2>
                {growingCount >= MINT_CONCURRENT_NODE_CAP ? (
                  <p>Your crews can only tend {MINT_CONCURRENT_NODE_CAP} nodes at once. Harvest one first.</p>
                ) : (
                  <div className="mint-node-cards">
                    {MINT_NODE_TYPES.map((nodeType) => {
                      const node = MINT_NODES[nodeType];
                      const copy = NODE_COPY[nodeType];
                      const short = balance < node.stake;
                      return (
                        <div key={nodeType} className="mint-node-card">
                          <h3>{copy.label}</h3>
                          <p className="mint-node-terms">
                            {node.stake.toLocaleString()} Gold · {copy.duration}
                          </p>
                          <p className="mint-node-yield">
                            Harvests {node.payout.toLocaleString()} <span>(+{(node.payout - node.stake).toLocaleString()})</span>
                          </p>
                          <button
                            type="button"
                            className="mint-cta"
                            disabled={busy || short}
                            onClick={() => void act({ action: "plant", plotIndex: selectedPlot.plotIndex, nodeType })}
                          >
                            Plant
                          </button>
                          {short && <GoldShortfallHint needed={node.stake} compact />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : selectedPlot.state === "growing" ? (
              <div className="mint-panel">
                <h2>{NODE_COPY[selectedPlot.nodeType as MintNodeType]?.label ?? "Node"} growing</h2>
                <p className="mint-countdown">
                  Ready in {countdownLabel(Date.parse(selectedPlot.maturesAt ?? "") - nowMs)}
                </p>
                <p>Harvests {selectedPlot.payout?.toLocaleString()} Gold. It keeps growing while you&apos;re away.</p>
              </div>
            ) : (
              <div className="mint-panel">
                <h2>Ready to harvest</h2>
                <button
                  type="button"
                  className="mint-cta mint-harvest-btn"
                  disabled={busy}
                  onClick={() => void act({ action: "harvest", plotIndex: selectedPlot.plotIndex })}
                >
                  Harvest {selectedPlot.payout?.toLocaleString()} Gold
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      {showHelp && (
        <HowToPlayModal title="Sovereign Mint" onClose={() => setShowHelp(false)}>
          <p>
            Stake Gold into a node on an empty plot. It matures on its own — even while the app is
            closed — and once it turns gold, harvesting pays your stake back plus a bonus.
          </p>
          <ul>
            <li>Pulse: {MINT_NODES.pulse.stake.toLocaleString()} Gold for 15 minutes, harvests {MINT_NODES.pulse.payout.toLocaleString()}.</li>
            <li>Core: {MINT_NODES.core.stake.toLocaleString()} Gold for 4 hours, harvests {MINT_NODES.core.payout.toLocaleString()}.</li>
            <li>Matrix: {MINT_NODES.matrix.stake.toLocaleString()} Gold for 24 hours, harvests {MINT_NODES.matrix.payout.toLocaleString()}.</li>
            <li>At most {MINT_CONCURRENT_NODE_CAP} nodes grow at once.</li>
            <li>Locked plots unlock in order, for Gold. More plots means more layout, not more income.</li>
          </ul>
        </HowToPlayModal>
      )}
    </main>
  );
}
