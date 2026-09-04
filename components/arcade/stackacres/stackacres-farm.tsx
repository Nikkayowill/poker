"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronLeft, Coins, HelpCircle, LocateFixed, X, ZoomIn, ZoomOut } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { useLandscape } from "@/components/use-landscape";
import { useAppShell } from "@/components/shell/app-shell";
import { tapSound } from "@/lib/audio/ui-sounds";
import {
  setAmbienceAwake,
  setAmbienceHerd,
  setAmbiencePlace,
  setFarmSfxMuted,
  startAmbience,
  stopAmbience,
} from "@/lib/audio/stackacres-ambience";
import { timeOfDay } from "@/lib/audio/stackacres-music";
import {
  buySound,
  collectSound,
  expandSound,
  feedSound,
  goldSound,
  muckSound,
  panelSound,
  refusedSound,
  retireSound,
  sellSound,
  sowSound,
  toolSound,
  travelSound,
} from "@/lib/audio/stackacres-sfx";
import { STACKACRES_FEED, type StackAcresStock } from "@/lib/stackacres/catalogue";
import { buyOptionsForZone, type BuyOption } from "@/lib/stackacres/district-panel";
import {
  exchangeState,
  goldForBushels,
  type StackAcresExchangeState,
} from "@/lib/stackacres/exchange";
import {
  STACKACRES_ITEM_CATALOGUE,
  STACKACRES_ITEMS,
  itemLabel,
  type StackAcresItem,
} from "@/lib/stackacres/items";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import { stockZone } from "@/lib/stackacres/world";
import { STACKACRES_ZONES, type ZoneId } from "@/lib/stackacres/zones";
import type { PlayerProfile } from "@/lib/profile/types";
import type { PainterName } from "./stackacres-art";
import { StackAcresBuySection, StackAcresUnitRows } from "./stackacres-district-panel";
import { StackAcresIcon } from "./stackacres-icon";
import { StackAcresMusicToggle } from "./stackacres-music-toggle";
import { StackAcresPlayScreen } from "./stackacres-play-screen";
import { StackAcresDestinations } from "./stackacres-destinations";
import { StackAcresRayWelcome } from "./stackacres-ray-welcome";
import { StackAcresToolbelt } from "./stackacres-toolbelt";
import { useStackAcresMusic } from "./use-stackacres-music";
import { StackAcresWorld, type StackAcresWorldApi } from "./stackacres-world";

/**
 * StackAcres: a farm of staked crops and livestock, drawn as a place you look
 * around in.
 *
 * THERE IS NO PLOT GRID (see 2026-09-03's CLAUDE.md entry -- "districts hold
 * stock, not plots"). Travelling to a district (the signpost, unchanged) IS
 * the selection; ./stackacres-district-panel.tsx's `StackAcresUnitRows` and
 * `StackAcresBuySection` are the fixed sidebar that shows what's standing
 * there and what can be bought, and they ARE the accessible/keyboard
 * surface, not a second one bolted on -- every row and button in them is a
 * real DOM button already. The canvas (./stackacres-world.tsx) is a picture
 * now, plus the one interactive gesture left on it: the scythe, dragged
 * across the Long Meadow.
 *
 * The DATABASE is the one thing that did not move: `homestead_plots` (left
 * in place, inert), `homestead_units`, `homestead_capacity`,
 * `homestead_inventory`, `homestead_harvests`, `homestead_feed`,
 * `homestead_exchanges`, `profiles.homestead_access` keep their names --
 * live objects in a production schema, renaming them is a data migration to
 * fix a caption.
 *
 * No poll. Progress is a pure function of the timestamps the server already
 * sent, so a one-second local clock re-derives it and the only refetches are
 * mount and tab-return. The one thing that is NOT derivable is muck, which
 * the server rolls once at settlement -- so a collection response is
 * authoritative about it and the client never guesses.
 */

const DEFAULT_RETRY_AFTER_SECONDS = 5;

interface StackAcresResponse {
  units: StackAcresUnitSnapshot[];
  /** Null for a cookie-less first visit: the read route never mints a session. */
  profile: PlayerProfile | null;
  feed: number;
  capacity: Partial<Record<StackAcresStock, number>>;
  inventory: Record<string, number>;
  bushels: number;
  exchange: StackAcresExchangeState;
  collected?: { stock: StackAcresStock; item: StackAcresItem; quantity: number; mucked: boolean };
  sold?: { item: StackAcresItem; quantity: number; bushels: number };
  exchanged?: { bushels: number; gold: number };
  error?: string;
  round?: StackAcresUnitSnapshot[];
}

type Action =
  | { action: "expand-capacity"; stock: StackAcresStock }
  | { action: "stock"; stock: StackAcresStock }
  | { action: "buy-stock"; stock: StackAcresStock }
  | { action: "retire"; unitId: string }
  | { action: "collect"; unitId: string }
  | { action: "feed"; unitId: string }
  | { action: "clear"; unitId: string }
  | { action: "buy-feed"; itemId: string }
  | { action: "sell"; item: StackAcresItem; quantity: number }
  | { action: "exchange"; bushels: number };

/**
 * A shelf in Ray's store, named and given the painted badge of what is on it.
 *
 * The three shelves shipped as three uppercase kickers with nothing to tell
 * them apart, so the whole sheet read as one wall of body copy and a player
 * scrolling for the exchange window had to read their way to it. The badge is
 * the same vector painter the icon beside a barn row uses, at a size a thumb
 * can find while moving -- the shelves are now told apart by picture first and
 * by wording second.
 *
 * The district drawer's own headings ("What's here", "Buy") deliberately do
 * NOT take one: there are two of them, they are the whole content of a narrow
 * panel, and a badge on each is decoration on something nobody was lost in.
 */
function StoreShelf({ icon, children }: { icon: PainterName; children: ReactNode }) {
  return (
    <p className="sa-group-label sa-shelf">
      <span className="sa-shelf-badge" aria-hidden="true">
        <StackAcresIcon name={icon} size={22} />
      </span>
      {children}
    </p>
  );
}

function countdownLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Re-derives readiness and hunger locally so a unit flips without a network
 * trip. Hunger is checked first and freezes progress, mirroring
 * lib/stackacres/units.ts exactly -- if these two ever disagree the server
 * wins, because it is the only one that can pay.
 */
function withLocalClock(units: StackAcresUnitSnapshot[], nowMs: number): StackAcresUnitSnapshot[] {
  return units.map((unit) => {
    if (unit.state === "mucked") return unit;
    const hungry = unit.hungryAt !== null && Date.parse(unit.hungryAt) <= nowMs;
    if (hungry) return { ...unit, state: "hungry" };
    const ready = Date.parse(unit.readyAt);
    const started = Date.parse(unit.startedAt);
    if (!Number.isFinite(ready) || !Number.isFinite(started)) return unit;
    if (ready <= nowMs) return { ...unit, state: "ready", progress: 1 };
    const progress = ready > started ? Math.min(1, Math.max(0, (nowMs - started) / (ready - started))) : 1;
    return { ...unit, state: "working", progress };
  });
}

export function StackAcresFarm() {
  const [units, setUnits] = useState<StackAcresUnitSnapshot[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [feed, setFeed] = useState(0);
  const [capacity, setCapacity] = useState<Partial<Record<StackAcresStock, number>>>({});
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [bushels, setBushels] = useState(0);
  // Seeded from the same pure helper the server uses, so the window's terms are
  // right on the first paint rather than blank until the read lands.
  const [exchange, setExchange] = useState<StackAcresExchangeState>(() =>
    exchangeState(0, new Date()),
  );
  const [exchangeChoice, setExchangeChoice] = useState<number | null>(null);
  const [exchangeNote, setExchangeNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [worldReady, setWorldReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyUnitId, setBusyUnitId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<StackAcresTool>("inspect");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [celebrate, setCelebrate] = useState<{ unitId: string; nonce: number } | null>(null);
  const [lastCollect, setLastCollect] = useState<{ text: string; nonce: number } | null>(null);
  // Gates a tap-to-play splash: nothing plays until the player has made a
  // real gesture, which also doubles as the autoplay-policy unlock every
  // browser requires before it will let audio start on its own.
  const [hasStarted, setHasStarted] = useState(false);
  // Grandfather Ray's one-time hello, first visit only -- a plain localStorage
  // flag rather than a profile field, since this is a hello, not a fact about
  // the farm. Read only once `hasStarted` flips true, so it never flashes
  // behind the tap-to-play splash.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (!hasStarted) return;
    // Deferred a tick, same reason install-prompt.tsx defers its own
    // localStorage read -- react-hooks/set-state-in-effect rejects a
    // synchronous setState in the effect body.
    const timer = window.setTimeout(() => {
      try {
        if (!window.localStorage.getItem("sa-ray-welcomed")) setShowWelcome(true);
      } catch {
        // Private browsing or blocked storage: skip the intro rather than error.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hasStarted]);
  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try {
      window.localStorage.setItem("sa-ray-welcomed", "1");
    } catch {
      // Nothing to persist if storage is blocked; it just re-offers next visit.
    }
  }, []);

  useStackAcresMusic(hasStarted);

  /**
   * The ambient soundscape, started by the same gesture the music is.
   *
   * It cannot start any earlier: an AudioContext built before a user gesture
   * comes back suspended, and every cue scheduled against it would queue up
   * and then fire at once the moment it resumed. The tap-to-play splash is
   * that gesture -- it exists for the music for exactly this reason, and the
   * ambience rides on the same one rather than inventing a second prompt.
   */
  useEffect(() => {
    if (!hasStarted) return;
    startAmbience();
    return () => stopAmbience();
  }, [hasStarted]);

  // A farm making wind noise in a background tab is a battery bug, not
  // atmosphere. Suspends the whole graph rather than muting it, so the
  // scheduler stops doing work too.
  useEffect(() => {
    if (!hasStarted) return;
    const onVisible = () => setAmbienceAwake(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [hasStarted]);

  const { setImmersive, soundEnabled } = useAppShell();
  useEffect(() => {
    setImmersive(hasStarted);
  }, [hasStarted, setImmersive]);

  /**
   * The farm's action sounds follow the APP-wide mute, not the farm's own
   * background-sound toggle. Two different promises: the HUD speaker means
   * "stop the noise this place makes", the app mute means "stop telling me my
   * taps landed", and silencing button feedback because someone wanted the
   * birds off would be the wrong reading of either.
   */
  useEffect(() => {
    setFarmSfxMuted(!soundEnabled);
  }, [soundEnabled]);

  // Landscape-only, same posture and same hook as the poker table (see
  // poker-table.tsx) rather than a second orientation check invented here.
  const landscape = useLandscape();
  /**
   * No `useArcadeSound` here any more.
   *
   * It was called with `gameSounds: true`, which eagerly fetches the POKER
   * table's cue set (deal, chips, win) -- around 450KB -- on a route that
   * never plays any of them. It was there because two actions used to answer
   * with `play("ui")`; both now have farm sounds of their own, and the chrome
   * cues `tapSound` still uses prime themselves on import (CHROME_EFFECTS in
   * lib/audio/manifest.ts). The app-wide mute is applied by the shell, which
   * is always mounted, so nothing is left for the hook to do.
   */
  const sending = useRef(false);
  const mounted = useRef(true);
  const world = useRef<StackAcresWorldApi | null>(null);
  /**
   * The district the camera was last SENT to, which is not the same as the
   * one it is currently over: the map is unbounded and the player can pan
   * anywhere, so tracking the camera's true position would have this
   * flickering as they crossed the woods. It marks where they chose to go,
   * and it is also the sidebar's whole selection state now -- there is no
   * second "which plot is selected" any more.
   */
  const [place, setPlace] = useState<ZoneId>("farmstead");
  // The district panel used to sit open over the map at all times; Kayo
  // didn't ask for a permanent right-edge sidebar, so it now opens only when
  // a player actually travels somewhere and stays open until they close it.
  const [panelOpen, setPanelOpen] = useState(false);
  // Which unit is mid-"are you sure" for retiring. Never a plain confirm():
  // retiring refunds nothing, so it has to be two deliberate taps.
  const [retiringUnitId, setRetiringUnitId] = useState<string | null>(null);
  useEffect(() => () => { mounted.current = false; }, []);

  /**
   * The unit list as of right now, for `act` to read when a response lands.
   *
   * A ref rather than a dependency: `act` is depended on by every handler on
   * the page, so putting `units` in its dependency array would rebuild all of
   * them on every clock tick of every growing unit. The one thing `act` needs
   * from the list is which stock a collected unit was, and that unit is
   * usually DELETED by the time the response arrives (a clean collect removes
   * the row), so the response itself cannot answer it.
   */
  const unitsRef = useRef(units);
  useEffect(() => {
    unitsRef.current = units;
  }, [units]);

  const applyResponse = useCallback((data: Partial<StackAcresResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.units) setUnits(data.units);
    if (typeof data.feed === "number") setFeed(data.feed);
    if (data.capacity) setCapacity(data.capacity);
    if (data.inventory) setInventory(data.inventory);
    if (typeof data.bushels === "number") setBushels(data.bushels);
    if (data.exchange) setExchange(data.exchange);
  }, []);

  const refresh = useCallback(async () => {
    if (sending.current) return;
    try {
      const response = await fetch("/api/stackacres", { cache: "no-store" });
      if (response.status === 429) return;
      // The pass was rotated or expired under us. Reload so the server
      // component answers with the gate rather than leaving a farm on screen
      // whose every button will now fail.
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = (await response.json()) as Partial<StackAcresResponse>;
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

  const liveUnits = useMemo(() => withLocalClock(units, nowMs), [units, nowMs]);

  const anyWorking = units.some(
    (unit) => unit.state === "working" || unit.state === "hungry" || unit.state === "ready",
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
      if ("unitId" in body) setBusyUnitId(body.unitId);
      setError(null);
      try {
        const response = await fetch("/api/stackacres/actions", {
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
        const data = (await response.json()) as Partial<StackAcresResponse>;
        if (!mounted.current) return;
        if (!response.ok) {
          // A dull knock on wood, never a buzzer: most refusals here are "you
          // cannot afford that yet", which is ordinary and frequent, and a
          // harsh error tone on an ordinary event teaches a player to dread
          // their own farm.
          refusedSound();
          // A refusal carries the true round; paint it, and only raise a
          // banner when there is no round to speak for itself.
          if (data.round) setUnits(data.round);
          if (data.profile) setProfile(data.profile);
          if (!data.round) setError(data.error ?? "That did not go through.");
          // A refused exchange is the one refusal that carries no round, and
          // the thing it disagrees with the client about is how much of
          // today's allowance is left. Re-read it once this request has let
          // go of the send lock, so the window shows the truth rather than
          // the amount this browser thought it could still send.
          if (body.action === "exchange") window.setTimeout(() => void refresh(), 0);
          return;
        }
        applyResponse(data);
        if (body.action === "collect" && data.collected) {
          // Fired here rather than on the press because the ANIMAL is what
          // makes this sound worth having, and only the response knows which
          // unit actually paid out: a hen clucking as the eggs go in the
          // basket is the moment the farm most needs to feel alive.
          const unit = unitsRef.current.find((candidate) => candidate.id === body.unitId);
          if (unit) collectSound(unit.stock);
          setCelebrate({ unitId: body.unitId, nonce: Date.now() });
          setLastCollect({
            text: `+${itemLabel(data.collected.item, data.collected.quantity)}`,
            nonce: Date.now(),
          });
          if (data.collected.mucked) {
            setError("That came up weather-worn. Clear it before it earns again.");
          }
        }
        if (body.action === "exchange" && data.exchanged) {
          // The one place on the farm where coins are heard: this is Gold
          // actually leaving for the player's balance, and it is the only
          // action here that touches the wider economy.
          goldSound();
          setExchangeChoice(null);
          setExchangeNote(
            `${data.exchanged.gold.toLocaleString()} Gold is in your balance, for ${data.exchanged.bushels.toLocaleString()} Bushels.`,
          );
        }
      } catch {
        if (mounted.current) setError("Could not reach the farm. Check your connection.");
      } finally {
        sending.current = false;
        if (mounted.current) {
          setBusy(false);
          setBusyUnitId(null);
        }
      }
    },
    [applyResponse, refresh],
  );

  // No effect needed to disarm the retire confirmation on district change:
  // StackAcresUnitRows only ever renders the current district's own units
  // (districtUnits, below), so a unit armed elsewhere simply has no row left
  // to show the confirmation on until the player travels back to it.
  /**
   * Every handler below answers its own press with its own sound rather than
   * the app's generic chrome click. Sowing, harvesting and paying to expand a
   * pen used to be audibly the same event, which made the one surface in
   * StackChips where the press IS the game feel like a form. See
   * lib/audio/stackacres-sfx.ts.
   *
   * The sound fires on the PRESS, not on the response: the server round trip
   * is real, and a farm that stays silent for 200ms after every tap feels
   * broken however fast it eventually answers. A press that turns out to be
   * refused gets the wooden knock on top of it, from `act`.
   */
  const onCollect = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      // The collection itself is announced when it lands (in `act`), where
      // the produce is actually known -- this is only the press.
      tapSound();
      void act({ action: "collect", unitId: unit.id });
    },
    [act],
  );
  const onFeed = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      feedSound(unit.stock);
      void act({ action: "feed", unitId: unit.id });
    },
    [act],
  );
  const onClear = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      muckSound();
      void act({ action: "clear", unitId: unit.id });
    },
    [act],
  );
  const onArmRetire = useCallback((unit: StackAcresUnitSnapshot) => {
    tapSound();
    setRetiringUnitId(unit.id);
  }, []);
  const onCancelRetire = useCallback(() => {
    tapSound();
    setRetiringUnitId(null);
  }, []);
  const onConfirmRetire = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      retireSound();
      setRetiringUnitId(null);
      void act({ action: "retire", unitId: unit.id });
    },
    [act],
  );

  const onSeed = useCallback(
    (stock: StackAcresStock) => {
      sowSound();
      void act({ action: "stock", stock });
    },
    [act],
  );
  const onBuyOutright = useCallback(
    (stock: StackAcresStock) => {
      buySound();
      void act({ action: "buy-stock", stock });
    },
    [act],
  );
  const onExpand = useCallback(
    (stock: StackAcresStock) => {
      expandSound();
      void act({ action: "expand-capacity", stock });
    },
    [act],
  );

  const pickTool = useCallback((next: StackAcresTool) => {
    toolSound();
    setTool(next);
    setError(null);
  }, []);

  const travel = useCallback((zone: ZoneId) => {
    travelSound();
    setPlace(zone);
    setPanelOpen(true);
    world.current?.focusZone(zone);
  }, []);

  const districtUnits = useMemo(
    () => liveUnits.filter((unit) => stockZone(unit.stock) === place),
    [liveUnits, place],
  );

  /**
   * The soundscape follows the player: which district they travelled to, and
   * what hour it is. `timeOfDay` is the music's own, so the two layers can
   * never disagree about whether it is night.
   *
   * Re-read on a slow interval rather than derived from `nowMs`: that clock
   * only ticks while something is growing, so a farm sitting idle across 6pm
   * would keep its daylight birds until the player did something.
   */
  const [tod, setTod] = useState(() => timeOfDay());
  useEffect(() => {
    const timer = window.setInterval(() => setTod(timeOfDay()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setAmbiencePlace(place, tod);
  }, [place, tod]);

  /**
   * Standing in Ox Fields with no cattle should sound like empty ground;
   * standing there with three should sound like you keep cattle. Only the
   * animals in the district being listened to count -- a cow four districts
   * away is not audible from here.
   */
  useEffect(() => {
    const herd = { hen: 0, pig: 0, cattle: 0 };
    for (const unit of districtUnits) {
      // A mucked unit has nothing standing on it to make a noise.
      if (unit.state === "mucked") continue;
      if (unit.stock === "hen" || unit.stock === "pig" || unit.stock === "cattle") {
        herd[unit.stock] += 1;
      }
    }
    setAmbienceHerd(herd);
  }, [districtUnits]);
  const buyOptions: BuyOption[] = useMemo(
    () => buyOptionsForZone(place, { units: liveUnits, bushels, capacity }),
    [place, liveUnits, bushels, capacity],
  );

  const toolHint = STACKACRES_TOOL_DEFS[tool].hint;

  /** Produce in the barn, in catalogue order so the list never reshuffles. */
  const carried = useMemo(
    () =>
      STACKACRES_ITEMS.map((item) => ({ item, quantity: inventory[item] ?? 0 })).filter(
        (line) => line.quantity > 0,
      ),
    [inventory],
  );
  const carrying = carried.reduce((total, line) => total + line.quantity, 0);

  /**
   * The most this player can send out right now: the smaller of what is in the
   * barn and what is left of today's flat allowance. The allowance is the same
   * number for every farm, which is the whole point of the window -- more
   * stock fills the bucket faster, it never makes the bucket bigger.
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

  const onWorldReady = useCallback(() => setWorldReady(true), []);

  // After every hook above, same position poker-table.tsx gates its own
  // render at. A full replacement, not an overlay -- the farm itself never
  // mounts in portrait, so there is nothing underneath to half-render or to
  // trap a tap on. `useLandscape`'s server snapshot defaults to landscape, so
  // this never flashes on desktop and only ever shows up on a real portrait
  // phone once the client has actually checked.
  if (!landscape) {
    return (
      <main className="game-shell orientation-gate-shell">
        <div className="orientation-gate" role="status" aria-live="polite">
          <span className="orientation-gate-mark"><StackChipsMark size={44} /></span>
          <h1>Turn your phone sideways</h1>
          {/* Was "The StackAcres is available in landscape mode", a leftover
              from the homestead -> StackAcres rename reading straight through
              the old "The Homestead". */}
          <p>StackAcres only opens in landscape.</p>
          <small>Rotate your device to keep farming.</small>
        </div>
      </main>
    );
  }

  // Same full-replacement posture as the orientation gate above, and it runs
  // after that check on purpose: a portrait phone sees "turn sideways" first,
  // and the splash's own gesture only needs to happen once the farm can
  // actually render. Data keeps loading underneath it (the fetch effect
  // already ran on mount), so the farm is ready the instant a player taps
  // through rather than waiting on the splash's own fade.
  if (!hasStarted) {
    return <StackAcresPlayScreen onStart={() => setHasStarted(true)} />;
  }

  const hint = busy ? "Working…" : toolHint;
  const district = STACKACRES_ZONES[place];

  return (
    <main className="duel-shell ante-shell sa-shell">
      <header className="floor-bar">
        <div className="floor-bar-left">
          <FloorBackLink />
          <button type="button" className="htp-trigger" onClick={() => { tapSound(); setShowHelp(true); }}>
            <HelpCircle size={13} aria-hidden="true" /> How to play
          </button>
        </div>
        {/* Bushels sit first and Gold last, in the order they matter here:
            everything on this screen is bought with Bushels, and Gold buys
            capacity and stock outright. */}
        <div className="sa-hud">
          <span className="sa-purse" title="Bushels">
            <StackAcresIcon name="ico-bushels" size={16} />
            <strong>{bushels.toLocaleString()}</strong>
            <span className="sa-sr">Bushels</span>
          </span>
          <span className="sa-feed" title="Feed servings">
            <StackAcresIcon name="ico-feed" size={16} />
            <strong>{feed}</strong>
            <span className="sa-sr">feed servings</span>
          </span>
          <span className="gold-balance floor-wallet" title="Gold">
            <Coins size={13} aria-hidden="true" />
            <strong>{profile?.unlimitedGold ? "∞" : (profile?.goldBalance ?? 0).toLocaleString()}</strong>
          </span>
          <StackAcresMusicToggle />
        </div>
      </header>

      <div className="sa-main">
        {/* The world. Everything after it inside .sa-field is chrome pinned
            over the canvas; the canvas itself is the only thing that moves
            when the player drags. */}
        {/* `data-drawer` is read by 52-stackacres.css so the signpost rail can
            give up the drawer's column while it is open -- five signs do not
            fit beside a 320px drawer on a phone, and the one that fell off the
            end was Ray's, which is the only way into the store. */}
        <div className="sa-field" data-drawer={panelOpen ? "open" : "shut"}>
          {loaded && (
            <StackAcresWorld
              units={liveUnits}
              tool={tool}
              celebrate={celebrate}
              onReady={onWorldReady}
              api={world}
            />
          )}
          {(!loaded || !worldReady) && (
            <p className="sa-hint sa-loading">Walking the fences…</p>
          )}

          {/* The masthead pill (logo, and before that the pen/field counts) that
              used to sit here is gone -- the signpost below is what a player
              actually reads on this screen, and it now takes the band this
              freed up. The page still needs its own heading for the a11y
              tree, just with no visual footprint to reclaim the space for. */}
          <h1 className="sr-only">StackAcres</h1>

          {lastCollect && (
            <p key={lastCollect.nonce} className="sa-toast" role="status">
              {lastCollect.text}
            </p>
          )}

          <div className="sa-controls">
            <StackAcresToolbelt tool={tool} onPick={pickTool} />
          </div>

          <StackAcresDestinations
            active={place}
            onTravel={travel}
            onOpenStore={() => { panelSound(); setShowStore(true); }}
            carrying={carrying}
          />

          <div className="sa-camera" role="group" aria-label="Map view">
            <button type="button" className="sa-camera-btn" aria-label="Zoom in" onClick={() => world.current?.zoomBy(1.3)}>
              <ZoomIn size={16} aria-hidden="true" />
            </button>
            <button type="button" className="sa-camera-btn" aria-label="Zoom out" onClick={() => world.current?.zoomBy(1 / 1.3)}>
              <ZoomOut size={16} aria-hidden="true" />
            </button>
            <button type="button" className="sa-camera-btn" aria-label="Back to the farm" onClick={() => { setPlace("farmstead"); setPanelOpen(true); world.current?.recenter(); }}>
              <LocateFixed size={16} aria-hidden="true" />
            </button>
          </div>

          <p className={clsx("sa-tool-hint", { "is-busy": busy })} aria-live="polite">
            {hint}
          </p>

          <div className="sa-side">
            {error && <p className="duel-error" role="alert">{error}</p>}
          </div>

          {/* The handle the panel hangs off when it is shut. Before this,
              the only way back into a district you had closed was to find
              its name in the signpost and travel there again -- which also
              flies the camera, so "let me look at that list again" cost you
              your view. It is a peg on the right edge, always there, always
              naming the district it will open, and it is the one piece of
              chrome that is deliberately louder than it needs to be: it is
              how a player learns the panel is a drawer rather than something
              that happens to them. */}
          <button
            type="button"
            className={clsx("sa-panel-tab", { "is-stowed": panelOpen })}
            aria-expanded={panelOpen}
            aria-controls="sa-district-panel"
            onClick={() => { panelSound(); setPanelOpen(true); }}
            tabIndex={panelOpen ? -1 : undefined}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span className="sa-panel-tab-label">{district.label.replace(/^The /, "")}</span>
          </button>

          {/* The district panel: no plot to select any more, travelling here
              (the signpost above) IS the selection. It only slides out once
              a player has actually travelled somewhere, and stays shut
              otherwise until the close button below -- or the peg above --
              says otherwise. */}
          <aside
            id="sa-district-panel"
            className={clsx("sa-district-panel", { "is-open": panelOpen })}
            data-zone={place}
            aria-label={`${district.label} panel`}
            inert={!panelOpen}
          >
            <div className="sa-panel-head">
              <div className="sa-ray-row">
                <img src="/stackacres/sprites/grandfather-ray-portrait.png" alt="" className="sa-ray-portrait" />
                <span className="sa-ray-name">Grandfather Ray</span>
              </div>
              <button
                type="button"
                className="sa-panel-close"
                aria-label="Close panel"
                onClick={() => { panelSound(); setPanelOpen(false); }}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <h2 className="sa-district-title">{district.label}</h2>
            <p className="sa-district-blurb">{district.blurb}</p>

            <div className="sa-panel-section">
              <h3 className="sa-group-label">What&apos;s here</h3>
              <StackAcresUnitRows
                units={districtUnits}
                nowMs={nowMs}
                feed={feed}
                bushels={bushels}
                busyUnitId={busyUnitId}
                armedUnitId={retiringUnitId}
                onCollect={onCollect}
                onFeed={onFeed}
                onClear={onClear}
                onArmRetire={onArmRetire}
                onConfirmRetire={onConfirmRetire}
                onCancelRetire={onCancelRetire}
              />
            </div>

            <div className="sa-panel-section">
              <h3 className="sa-group-label">Buy</h3>
              <StackAcresBuySection
                options={buyOptions}
                busy={busy}
                onSeed={onSeed}
                onBuyOutright={onBuyOutright}
                onExpand={onExpand}
              />
            </div>
          </aside>
        </div>
      </div>

      {showStore && (
        <div className="sa-sheet-scrim" role="dialog" aria-modal="true" aria-label="Supply store">
          <div className="sa-sheet">
            <header className="sa-sheet-head">
              <div>
                <div className="sa-ray-row">
                  <img src="/stackacres/sprites/grandfather-ray-portrait.png" alt="" className="sa-ray-portrait" />
                  <span className="sa-ray-name">Grandfather Ray</span>
                </div>
                <h2>Supply store</h2>
              </div>
              <button
                type="button"
                className="sa-sheet-close"
                onClick={() => { panelSound(); setShowStore(false); setExchangeNote(null); }}
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
            <StoreShelf icon="ico-harvest">Sell your produce</StoreShelf>
            {carried.length === 0 ? (
              <p className="sa-sheet-note">
                The barn is empty. Collect from a ready unit and its produce turns up here.
              </p>
            ) : (
              <ul className="sa-barn">
                {carried.map(({ item, quantity }) => {
                  const def = STACKACRES_ITEM_CATALOGUE[item];
                  return (
                    <li key={item} className="sa-barn-row">
                      <StackAcresIcon name={def.icon as PainterName} size={28} />
                      <span className="sa-barn-name">
                        <strong>{itemLabel(item, quantity)}</strong>
                        <span>{def.price.toLocaleString()} each</span>
                      </span>
                      <span className="sa-barn-actions">
                        <button
                          type="button"
                          className="sa-cta sa-cta-small"
                          disabled={busy}
                          onClick={() => { sellSound(); void act({ action: "sell", item, quantity: 1 }); }}
                        >
                          Sell 1
                        </button>
                        <button
                          type="button"
                          className="sa-cta sa-cta-small"
                          disabled={busy}
                          onClick={() => { sellSound(); void act({ action: "sell", item, quantity }); }}
                        >
                          Sell all · {(def.price * quantity).toLocaleString()}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <StoreShelf icon="ico-feed">Feed</StoreShelf>
            <p className="sa-sheet-note">
              Animals eat. A hungry pen stops working until you feed it, so keep a shipment in the
              barn before you leave a Cattle Pen overnight.
            </p>
            <div className="sa-stock-cards">
              {Object.entries(STACKACRES_FEED).map(([id, item]) => (
                <div key={id} className="sa-stock-card">
                  <h3>{item.label}</h3>
                  <p className="sa-stock-terms">{item.servings} servings</p>
                  <p className="sa-stock-yield">
                    {item.cost.toLocaleString()} Bushels{" "}
                    <span>({Math.round(item.cost / item.servings)} each)</span>
                  </p>
                  <button
                    type="button"
                    className="sa-cta"
                    disabled={busy || bushels < item.cost}
                    onClick={() => { buySound(); void act({ action: "buy-feed", itemId: id }); }}
                  >
                    Buy
                  </button>
                </div>
              ))}
            </div>
            <p className="sa-sheet-note">
              You have <strong>{feed}</strong> {feed === 1 ? "serving" : "servings"} in the barn.
            </p>

            {/* Last, and deliberately so. Everything above is the farm's own
                money going round; this is the one place it leaves, and it
                should be a thing you go and do rather than the first button
                under your thumb. */}
            <StoreShelf icon="ico-gold">Exchange window</StoreShelf>
            <div className="sa-exchange">
              <p className="sa-sheet-note">
                Bushels leave the farm here, at <strong>{exchange.rate} Gold</strong> each. Every
                farm can send out the same {exchange.ceiling.toLocaleString()} Gold a day, whatever
                it owns — stock fills the day faster, it never makes the day bigger.
              </p>
              <p className="sa-exchange-meter">
                <span className="sa-exchange-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${exchangeLeft})` }} />
                </span>
                <span aria-live="polite">
                  <strong>{exchange.remaining.toLocaleString()}</strong> of{" "}
                  {exchange.ceiling.toLocaleString()} Gold left today
                </span>
              </p>

              {exchange.maxBushels < 1 ? (
                <p className="sa-sheet-note">
                  That is everything this farm can send out today. The window opens again in{" "}
                  {countdownLabel(Date.parse(exchange.resetsAt) - nowMs)}, and your Bushels keep
                  until then.
                </p>
              ) : bushels === 0 ? (
                <p className="sa-sheet-note">
                  Nothing to send. Sell some produce above and the Bushels turn up here.
                </p>
              ) : (
                <>
                  <div className="sa-exchange-amounts" role="group" aria-label="How many Bushels">
                    {[...exchangePresets, exchangeMax].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        className={clsx("sa-amount", { "is-on": amount === exchangeAmount })}
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
                    className="sa-cta"
                    disabled={busy || exchangeAmount < 1}
                    onClick={() => void act({ action: "exchange", bushels: exchangeAmount })}
                  >
                    Exchange {exchangeAmount.toLocaleString()} Bushels for{" "}
                    {goldForBushels(exchangeAmount).toLocaleString()} Gold
                  </button>
                </>
              )}

              {exchangeNote && (
                <p className="sa-sheet-note sa-exchange-done" role="status">
                  {exchangeNote}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <HowToPlayModal title="StackAcres" onClose={() => setShowHelp(false)}>
          <p>
            The farm is a map of four districts. Drag to look around, pinch or scroll to zoom, or
            tap a district&apos;s name to travel straight to it — that also opens a panel showing
            what you own there and what you can buy. Close it and it folds away to a handle on the
            right edge; tap that to bring it back without moving the camera. There is nothing to
            tap on the map itself except the scythe.
          </p>
          <p>
            The farm runs on <strong>Bushels</strong>, its own currency. Collecting from a ready
            unit puts produce in the barn; selling it at the supply store is what earns Bushels, and
            Bushels buy your seed and feed. Gold buys stock outright, and buys more room to keep at
            once.
          </p>
          <p>
            Bushels come back out as Gold at the supply store&apos;s exchange window, at{" "}
            {exchange.rate} Gold each. Every farm can send out the same{" "}
            {exchange.ceiling.toLocaleString()} Gold a day — owning more reaches that sooner, it
            never gets more than that. Whatever you do not exchange keeps until tomorrow.
          </p>
          <ul>
            <li>Seed a crop or stock a pen with Bushels, then come back when it turns gold.</li>
            <li>Crops look after themselves. Animals need feeding, and stop working when hungry.</li>
            <li>Nothing here can die and nothing can be lost. Neglect costs you time, not produce.</li>
            <li>
              Each kind of animal or crop can have three going at once, more if you spend Gold to
              expand it — one kind&apos;s room has nothing to do with any other&apos;s.
            </li>
            <li>
              Something finished sometimes comes up weather-worn and needs clearing, in Bushels,
              before it frees its room again.
            </li>
            <li>
              Buying outright with Gold is permanent: it starts its next run the moment you collect,
              never needs seeding again, and can be sent away if you want the room back — for
              nothing, that is not a refund.
            </li>
          </ul>
        </HowToPlayModal>
      )}

      {showWelcome && <StackAcresRayWelcome onClose={dismissWelcome} />}
    </main>
  );
}
