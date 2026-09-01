"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { Coins, HelpCircle, Store, Wheat } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { tapSound } from "@/lib/audio/ui-sounds";
import {
  HOMESTEAD_CATALOGUE,
  HOMESTEAD_CROPS,
  HOMESTEAD_FEED,
  HOMESTEAD_FIELD_CAP,
  HOMESTEAD_LIVESTOCK,
  HOMESTEAD_PEN_CAP,
  isLivestock,
  type HomesteadStock,
} from "@/lib/homestead/catalogue";
import type { HomesteadPlotSnapshot } from "@/lib/homestead/plots";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  HOMESTEAD_STAGE_H,
  HOMESTEAD_STAGE_W,
  HOMESTEAD_TAP_HALF_H,
  HOMESTEAD_TAP_HALF_W,
  plotCenter,
} from "./iso";
import type { HomesteadSceneTile } from "./homestead-scene";

/**
 * The StackChips Homestead: a farm of staked crops and livestock.
 *
 * Split of responsibilities: this shell owns every rule-shaped thing (data,
 * requests, selection, the action panel, the supply store), the Phaser canvas
 * underneath is pure paint, and the tappable surface is a DOM overlay of real
 * buttons sharing the canvas's coordinate system through ./iso.ts -- a canvas
 * is invisible to a screen reader and unreachable by keyboard, and the poker
 * table already establishes the DOM-over-scene pattern here.
 *
 * No poll. Progress is a pure function of the timestamps the server already
 * sent, so a one-second local clock re-derives it and the only refetches are
 * mount and tab-return. The one thing that is NOT derivable is muck, which the
 * server rolls once at settlement -- so a collection response is authoritative
 * about it and the client never guesses.
 */
const HomesteadCanvas = dynamic(
  () => import("./homestead-canvas").then((mod) => mod.HomesteadCanvas),
  { ssr: false, loading: () => <div className="hs-canvas" aria-hidden="true" /> },
);

const DEFAULT_RETRY_AFTER_SECONDS = 5;

interface HomesteadResponse {
  plots: HomesteadPlotSnapshot[];
  /** Null for a cookie-less first visit: the read route never mints a session. */
  profile: PlayerProfile | null;
  feed: number;
  collected?: { stock: HomesteadStock; stake: number; payout: number; mucked: boolean };
  error?: string;
  round?: HomesteadPlotSnapshot[];
}

type Action =
  | { action: "buy-plot"; plotIndex: number }
  | { action: "stock"; plotIndex: number; stock: HomesteadStock }
  | { action: "collect"; plotIndex: number }
  | { action: "feed"; plotIndex: number }
  | { action: "clear"; plotIndex: number }
  | { action: "buy-feed"; itemId: string };

function countdownLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Re-derives readiness and hunger locally so a plot flips without a network
 * trip. Hunger is checked first and freezes progress, mirroring
 * lib/homestead/plots.ts exactly -- if these two ever disagree the server
 * wins, because it is the only one that can pay.
 */
function withLocalClock(plots: HomesteadPlotSnapshot[], nowMs: number): HomesteadPlotSnapshot[] {
  return plots.map((plot) => {
    if (plot.state !== "working" && plot.state !== "hungry" && plot.state !== "ready") return plot;
    if (!plot.readyAt || !plot.startedAt) return plot;
    const hungry = plot.hungryAt !== null && Date.parse(plot.hungryAt) <= nowMs;
    if (hungry) return { ...plot, state: "hungry" };
    const ready = Date.parse(plot.readyAt);
    const started = Date.parse(plot.startedAt);
    if (!Number.isFinite(ready) || !Number.isFinite(started)) return plot;
    if (ready <= nowMs) return { ...plot, state: "ready", progress: 1 };
    const progress = ready > started ? Math.min(1, Math.max(0, (nowMs - started) / (ready - started))) : 1;
    return { ...plot, state: "working", progress };
  });
}

export function HomesteadFarm() {
  const [plots, setPlots] = useState<HomesteadPlotSnapshot[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [feed, setFeed] = useState(0);
  const [loaded, setLoaded] = useState(false);
  /** 404 from the API means no admin session; see lib/server/staff-gate.ts. */
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [celebrate, setCelebrate] = useState<{ plotIndex: number; nonce: number } | null>(null);
  const [lastCollect, setLastCollect] = useState<{ payout: number; nonce: number } | null>(null);

  const play = useArcadeSound({ gameSounds: true });
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const applyResponse = useCallback((data: Partial<HomesteadResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.plots) setPlots(data.plots);
    if (typeof data.feed === "number") setFeed(data.feed);
  }, []);

  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/admin/homestead", { cache: "no-store" });
      if (response.status === 429) return;
      if (response.status === 404) {
        if (mounted.current) setLocked(true);
        return;
      }
      const data = (await response.json()) as Partial<HomesteadResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) applyResponse(data);
    } catch {
      // A dropped read is not worth a banner; the farm just stays as it was.
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, [applyResponse]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Tab-return is the one moment the server may know something this client
  // does not (another device stocked, a pen the phone slept through).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const anyWorking = plots.some(
    (plot) => plot.state === "working" || plot.state === "hungry" || plot.state === "ready",
  );
  useEffect(() => {
    if (!anyWorking) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyWorking]);

  const act = useCallback(
    async (body: Action) => {
      sending.current = true;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/homestead/actions", {
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
        const data = (await response.json()) as Partial<HomesteadResponse>;
        if (!mounted.current) return;
        if (!response.ok) {
          // A refusal carries the true grid; paint it, and only raise a banner
          // when there is no grid to speak for itself.
          if (data.round) setPlots(data.round);
          if (data.profile) setProfile(data.profile);
          if (!data.round) setError(data.error ?? "That did not go through.");
          return;
        }
        applyResponse(data);
        if (body.action === "collect" && data.collected) {
          play("ui");
          setCelebrate({ plotIndex: body.plotIndex, nonce: Date.now() });
          setLastCollect({ payout: data.collected.payout, nonce: Date.now() });
          if (data.collected.mucked) {
            setError("That plot came up weather-worn. Clear it before you use it again.");
          }
        }
      } catch {
        if (mounted.current) setError("Could not reach the farm. Check your connection.");
      } finally {
        sending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [applyResponse, play],
  );

  const livePlots = useMemo(() => withLocalClock(plots, nowMs), [plots, nowMs]);
  const penCount = livePlots.filter(
    (plot) => plot.stock !== null && isLivestock(plot.stock) && plot.state !== "empty",
  ).length;
  const fieldCount = livePlots.filter(
    (plot) => plot.stock !== null && !isLivestock(plot.stock) && plot.state !== "empty",
  ).length;
  const balance = profile?.unlimitedGold ? Infinity : (profile?.goldBalance ?? 0);

  const sceneTiles: HomesteadSceneTile[] = useMemo(
    () =>
      livePlots.map((plot) => ({
        plotIndex: plot.plotIndex,
        state: plot.state,
        stock: plot.stock,
        progress: plot.progress,
        selected: plot.plotIndex === selected,
      })),
    [livePlots, selected],
  );

  const selectedPlot = selected === null ? null : (livePlots.find((p) => p.plotIndex === selected) ?? null);

  const tileLabel = (plot: HomesteadPlotSnapshot): string => {
    const name = plot.stock ? HOMESTEAD_CATALOGUE[plot.stock].label : "plot";
    switch (plot.state) {
      case "locked":
        return plot.purchasable
          ? `Plot ${plot.plotIndex}, locked. Unlocks for ${plot.unlockPrice?.toLocaleString()} Gold.`
          : `Plot ${plot.plotIndex}, locked. Unlock earlier plots first.`;
      case "empty":
        return `Plot ${plot.plotIndex}, empty. Put something here.`;
      case "mucked":
        return `Plot ${plot.plotIndex}, weather-worn. Clearing it costs ${plot.muckFee?.toLocaleString()} Gold.`;
      case "hungry":
        return `Plot ${plot.plotIndex}, ${name} hungry. Feed them to start the clock again.`;
      case "working":
        return `Plot ${plot.plotIndex}, ${name} working. Ready in ${countdownLabel(Date.parse(plot.readyAt ?? "") - nowMs)}.`;
      case "ready":
        return `Plot ${plot.plotIndex}, ready. Sell for ${plot.payout?.toLocaleString()} Gold.`;
    }
  };

  const selectTile = (plotIndex: number) => {
    tapSound();
    setSelected((current) => (current === plotIndex ? null : plotIndex));
  };

  const stockCard = (stock: HomesteadStock) => {
    const def = HOMESTEAD_CATALOGUE[stock];
    const animal = isLivestock(stock);
    const capped = animal ? penCount >= HOMESTEAD_PEN_CAP : fieldCount >= HOMESTEAD_FIELD_CAP;
    const short = balance < def.stake;
    return (
      <div key={stock} className="hs-stock-card">
        <h3>{def.label}</h3>
        <p className="hs-stock-terms">
          {def.stake.toLocaleString()} Gold · {formatDuration(def.durationMs)}
        </p>
        <p className="hs-stock-yield">
          Sells for {def.payout.toLocaleString()}{" "}
          <span>(+{(def.payout - def.stake).toLocaleString()})</span>
        </p>
        <button
          type="button"
          className="hs-cta"
          disabled={busy || short || capped || selectedPlot === null}
          onClick={() => {
            if (selectedPlot) void act({ action: "stock", plotIndex: selectedPlot.plotIndex, stock });
          }}
        >
          {capped ? "At the limit" : animal ? "Stock" : "Plant"}
        </button>
        {short && <GoldShortfallHint needed={def.stake} compact />}
      </div>
    );
  };

  if (locked) {
    return (
      <main className="duel-shell ante-shell hs-shell">
        <section className="hs-panel hs-locked">
          <h2>Admin session required</h2>
          <p>
            The Homestead is finished but not open to players yet. Unlock the admin console first,
            then come back.
          </p>
          <a className="hs-cta" href="/admin">Go to the admin console</a>
        </section>
      </main>
    );
  }

  return (
    <main className="duel-shell ante-shell hs-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink />
          <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How to play
          </button>
        </div>
        <div className="hs-hud">
          <span className="hs-feed" title="Feed servings">
            <Wheat size={13} aria-hidden="true" />
            <strong>{feed}</strong>
          </span>
          <span className="gold-balance floor-wallet">
            <Coins size={13} aria-hidden="true" />
            <strong>{profile?.unlimitedGold ? "∞" : (profile?.goldBalance ?? 0).toLocaleString()}</strong>
          </span>
          <button
            type="button"
            className="hs-store-btn"
            onClick={() => { tapSound(); setShowStore(true); }}
          >
            <Store size={13} aria-hidden="true" /> Supply store
          </button>
        </div>
      </header>

      <div className="duel-scoreline ante-scoreline hs-scoreline">
        <div className="ante-lobby-heading">
          <h1>StackChips Homestead</h1>
        </div>
        <span className="hs-cap" aria-live="polite">
          {penCount}/{HOMESTEAD_PEN_CAP} pens · {fieldCount}/{HOMESTEAD_FIELD_CAP} fields
        </span>
      </div>

      <div className="hs-main">
        <div className="hs-stage" role="group" aria-label="Homestead plots">
          <HomesteadCanvas tiles={sceneTiles} celebrate={celebrate} />
          {lastCollect && (
            <p key={lastCollect.nonce} className="hs-toast" role="status">
              +{lastCollect.payout.toLocaleString()} Gold
            </p>
          )}
          {loaded &&
            livePlots.map((plot) => {
              const { x, y } = plotCenter(plot.plotIndex);
              return (
                <button
                  key={plot.plotIndex}
                  type="button"
                  className={clsx("hs-tile-btn", `is-${plot.state}`, {
                    "is-selected": plot.plotIndex === selected,
                  })}
                  style={{
                    left: `${(x / HOMESTEAD_STAGE_W) * 100}%`,
                    top: `${(y / HOMESTEAD_STAGE_H) * 100}%`,
                    width: `${((HOMESTEAD_TAP_HALF_W * 2) / HOMESTEAD_STAGE_W) * 100}%`,
                    height: `${((HOMESTEAD_TAP_HALF_H * 2) / HOMESTEAD_STAGE_H) * 100}%`,
                  }}
                  aria-label={tileLabel(plot)}
                  aria-pressed={plot.plotIndex === selected}
                  onClick={() => selectTile(plot.plotIndex)}
                />
              );
            })}
        </div>

        <div className="hs-side">
          {error && <p className="duel-error" role="alert">{error}</p>}

          <section className="hs-detail" aria-live="polite">
            {!loaded ? (
              <p className="hs-hint">Walking the fences…</p>
            ) : selectedPlot === null ? (
              <p className="hs-hint">
                Tap a plot. Plant crops or stock a pen, come back when they&apos;re ready, and sell
                what they made.
              </p>
            ) : selectedPlot.state === "locked" ? (
              <div className="hs-panel">
                <h2>Buy acreage</h2>
                {selectedPlot.purchasable && selectedPlot.unlockPrice !== null ? (
                  <>
                    <p>Expand the farm. Land is permanent.</p>
                    <button
                      type="button"
                      className="hs-cta"
                      disabled={busy || balance < selectedPlot.unlockPrice}
                      onClick={() => void act({ action: "buy-plot", plotIndex: selectedPlot.plotIndex })}
                    >
                      Buy for {selectedPlot.unlockPrice.toLocaleString()} Gold
                    </button>
                    {balance < selectedPlot.unlockPrice && (
                      <GoldShortfallHint needed={selectedPlot.unlockPrice} compact />
                    )}
                  </>
                ) : (
                  <p>Acreage sells in order. Buy the cheaper plots first.</p>
                )}
              </div>
            ) : selectedPlot.state === "mucked" ? (
              <div className="hs-panel">
                <h2>Weather-worn</h2>
                <p>
                  This plot took a beating on its last run. Nothing goes in it until the brush is
                  cleared and the fencing is back up.
                </p>
                <button
                  type="button"
                  className="hs-cta"
                  disabled={busy || balance < (selectedPlot.muckFee ?? 0)}
                  onClick={() => void act({ action: "clear", plotIndex: selectedPlot.plotIndex })}
                >
                  Clear for {selectedPlot.muckFee?.toLocaleString()} Gold
                </button>
                {balance < (selectedPlot.muckFee ?? 0) && (
                  <GoldShortfallHint needed={selectedPlot.muckFee ?? 0} compact />
                )}
              </div>
            ) : selectedPlot.state === "empty" ? (
              <div className="hs-panel">
                <h2>Work this plot</h2>
                <p className="hs-group-label">Fields</p>
                <div className="hs-stock-cards">{HOMESTEAD_CROPS.map(stockCard)}</div>
                <p className="hs-group-label">Pens</p>
                <div className="hs-stock-cards">{HOMESTEAD_LIVESTOCK.map(stockCard)}</div>
              </div>
            ) : selectedPlot.state === "hungry" ? (
              <div className="hs-panel">
                <h2>{HOMESTEAD_CATALOGUE[selectedPlot.stock!].label} is hungry</h2>
                <p>
                  They stop working until they&apos;re fed. Nothing is lost — the clock just waits
                  for you, and picks up where it left off.
                </p>
                <button
                  type="button"
                  className="hs-cta"
                  disabled={busy || feed < 1}
                  onClick={() => void act({ action: "feed", plotIndex: selectedPlot.plotIndex })}
                >
                  {feed < 1 ? "No feed left" : "Feed them (1 serving)"}
                </button>
                {feed < 1 && (
                  <button
                    type="button"
                    className="hs-link-btn"
                    onClick={() => { tapSound(); setShowStore(true); }}
                  >
                    Buy feed at the supply store
                  </button>
                )}
              </div>
            ) : selectedPlot.state === "working" ? (
              <div className="hs-panel">
                <h2>{HOMESTEAD_CATALOGUE[selectedPlot.stock!].label} working</h2>
                <p className="hs-countdown">
                  Ready in {countdownLabel(Date.parse(selectedPlot.readyAt ?? "") - nowMs)}
                </p>
                <p>
                  Sells for {selectedPlot.payout?.toLocaleString()} Gold. Keeps going while
                  you&apos;re away.
                </p>
                {selectedPlot.hungryAt && (
                  <p className="hs-note">
                    Wants feeding in {countdownLabel(Date.parse(selectedPlot.hungryAt) - nowMs)}.
                  </p>
                )}
              </div>
            ) : (
              <div className="hs-panel">
                <h2>Ready to sell</h2>
                <button
                  type="button"
                  className="hs-cta hs-sell-btn"
                  disabled={busy}
                  onClick={() => void act({ action: "collect", plotIndex: selectedPlot.plotIndex })}
                >
                  Sell for {selectedPlot.payout?.toLocaleString()} Gold
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      {showStore && (
        <div className="hs-sheet-scrim" role="dialog" aria-modal="true" aria-label="Supply store">
          <div className="hs-sheet">
            <header className="hs-sheet-head">
              <h2>Supply store</h2>
              <button type="button" className="hs-sheet-close" onClick={() => setShowStore(false)}>
                Done
              </button>
            </header>
            <p className="hs-sheet-note">
              Animals eat. A hungry pen stops working until you feed it, so keep a shipment in the
              barn before you leave a Cattle Pen overnight.
            </p>
            <div className="hs-stock-cards">
              {Object.entries(HOMESTEAD_FEED).map(([id, item]) => (
                <div key={id} className="hs-stock-card">
                  <h3>{item.label}</h3>
                  <p className="hs-stock-terms">{item.servings} servings</p>
                  <p className="hs-stock-yield">
                    {item.cost.toLocaleString()} Gold{" "}
                    <span>({Math.round(item.cost / item.servings)} each)</span>
                  </p>
                  <button
                    type="button"
                    className="hs-cta"
                    disabled={busy || balance < item.cost}
                    onClick={() => void act({ action: "buy-feed", itemId: id })}
                  >
                    Buy
                  </button>
                  {balance < item.cost && <GoldShortfallHint needed={item.cost} compact />}
                </div>
              ))}
            </div>
            <p className="hs-sheet-note">
              You have <strong>{feed}</strong> {feed === 1 ? "serving" : "servings"} in the barn.
            </p>
          </div>
        </div>
      )}

      {showHelp && (
        <HowToPlayModal title="StackChips Homestead" onClose={() => setShowHelp(false)}>
          <p>
            Plant crops or stock a pen on an empty plot. They work on their own — even while the app
            is closed — and once a plot turns gold, selling pays your stake back plus a bonus.
          </p>
          <ul>
            <li>Crops look after themselves. Animals need feeding, and stop working when hungry.</li>
            <li>Nothing here can die and nothing can be lost. Neglect costs you time, not Gold.</li>
            <li>
              {HOMESTEAD_PEN_CAP} pens and {HOMESTEAD_FIELD_CAP} fields can run at once.
            </li>
            <li>
              A finished plot sometimes comes up weather-worn and needs clearing before it can be
              used again.
            </li>
            <li>Acreage unlocks in order, for Gold. More land means more room, not more income.</li>
          </ul>
        </HowToPlayModal>
      )}
    </main>
  );
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr${hours === 1 ? "" : "s"}`;
}
