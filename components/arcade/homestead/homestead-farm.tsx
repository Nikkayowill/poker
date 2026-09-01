"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Coins, HelpCircle, Store, Wheat } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { GoldShortfallHint } from "@/components/shared/gold-shortfall-hint";
import { tapSound } from "@/lib/audio/ui-sounds";
import {
  HOMESTEAD_CATALOGUE,
  HOMESTEAD_FEED,
  HOMESTEAD_FIELD_CAP,
  HOMESTEAD_PEN_CAP,
  HOMESTEAD_STOCK,
  capFor,
  isLivestock,
  type HomesteadStock,
} from "@/lib/homestead/catalogue";
import {
  exchangeState,
  goldForBushels,
  type HomesteadExchangeState,
} from "@/lib/homestead/exchange";
import {
  HOMESTEAD_ITEMS,
  HOMESTEAD_ITEM_CATALOGUE,
  HOMESTEAD_YIELDS,
  itemLabel,
  type HomesteadItem,
} from "@/lib/homestead/items";
import type { HomesteadPlotSnapshot } from "@/lib/homestead/plots";
import type { PlayerProfile } from "@/lib/profile/types";
import {
  HOMESTEAD_TOOL_DEFS,
  affordanceFor,
  occupiedCount,
  suggestedTool,
  type AffordanceContext,
  type HomesteadTool,
} from "@/lib/homestead/tools";
import { HomesteadGrid, HomesteadSeedStrip } from "./homestead-grid";
import { HomesteadToolbelt } from "./homestead-toolbelt";

/**
 * The StackChips Homestead: a farm of staked crops and livestock.
 *
 * Split of responsibilities: this shell owns data, requests and the held
 * tool; ./homestead-grid.tsx draws plots; ./homestead-toolbelt.tsx is the
 * dock; and every rule about what a tap can do lives in lib/homestead/tools.ts
 * so it is testable.
 *
 * The interaction is tool-first, the way a farming game works rather than the
 * way a form does: hold a tool, and every plot it can act on lights up. Tapping
 * acts immediately. Look is the resting tool and the only one that opens the
 * detail panel -- that panel is now for reading, not for finding the button.
 *
 * No poll. Progress is a pure function of the timestamps the server already
 * sent, so a one-second local clock re-derives it and the only refetches are
 * mount and tab-return. The one thing that is NOT derivable is muck, which the
 * server rolls once at settlement -- so a collection response is authoritative
 * about it and the client never guesses.
 */

/* See homestead-grid.tsx: the HUD purse and the barn list draw the same 16x16
   pixel-art PNGs, and next/image's resampling is what destroys pixel art. */
/* eslint-disable @next/next/no-img-element */

const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** The board is 4x4. One number, because the grid is a real CSS grid now. */
const GRID_COLUMNS = 4;

interface HomesteadResponse {
  plots: HomesteadPlotSnapshot[];
  /** Null for a cookie-less first visit: the read route never mints a session. */
  profile: PlayerProfile | null;
  feed: number;
  inventory: Record<string, number>;
  bushels: number;
  exchange: HomesteadExchangeState;
  collected?: { stock: HomesteadStock; item: HomesteadItem; quantity: number; mucked: boolean };
  sold?: { item: HomesteadItem; quantity: number; bushels: number };
  exchanged?: { bushels: number; gold: number };
  error?: string;
  round?: HomesteadPlotSnapshot[];
}

type Action =
  | { action: "buy-plot"; plotIndex: number }
  | { action: "stock"; plotIndex: number; stock: HomesteadStock }
  | { action: "collect"; plotIndex: number }
  | { action: "feed"; plotIndex: number }
  | { action: "clear"; plotIndex: number }
  | { action: "buy-feed"; itemId: string }
  | { action: "sell"; item: HomesteadItem; quantity: number }
  | { action: "exchange"; bushels: number };

function countdownLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr${hours === 1 ? "" : "s"}`;
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
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [bushels, setBushels] = useState(0);
  // Seeded from the same pure helper the server uses, so the window's terms are
  // right on the first paint rather than blank until the read lands.
  const [exchange, setExchange] = useState<HomesteadExchangeState>(() =>
    exchangeState(0, new Date()),
  );
  const [exchangeChoice, setExchangeChoice] = useState<number | null>(null);
  const [exchangeNote, setExchangeNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<HomesteadTool>("inspect");
  const [seed, setSeed] = useState<HomesteadStock | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [celebrate, setCelebrate] = useState<{ plotIndex: number; nonce: number } | null>(null);
  const [lastCollect, setLastCollect] = useState<{ text: string; nonce: number } | null>(null);

  const play = useArcadeSound({ gameSounds: true });
  const sending = useRef(false);
  const mounted = useRef(true);
  const suggested = useRef(false);
  useEffect(() => () => { mounted.current = false; }, []);

  const applyResponse = useCallback((data: Partial<HomesteadResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.plots) setPlots(data.plots);
    if (typeof data.feed === "number") setFeed(data.feed);
    if (data.inventory) setInventory(data.inventory);
    if (typeof data.bushels === "number") setBushels(data.bushels);
    if (data.exchange) setExchange(data.exchange);
  }, []);

  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/homestead", { cache: "no-store" });
      if (response.status === 429) return;
      // The pass was rotated or expired under us. Reload so the server
      // component answers with the gate rather than leaving a farm on screen
      // whose every button will now fail.
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = (await response.json()) as Partial<HomesteadResponse>;
      if (!mounted.current || sending.current) return;
      if (response.ok) {
        applyResponse(data);
        // Hand the arriving player the tool their farm actually wants, once.
        // Done here rather than in an effect watching the plots: this is the
        // one moment it is a response to something, and re-deciding on every
        // render would fight the player for the dock all session.
        if (!suggested.current && data.plots) {
          suggested.current = true;
          const next = suggestedTool(data.plots);
          if (next) setTool(next);
        }
      }
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

  const livePlots = useMemo(() => withLocalClock(plots, nowMs), [plots, nowMs]);

  const anyWorking = plots.some(
    (plot) => plot.state === "working" || plot.state === "hungry" || plot.state === "ready",
  );
  useEffect(() => {
    if (!anyWorking) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyWorking]);

  const penCount = occupiedCount(livePlots, true);
  const fieldCount = occupiedCount(livePlots, false);
  const balance = profile?.unlimitedGold ? Infinity : (profile?.goldBalance ?? 0);

  const context: AffordanceContext = useMemo(
    () => ({ bushels, feed, selectedStock: seed, plots: livePlots }),
    [bushels, feed, seed, livePlots],
  );

  const act = useCallback(
    async (body: Action) => {
      sending.current = true;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/homestead/actions", {
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
        if (response.status === 401) {
          window.location.reload();
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
          // A refused exchange is the one refusal that carries no grid, and the
          // thing it disagrees with the client about is how much of today's
          // allowance is left. Re-read it once this request has let go of the
          // send lock, so the window shows the truth rather than the amount
          // this browser thought it could still send.
          if (body.action === "exchange") window.setTimeout(() => void refresh(), 0);
          return;
        }
        applyResponse(data);
        if (body.action === "collect" && data.collected) {
          play("ui");
          setCelebrate({ plotIndex: body.plotIndex, nonce: Date.now() });
          setLastCollect({
            text: `+${itemLabel(data.collected.item, data.collected.quantity)}`,
            nonce: Date.now(),
          });
          if (data.collected.mucked) {
            setError("That plot came up weather-worn. Clear it before you use it again.");
          }
        }
        if (body.action === "exchange" && data.exchanged) {
          play("ui");
          setExchangeChoice(null);
          setExchangeNote(
            `${data.exchanged.gold.toLocaleString()} Gold is in your balance, for ${data.exchanged.bushels.toLocaleString()} Bushels.`,
          );
        }
      } catch {
        if (mounted.current) setError("Could not reach the farm. Check your connection.");
      } finally {
        sending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [applyResponse, play, refresh],
  );

  const selectedPlot = selected === null ? null : (livePlots.find((p) => p.plotIndex === selected) ?? null);

  /**
   * One tap, routed by the held tool. Look opens the panel; every other tool
   * either acts or explains why it cannot, and never silently does nothing --
   * a dead tap on a lit plot is the worst outcome available here.
   */
  const onPlotTap = useCallback(
    (plot: HomesteadPlotSnapshot) => {
      tapSound();
      if (tool === "inspect") {
        setSelected((current) => (current === plot.plotIndex ? null : plot.plotIndex));
        return;
      }
      const affordance = affordanceFor(tool, plot, context);
      if (affordance.kind === "blocked") {
        setError(affordance.reason);
        return;
      }
      if (affordance.kind === "none") {
        // Tapping the wrong plot for the held tool is a miss, not an error.
        // Show what the tool is for and move on.
        setSelected(plot.plotIndex);
        return;
      }
      setError(null);
      switch (tool) {
        case "plant":
          if (seed) void act({ action: "stock", plotIndex: plot.plotIndex, stock: seed });
          break;
        case "harvest":
          void act({ action: "collect", plotIndex: plot.plotIndex });
          break;
        case "feed":
          void act({ action: "feed", plotIndex: plot.plotIndex });
          break;
        case "clear":
          void act({ action: "clear", plotIndex: plot.plotIndex });
          break;
      }
    },
    [act, context, seed, tool],
  );

  const pickTool = useCallback((next: HomesteadTool) => {
    tapSound();
    setTool(next);
    setError(null);
    if (next !== "inspect") setSelected(null);
  }, []);

  const labelFor = useCallback(
    (plot: HomesteadPlotSnapshot): string => {
      const name = plot.stock ? HOMESTEAD_CATALOGUE[plot.stock].label : "plot";
      switch (plot.state) {
        case "locked":
          return plot.purchasable
            ? `Plot ${plot.plotIndex}, locked. Unlocks for ${plot.unlockPrice?.toLocaleString()} Gold.`
            : `Plot ${plot.plotIndex}, locked. Unlock earlier plots first.`;
        case "empty":
          return `Plot ${plot.plotIndex}, empty. Put something here.`;
        case "mucked":
          return `Plot ${plot.plotIndex}, weather-worn. Clearing it costs ${plot.muckFee?.toLocaleString()} Bushels.`;
        case "hungry":
          return `Plot ${plot.plotIndex}, ${name} hungry. Feed them to start the clock again.`;
        case "working":
          return `Plot ${plot.plotIndex}, ${name} working. Ready in ${countdownLabel(Date.parse(plot.readyAt ?? "") - nowMs)}.`;
        case "ready":
          return `Plot ${plot.plotIndex}, ready to harvest.`;
      }
    },
    [nowMs],
  );

  /** Stock whose track is full, so the seed chip can say so before it is picked. */
  const fullStocks = useMemo(() => {
    const full = new Set<HomesteadStock>();
    for (const stock of HOMESTEAD_STOCK) {
      const livestock = isLivestock(stock);
      const used = livestock ? penCount : fieldCount;
      if (used >= capFor(stock)) full.add(stock);
    }
    return full;
  }, [penCount, fieldCount]);

  const stockLabels = useMemo(
    () => Object.fromEntries(HOMESTEAD_STOCK.map((s) => [s, HOMESTEAD_CATALOGUE[s].label])),
    [],
  );

  const toolHint = HOMESTEAD_TOOL_DEFS[tool].hint;

  /** Produce in the barn, in catalogue order so the list never reshuffles. */
  const carried = useMemo(
    () =>
      HOMESTEAD_ITEMS.map((item) => ({ item, quantity: inventory[item] ?? 0 })).filter(
        (line) => line.quantity > 0,
      ),
    [inventory],
  );
  const carrying = carried.reduce((total, line) => total + line.quantity, 0);

  /**
   * The most this player can send out right now: the smaller of what is in the
   * barn and what is left of today's flat allowance. The allowance is the same
   * number for every farm, which is the whole point of the window -- more land
   * fills the bucket faster, it never makes the bucket bigger.
   */
  const exchangeMax = Math.min(bushels, exchange.maxBushels);
  const exchangeAmount = Math.min(exchangeChoice ?? exchangeMax, exchangeMax);
  const exchangePresets = useMemo(
    () => [100, 500, 1_000].filter((amount) => amount < exchangeMax),
    [exchangeMax],
  );
  // The bar shows what is LEFT, not what has been spent. Filling it as the day
  // was spent put a full gold bar directly above the words "0 of 5,000 Gold
  // left today", which is the opposite of what it meant. It drains now.
  const exchangeLeft = exchange.ceiling > 0 ? exchange.remaining / exchange.ceiling : 0;

  return (
    <main className="duel-shell ante-shell hs-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink />
          <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How to play
          </button>
        </div>
        {/* Bushels sit first and Gold last, in the order they matter here:
            everything on this screen is bought with Bushels, and Gold only
            ever buys acreage. */}
        <div className="hs-hud">
          <span className="hs-purse" title="Bushels">
            <img src="/homestead/tiles/bushels.png" alt="" aria-hidden="true" />
            <strong>{bushels.toLocaleString()}</strong>
            <span className="hs-sr">Bushels</span>
          </span>
          <span className="hs-feed" title="Feed servings">
            <Wheat size={13} aria-hidden="true" />
            <strong>{feed}</strong>
            <span className="hs-sr">feed servings</span>
          </span>
          <span className="gold-balance floor-wallet" title="Gold">
            <Coins size={13} aria-hidden="true" />
            <strong>{profile?.unlimitedGold ? "∞" : (profile?.goldBalance ?? 0).toLocaleString()}</strong>
          </span>
          <button
            type="button"
            className="hs-store-btn"
            onClick={() => { tapSound(); setShowStore(true); }}
          >
            <Store size={13} aria-hidden="true" /> Store
            {carrying > 0 && <span className="hs-store-badge">{carrying}</span>}
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
        <div className="hs-field">
          {!loaded ? (
            <p className="hs-hint hs-loading">Walking the fences…</p>
          ) : (
            <HomesteadGrid
              plots={livePlots}
              columns={GRID_COLUMNS}
              tool={tool}
              context={context}
              selected={selected}
              labelFor={labelFor}
              onPlotTap={onPlotTap}
              celebrate={celebrate}
            />
          )}
          {lastCollect && (
            <p key={lastCollect.nonce} className="hs-toast" role="status">
              {lastCollect.text}
            </p>
          )}
        </div>

        <div className="hs-controls">
          <HomesteadToolbelt tool={tool} context={context} onPick={pickTool} />
          {tool === "plant" && (
            <HomesteadSeedStrip
              stocks={HOMESTEAD_STOCK}
              labels={stockLabels}
              selected={seed}
              disabledStocks={fullStocks}
              onPick={(stock) => { tapSound(); setSeed(stock); setError(null); }}
            />
          )}
          <p className={clsx("hs-tool-hint", { "is-busy": busy })} aria-live="polite">
            {busy ? "Working…" : seed && tool === "plant"
              ? `${HOMESTEAD_CATALOGUE[seed].label} · ${HOMESTEAD_CATALOGUE[seed].seedCost.toLocaleString()} Bushels · ${formatDuration(HOMESTEAD_CATALOGUE[seed].durationMs)} · yields ${itemLabel(HOMESTEAD_YIELDS[seed].item, HOMESTEAD_YIELDS[seed].quantity)}`
              : toolHint}
          </p>
        </div>

        <div className="hs-side">
          {error && <p className="duel-error" role="alert">{error}</p>}
          <section className="hs-detail" aria-live="polite">
            {selectedPlot === null ? null : selectedPlot.state === "locked" ? (
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
                  disabled={busy || bushels < (selectedPlot.muckFee ?? 0)}
                  onClick={() => void act({ action: "clear", plotIndex: selectedPlot.plotIndex })}
                >
                  Clear for {selectedPlot.muckFee?.toLocaleString()} Bushels
                </button>
                {bushels < (selectedPlot.muckFee ?? 0) && (
                  <p className="hs-note">Sell some produce at the store first.</p>
                )}
              </div>
            ) : selectedPlot.state === "empty" ? (
              <div className="hs-panel">
                <h2>Empty plot</h2>
                <p>
                  Take the seedling from the toolbelt, pick what you want, and tap here. Fields and
                  pens have their own limits.
                </p>
                <button type="button" className="hs-cta" onClick={() => pickTool("plant")}>
                  Plant something
                </button>
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
                  Will yield{" "}
                  {itemLabel(
                    HOMESTEAD_YIELDS[selectedPlot.stock!].item,
                    selectedPlot.yieldQuantity ?? HOMESTEAD_YIELDS[selectedPlot.stock!].quantity,
                  )}
                  . Keeps going while you&apos;re away.
                </p>
                {selectedPlot.hungryAt && (
                  <p className="hs-note">
                    Wants feeding in {countdownLabel(Date.parse(selectedPlot.hungryAt) - nowMs)}.
                  </p>
                )}
              </div>
            ) : (
              <div className="hs-panel">
                <h2>Ready to harvest</h2>
                <p>
                  Goes straight into the barn. Sell it at the supply store whenever the
                  price suits you.
                </p>
                <button
                  type="button"
                  className="hs-cta hs-sell-btn"
                  disabled={busy}
                  onClick={() => void act({ action: "collect", plotIndex: selectedPlot.plotIndex })}
                >
                  Harvest{" "}
                  {itemLabel(
                    HOMESTEAD_YIELDS[selectedPlot.stock!].item,
                    selectedPlot.yieldQuantity ?? HOMESTEAD_YIELDS[selectedPlot.stock!].quantity,
                  )}
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
              <button
                type="button"
                className="hs-sheet-close"
                onClick={() => { setShowStore(false); setExchangeNote(null); }}
              >
                Done
              </button>
            </header>

            {/* The page's own banner sits behind the scrim, so a refusal raised
                by a button in here has to be answered in here. */}
            {error && <p className="duel-error" role="alert">{error}</p>}

            {/* Selling comes first: it is what you came in to do after a
                harvest, and it is where the Bushels for everything below it
                come from. */}
            <p className="hs-group-label">Sell your produce</p>
            {carried.length === 0 ? (
              <p className="hs-sheet-note">
                The barn is empty. Harvest a ready plot and its produce turns up here.
              </p>
            ) : (
              <ul className="hs-barn">
                {carried.map(({ item, quantity }) => {
                  const def = HOMESTEAD_ITEM_CATALOGUE[item];
                  return (
                    <li key={item} className="hs-barn-row">
                      <img
                        src={`/homestead/tiles/${def.icon}.png`}
                        alt=""
                        aria-hidden="true"
                      />
                      <span className="hs-barn-name">
                        <strong>{itemLabel(item, quantity)}</strong>
                        <span>{def.price.toLocaleString()} each</span>
                      </span>
                      <span className="hs-barn-actions">
                        <button
                          type="button"
                          className="hs-cta hs-cta-small"
                          disabled={busy}
                          onClick={() => void act({ action: "sell", item, quantity: 1 })}
                        >
                          Sell 1
                        </button>
                        <button
                          type="button"
                          className="hs-cta hs-cta-small"
                          disabled={busy}
                          onClick={() => void act({ action: "sell", item, quantity })}
                        >
                          Sell all · {(def.price * quantity).toLocaleString()}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="hs-group-label">Feed</p>
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
                    {item.cost.toLocaleString()} Bushels{" "}
                    <span>({Math.round(item.cost / item.servings)} each)</span>
                  </p>
                  <button
                    type="button"
                    className="hs-cta"
                    disabled={busy || bushels < item.cost}
                    onClick={() => void act({ action: "buy-feed", itemId: id })}
                  >
                    Buy
                  </button>
                </div>
              ))}
            </div>
            <p className="hs-sheet-note">
              You have <strong>{feed}</strong> {feed === 1 ? "serving" : "servings"} in the barn.
            </p>

            {/* Last, and deliberately so. Everything above is the farm's own
                money going round; this is the one place it leaves, and it
                should be a thing you go and do rather than the first button
                under your thumb. */}
            <p className="hs-group-label">Exchange window</p>
            <div className="hs-exchange">
              <p className="hs-sheet-note">
                Bushels leave the farm here, at <strong>{exchange.rate} Gold</strong> each. Every
                farm can send out the same {exchange.ceiling.toLocaleString()} Gold a day, whatever
                its acreage — land fills the day faster, it never makes the day bigger.
              </p>
              <p className="hs-exchange-meter">
                <span className="hs-exchange-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${exchangeLeft})` }} />
                </span>
                <span aria-live="polite">
                  <strong>{exchange.remaining.toLocaleString()}</strong> of{" "}
                  {exchange.ceiling.toLocaleString()} Gold left today
                </span>
              </p>

              {exchange.maxBushels < 1 ? (
                <p className="hs-sheet-note">
                  That is everything this farm can send out today. The window opens again in{" "}
                  {countdownLabel(Date.parse(exchange.resetsAt) - nowMs)}, and your Bushels keep
                  until then.
                </p>
              ) : bushels === 0 ? (
                <p className="hs-sheet-note">
                  Nothing to send. Sell some produce above and the Bushels turn up here.
                </p>
              ) : (
                <>
                  <div className="hs-exchange-amounts" role="group" aria-label="How many Bushels">
                    {[...exchangePresets, exchangeMax].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        className={clsx("hs-amount", { "is-on": amount === exchangeAmount })}
                        aria-pressed={amount === exchangeAmount}
                        onClick={() => { tapSound(); setExchangeChoice(amount); }}
                      >
                        {amount === exchangeMax && exchangePresets.length > 0
                          ? `Max · ${amount.toLocaleString()}`
                          : amount.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="hs-cta"
                    disabled={busy || exchangeAmount < 1}
                    onClick={() => void act({ action: "exchange", bushels: exchangeAmount })}
                  >
                    Exchange {exchangeAmount.toLocaleString()} Bushels for{" "}
                    {goldForBushels(exchangeAmount).toLocaleString()} Gold
                  </button>
                </>
              )}

              {exchangeNote && (
                <p className="hs-sheet-note hs-exchange-done" role="status">
                  {exchangeNote}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <HowToPlayModal title="StackChips Homestead" onClose={() => setShowHelp(false)}>
          <p>
            Pick a tool from the belt, then tap a plot. Every plot the tool can work on lights up,
            so you can see what the farm needs without reading it.
          </p>
          <p>
            The farm runs on <strong>Bushels</strong>, its own currency. Harvests go into the barn
            as produce; selling them at the supply store is what earns Bushels, and Bushels buy
            your seed, stock and feed. Gold buys one thing here: more land.
          </p>
          <p>
            Bushels come back out as Gold at the supply store&apos;s exchange window, at{" "}
            {exchange.rate} Gold each. Every farm can send out the same{" "}
            {exchange.ceiling.toLocaleString()} Gold a day — a bigger farm reaches that sooner, it
            never gets more than that. Whatever you do not exchange keeps until tomorrow.
          </p>
          <ul>
            <li>Plant crops or stock a pen on an empty plot, then come back when it turns gold.</li>
            <li>Crops look after themselves. Animals need feeding, and stop working when hungry.</li>
            <li>Nothing here can die and nothing can be lost. Neglect costs you time, not produce.</li>
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
