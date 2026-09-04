"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronLeft, Coins, HelpCircle, LocateFixed, X, ZoomIn, ZoomOut } from "lucide-react";
import { FloorBackLink } from "@/components/arcade/floor-back-link";
import { HowToPlayModal } from "@/components/arcade/how-to-play-modal";
import { useArcadeSound } from "@/components/arcade/use-arcade-sound";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { useLandscape } from "@/components/use-landscape";
import { useAppShell } from "@/components/shell/app-shell";
import { tapSound } from "@/lib/audio/ui-sounds";
import { STACKACRES_FEED, type StackAcresStock } from "@/lib/stackacres/catalogue";
import { buyOptionsForZone, type BuyOption } from "@/lib/stackacres/district-panel";
import { exchangeState, type StackAcresExchangeState } from "@/lib/stackacres/exchange";
import { upkeepState, type StackAcresUpkeepState } from "@/lib/stackacres/upkeep";
import type { BountifulHarvest } from "@/lib/stackacres/bounty";
import type { StackAcresItem } from "@/lib/stackacres/items";
import { collectFloat, tapActionFor } from "@/lib/stackacres/tap-action";
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
import { StackAcresRadialMenu } from "./stackacres-radial-menu";
import { StackAcresRayWelcome } from "./stackacres-ray-welcome";
import { StackAcresToolbelt } from "./stackacres-toolbelt";
import { useStackAcresMusic } from "./use-stackacres-music";
import { StackAcresWorld, type StackAcresWorldApi } from "./stackacres-world";
import type { TapPoint } from "./stackacres-scene";

/**
 * StackAcres: a farm of staked crops and livestock, drawn as a place you look
 * around in.
 *
 * THERE IS NO PLOT GRID (see 2026-09-03's CLAUDE.md entry -- "districts hold
 * stock, not plots"), but THE FARM ITSELF IS THE CONTROLS. A tap that lands
 * on a unit's own picture collects, feeds or clears it where it stands; a
 * tap on a district's empty fenced ground drops ./stackacres-radial-menu.tsx
 * beside the finger to seed something there. Nothing opens, nothing has to be
 * travelled to first, and `place` follows the finger rather than the other
 * way round. lib/stackacres/tap-action.ts is what decides which of those a
 * given tap is, off the same `unitRowAction` the sidebar rows use, so the
 * two surfaces can never disagree about what a unit affords.
 *
 * The sidebar (./stackacres-district-panel.tsx) is for the deep end now:
 * capacity bought with Gold, stock bought outright, and the district's own
 * standing list. It no longer opens on its own -- travelling flies the
 * camera and nothing else -- so the old tap-district / wait / find-the-row /
 * press-Collect loop is gone. Its unit rows STAY, and are not redundant:
 * they remain the only keyboard and screen-reader path to everything a tap
 * on the canvas does, and the canvas is `aria-hidden` by design.
 *
 * ONE CURRENCY. Harvesting used to fill a barn, the barn was sold at Ray's
 * for Bushels, and Bushels were queued at an exchange window for Gold. All
 * three collapsed into one act: bringing in a harvest pays Gold, once, right
 * there. What survived is the thing that mattered -- the flat daily ceiling on
 * how much Gold a farm may send out -- which now sits behind the harvest
 * itself. Ray still sells feed and still shows what is left of the day.
 *
 * The DATABASE is the one thing that did not move: `homestead_plots` and
 * `homestead_inventory` (both left in place, inert), `homestead_units`,
 * `homestead_capacity`, `homestead_harvests`, `homestead_feed`,
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
  exchange: StackAcresExchangeState;
  upkeep: StackAcresUpkeepState;
  harvest?: {
    units: number;
    tally: { item: StackAcresItem; quantity: number }[];
    gross: number;
    bounty: BountifulHarvest;
    bonus: number;
    upkeep: number;
    gold: number;
    mucked: number;
  };
  error?: string;
  round?: StackAcresUnitSnapshot[];
}

type Action =
  | { action: "expand-capacity"; stock: StackAcresStock }
  | { action: "stock"; stock: StackAcresStock }
  | { action: "buy-stock"; stock: StackAcresStock }
  | { action: "retire"; unitId: string }
  // No `unitIds` means "bring in everything that is ready" -- what the
  // Harvest button sends. A single id is what tapping one unit sends.
  | { action: "collect"; unitIds?: string[] }
  | { action: "feed"; unitId: string }
  | { action: "clear"; unitId: string }
  | { action: "buy-feed"; itemId: string };

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
  // Seeded from the same pure helpers the server uses, so the day's terms are
  // right on the first paint rather than blank until the read lands.
  const [exchange, setExchange] = useState<StackAcresExchangeState>(() =>
    exchangeState(0, new Date()),
  );
  const [upkeep, setUpkeep] = useState<StackAcresUpkeepState>(() => upkeepState(0, 0));
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

  const { setImmersive } = useAppShell();
  useEffect(() => {
    setImmersive(hasStarted);
  }, [hasStarted, setImmersive]);

  // Landscape-only, same posture and same hook as the poker table (see
  // poker-table.tsx) rather than a second orientation check invented here.
  const landscape = useLandscape();
  const play = useArcadeSound({ gameSounds: true });
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
  // The district panel used to sit open over the map at all times, and then
  // to open whenever a player travelled anywhere. It is deep management now
  // -- capacity, buying outright, the standing list -- so it only opens when
  // it is actually asked for: the Manage button, or the radial menu's own
  // handoff. Travelling flies the camera and nothing else.
  const [panelOpen, setPanelOpen] = useState(false);
  /**
   * The seed menu dropped beside a finger that tapped empty district ground,
   * and where to draw it -- pixels inside .sa-field, which is the same box
   * the scene reported the tap in.
   */
  const [radial, setRadial] = useState<{ zone: ZoneId; at: TapPoint } | null>(null);
  /**
   * Where the finger that started the request in flight landed, so the reward
   * floats out of the thing that was tapped rather than out of the middle of
   * the screen. A ref, not state: nothing renders from it, and it must not be
   * a frame behind the response that reads it.
   */
  const tapAnchor = useRef<TapPoint | null>(null);
  // Which unit is mid-"are you sure" for retiring. Never a plain confirm():
  // retiring refunds nothing, so it has to be two deliberate taps.
  const [retiringUnitId, setRetiringUnitId] = useState<string | null>(null);
  useEffect(() => () => { mounted.current = false; }, []);

  /**
   * The purse every price on this screen is read against. One currency now, so
   * this is simply the player's Gold -- the same balance the poker tables and
   * the Collection spend.
   *
   * An admin account with unlimited Gold is treated as able to afford
   * anything: the server is the authority on the spend either way, and a
   * button greyed out against a balance that is not real would be a lie.
   */
  const gold = profile?.unlimitedGold
    ? Number.MAX_SAFE_INTEGER
    : (profile?.goldBalance ?? 0);

  const applyResponse = useCallback((data: Partial<StackAcresResponse>) => {
    if (data.profile) setProfile(data.profile);
    if (data.units) setUnits(data.units);
    if (typeof data.feed === "number") setFeed(data.feed);
    if (data.capacity) setCapacity(data.capacity);
    if (data.exchange) setExchange(data.exchange);
    if (data.upkeep) setUpkeep(data.upkeep);
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
          // A refusal carries the true round; paint it, and only raise a
          // banner when there is no round to speak for itself.
          if (data.round) setUnits(data.round);
          if (data.profile) setProfile(data.profile);
          if (!data.round) setError(data.error ?? "That did not go through.");
          // A harvest refused by the daily ceiling disagrees with the client
          // about how much of today's allowance is left. Re-read it once this
          // request has let go of the send lock, so the meter shows the truth
          // rather than the amount this browser thought it could still send.
          if (body.action === "collect") window.setTimeout(() => void refresh(), 0);
          return;
        }
        applyResponse(data);
        // Where the finger that asked for this landed, if it was a tap on the
        // map rather than a sidebar row -- the reward floats out of the thing
        // that was tapped. A sidebar press leaves this null and the toast
        // below is the whole answer, same as it always was.
        const anchor = tapAnchor.current;
        if (body.action === "collect" && data.harvest) {
          const { harvest } = data;
          play("ui");
          const single = body.unitIds?.length === 1 ? body.unitIds[0] : null;
          if (single) setCelebrate({ unitId: single, nonce: Date.now() });
          // The toast leads with the money, because that is what a harvest is
          // now -- the produce is the reason, not the reward. The synergy gets
          // its own clause only when one actually applied.
          const bonusPart = harvest.bounty.label
            ? ` · ${harvest.bounty.label} +${harvest.bonus.toLocaleString()}`
            : "";
          const upkeepPart = harvest.upkeep > 0
            ? ` · upkeep -${harvest.upkeep.toLocaleString()}`
            : "";
          setLastCollect({
            text: `+${harvest.gold.toLocaleString()} Gold${bonusPart}${upkeepPart}`,
            nonce: Date.now(),
          });
          if (anchor) {
            // A one-unit sweep floats its produce, which is what a tap on that
            // animal was asking about. A whole-farm sweep floats the money:
            // naming five kinds of produce over one thumb is unreadable.
            const float =
              single && harvest.tally.length === 1
                ? collectFloat(harvest.tally[0].item, harvest.tally[0].quantity)
                : { text: `+${harvest.gold.toLocaleString()} Gold`, icon: "ico-gold" };
            world.current?.floatAt(anchor, float.text, "gain", float.icon as PainterName);
          }
          if (harvest.mucked > 0) {
            setError(
              harvest.mucked === 1
                ? "That came up weather-worn. Clear it before it earns again."
                : `${harvest.mucked} came up weather-worn. Clear them before they earn again.`,
            );
          }
        }
        // The other three a finger can start from the map. No produce to
        // name, so the float just confirms the verb landed.
        const done =
          body.action === "feed"
            ? "Fed"
            : body.action === "clear"
              ? "Cleared"
              : body.action === "stock"
                ? "Seeded"
                : null;
        if (anchor && done) world.current?.floatAt(anchor, done, "gain");
      } catch {
        if (mounted.current) setError("Could not reach the farm. Check your connection.");
      } finally {
        sending.current = false;
        // One request, one anchor. Leaving it set would float the NEXT
        // action's reward out of the last place a finger happened to be.
        tapAnchor.current = null;
        if (mounted.current) {
          setBusy(false);
          setBusyUnitId(null);
        }
      }
    },
    [applyResponse, play, refresh],
  );

  // No effect needed to disarm the retire confirmation on district change:
  // StackAcresUnitRows only ever renders the current district's own units
  // (districtUnits, below), so a unit armed elsewhere simply has no row left
  // to show the confirmation on until the player travels back to it.
  const onCollect = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      tapSound();
      void act({ action: "collect", unitIds: [unit.id] });
    },
    [act],
  );

  /**
   * Bring in everything that is ready, in one act. This is the only button
   * that can earn a Bountiful Harvest: the synergy is a property of what was
   * gathered TOGETHER, so a unit tapped on its own can never qualify.
   */
  const onHarvestAll = useCallback(() => {
    tapSound();
    void act({ action: "collect" });
  }, [act]);
  const onFeed = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      tapSound();
      void act({ action: "feed", unitId: unit.id });
    },
    [act],
  );
  const onClear = useCallback(
    (unit: StackAcresUnitSnapshot) => {
      tapSound();
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
      setRetiringUnitId(null);
      void act({ action: "retire", unitId: unit.id });
    },
    [act],
  );

  const onSeed = useCallback(
    (stock: StackAcresStock) => {
      tapSound();
      void act({ action: "stock", stock });
    },
    [act],
  );
  const onBuyOutright = useCallback(
    (stock: StackAcresStock) => {
      tapSound();
      void act({ action: "buy-stock", stock });
    },
    [act],
  );
  const onExpand = useCallback(
    (stock: StackAcresStock) => {
      tapSound();
      void act({ action: "expand-capacity", stock });
    },
    [act],
  );

  const pickTool = useCallback((next: StackAcresTool) => {
    tapSound();
    setTool(next);
    setError(null);
  }, []);

  const travel = useCallback((zone: ZoneId) => {
    tapSound();
    setPlace(zone);
    world.current?.focusZone(zone);
  }, []);

  const closeRadial = useCallback(() => setRadial(null), []);

  /**
   * A finger landed on a unit's own picture. It pops immediately -- before
   * anything has been sent, which is the whole point: the farm answers the
   * touch, and the network answers a moment later. What happens next is
   * `tapActionFor`'s call, off the same `unitRowAction` the sidebar's rows
   * read, so the map and the list can never disagree.
   *
   * A refusal never leaves the browser. There is no room on a canvas for a
   * disabled button with a title attribute explaining itself, so the reason
   * floats where the finger was instead.
   */
  const onWorldUnitTap = useCallback(
    (unitId: string, at: TapPoint) => {
      setRadial(null);
      const unit = liveUnits.find((candidate) => candidate.id === unitId);
      if (!unit) return;
      world.current?.popUnit(unitId);
      // The sidebar follows the finger rather than gating it: whatever the
      // player is touching is what "here" means now.
      setPlace(stockZone(unit.stock));
      const action = tapActionFor(unit, { feed, gold, nowMs });
      if (action.kind === "refused") {
        world.current?.floatAt(at, action.reason, "deny");
        return;
      }
      if (busy) return;
      tapSound();
      tapAnchor.current = at;
      // A tap is a one-unit sweep. It earns no synergy by construction --
      // three is the fewest a Bountiful Harvest considers -- which is exactly
      // what the Harvest button beside it is for.
      void act(
        action.kind === "collect" ? { action: "collect", unitIds: [unitId] } : { action: action.kind, unitId },
      );
    },
    [act, busy, feed, gold, liveUnits, nowMs],
  );

  /** A finger landed on a district's fenced ground and hit nothing. That is
   *  "I want something HERE", answered where the finger is. */
  const onWorldGroundTap = useCallback((zone: ZoneId, at: TapPoint) => {
    tapSound();
    setPlace(zone);
    setRadial({ zone, at });
  }, []);

  /** Seeding straight out of the radial menu. Closes first: the menu's
   *  prices are about to move under it, and a second tap on a stale one
   *  would be a purchase the player did not read. */
  const onRadialSeed = useCallback(
    (stock: StackAcresStock) => {
      const at = radial?.at ?? null;
      setRadial(null);
      tapSound();
      tapAnchor.current = at;
      void act({ action: "stock", stock });
    },
    [act, radial],
  );

  /** The ring's own way through to the deep end -- the same drawer the peg on
   *  the right edge opens, reached without having to go and find the peg. */
  const openPanel = useCallback(() => {
    tapSound();
    setRadial(null);
    setPanelOpen(true);
  }, []);

  const districtUnits = useMemo(
    () => liveUnits.filter((unit) => stockZone(unit.stock) === place),
    [liveUnits, place],
  );
  const buyOptions: BuyOption[] = useMemo(
    () => buyOptionsForZone(place, { units: liveUnits, gold, capacity }),
    [place, liveUnits, gold, capacity],
  );

  const toolHint = STACKACRES_TOOL_DEFS[tool].hint;

  /** Everything standing ready right now. The Harvest button's whole subject. */
  const readyUnits = useMemo(
    () => liveUnits.filter((unit) => unit.state === "ready"),
    [liveUnits],
  );
  const carrying = readyUnits.length;

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
        {/* One purse now. The farm's own currency is gone, so the Gold pill
            the rest of the app already shows is the whole story here, and it
            keeps its usual place at the end of the row. */}
        <div className="sa-hud">
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
              onUnitTap={onWorldUnitTap}
              onGroundTap={onWorldGroundTap}
              onViewMoved={closeRadial}
              api={world}
            />
          )}
          {(!loaded || !worldReady) && (
            <p className="sa-hint sa-loading">Walking the fences…</p>
          )}

          {/* The seed menu's dismissal layer, and its position in this file is
              the whole design: it covers the map but sits EARLIER than the
              toolbelt, the signpost and the camera buttons, which are
              positioned siblings with no z-index of their own and therefore
              stack above it. So the next tap on the world closes the menu,
              and the chrome stays live while it is open. */}
          {radial && (
            <button
              type="button"
              className="sa-radial-scrim"
              aria-label="Close the seed menu"
              onClick={closeRadial}
            />
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
            onOpenStore={() => { tapSound(); setShowStore(true); }}
            carrying={carrying}
          />

          <div className="sa-camera" role="group" aria-label="Map view">
            <button type="button" className="sa-camera-btn" aria-label="Zoom in" onClick={() => world.current?.zoomBy(1.3)}>
              <ZoomIn size={16} aria-hidden="true" />
            </button>
            <button type="button" className="sa-camera-btn" aria-label="Zoom out" onClick={() => world.current?.zoomBy(1 / 1.3)}>
              <ZoomOut size={16} aria-hidden="true" />
            </button>
            <button type="button" className="sa-camera-btn" aria-label="Back to the farm" onClick={() => { setPlace("farmstead"); setRadial(null); world.current?.recenter(); }}>
              <LocateFixed size={16} aria-hidden="true" />
            </button>
          </div>

          {/* The seed menu, on the canvas next to the finger that asked for
              it. Rendered after the camera controls so it stacks over them,
              and inside .sa-field so its coordinates are the ones the scene
              reported the tap in. */}
          {radial && (
            <StackAcresRadialMenu
              at={radial.at}
              options={buyOptionsForZone(radial.zone, { units: liveUnits, gold, capacity })}
              districtLabel={STACKACRES_ZONES[radial.zone].label}
              busy={busy}
              onSeed={onRadialSeed}
              onClose={closeRadial}
              onManage={openPanel}
            />
          )}

          <p className={clsx("sa-tool-hint", { "is-busy": busy })} aria-live="polite">
            {hint}
          </p>

          <div className="sa-side">
            {error && <p className="duel-error" role="alert">{error}</p>}
          </div>

          {/* Bring the whole farm in at once.
              THIS IS THE ONLY BUTTON THAT CAN EARN A SYNERGY, and that is why
              it exists as its own affordance rather than being implied by
              tapping units one at a time: Bountiful Harvest is a property of
              what was gathered TOGETHER, so a farm collected a tap at a time
              earns nothing. It only appears when there is something to bring
              in -- a permanently-visible disabled button on a canvas is chrome
              a player learns to stop reading. */}
          {carrying > 0 && (
            <button
              type="button"
              className="sa-harvest-all"
              disabled={busy}
              onClick={onHarvestAll}
            >
              <StackAcresIcon name="ico-harvest" size={18} />
              <span>
                Harvest {carrying} {carrying === 1 ? "field" : "fields"}
              </span>
            </button>
          )}

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
            onClick={() => { tapSound(); setPanelOpen(true); }}
            tabIndex={panelOpen ? -1 : undefined}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span className="sa-panel-tab-label">{district.label.replace(/^The /, "")}</span>
          </button>

          {/* The district panel: deep management, not the way you play.
              The fast loop is on the canvas now -- tap a ripe crop to collect
              it, tap empty ground to seed it -- so this no longer opens itself
              when a player travels somewhere. The peg above is how it comes
              back, and it holds what a tap has no business doing: Gold spends,
              and the full standing list. That list is also the keyboard and
              screen-reader path to every canvas tap, which is why it is still
              here rather than deleted along with the loop it used to be. */}
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
                onClick={() => { tapSound(); setPanelOpen(false); }}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <h2 className="sa-district-title">{district.label}</h2>
            <p className="sa-district-blurb">{district.blurb}</p>

            {/* Buy comes first now. Seeding one cycle is the one thing on
                this panel a tap on the map also does; buying outright and
                expanding capacity are Gold, are permanent, and are the reason
                to open this at all -- so they lead, rather than sitting under
                a list of things you could have collected by touching them. */}
            <div className="sa-panel-section">
              <h3 className="sa-group-label">Buy &amp; expand</h3>
              <StackAcresBuySection
                options={buyOptions}
                busy={busy}
                onSeed={onSeed}
                onBuyOutright={onBuyOutright}
                onExpand={onExpand}
              />
            </div>

            <div className="sa-panel-section">
              <h3 className="sa-group-label">What&apos;s here</h3>
              <p className="sa-panel-note">
                Tap anything on the map to collect, feed or clear it. These rows do the same, and
                are how you retire something you own outright.
              </p>
              <StackAcresUnitRows
                units={districtUnits}
                nowMs={nowMs}
                feed={feed}
                gold={gold}
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
                onClick={() => { tapSound(); setShowStore(false); }}
              >
                Done
              </button>
            </header>

            {/* The page's own banner sits behind the scrim, so a refusal raised
                by a button in here has to be answered in here. */}
            {error && <p className="duel-error" role="alert">{error}</p>}

            {/* What the day has left comes first. It is the only number in
                here a player has to plan around: the farm can send out the
                same Gold whatever it owns, so a full bar is the reason to go
                and harvest and an empty one is the reason to stop. */}
            <StoreShelf icon="ico-gold">Today&apos;s allowance</StoreShelf>
            <div className="sa-exchange">
              <p className="sa-sheet-note">
                Bringing in a harvest pays Gold on the spot. Every farm can send out the same{" "}
                {exchange.ceiling.toLocaleString()} Gold a day, whatever it owns — more stock fills
                the day faster, it never makes the day bigger.
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
              {exchange.remaining < 1 && (
                <p className="sa-sheet-note">
                  That is everything this farm can send out today. Anything still standing keeps
                  until the day turns over, in {countdownLabel(Date.parse(exchange.resetsAt) - nowMs)}.
                </p>
              )}
            </div>

            <StoreShelf icon="ico-harvest">Land maintenance</StoreShelf>
            <p className="sa-sheet-note">
              Holding land costs <strong>{upkeep.fee.toLocaleString()} Gold</strong> a day across{" "}
              {upkeep.units} {upkeep.units === 1 ? "field or pen" : "fields and pens"}. It is taken
              out of what you harvest, never out of your balance, and it climbs faster than the land
              earns — a big estate keeps less of every extra field than a small one does.
            </p>
            <p className="sa-sheet-note">
              {upkeep.due > 0 ? (
                <>
                  Today has <strong>{upkeep.due.toLocaleString()} Gold</strong> still to pay. Your
                  next harvest covers what it can.
                </>
              ) : (
                <>Today is paid up.</>
              )}
            </p>

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
                    {item.cost.toLocaleString()} Gold{" "}
                    <span>({Math.round(item.cost / item.servings)} each)</span>
                  </p>
                  <button
                    type="button"
                    className="sa-cta"
                    disabled={busy || gold < item.cost}
                    onClick={() => void act({ action: "buy-feed", itemId: id })}
                  >
                    Buy
                  </button>
                </div>
              ))}
            </div>
            <p className="sa-sheet-note">
              You have <strong>{feed}</strong> {feed === 1 ? "serving" : "servings"} in the barn.
            </p>

          </div>
        </div>
      )}

      {showHelp && (
        <HowToPlayModal title="StackAcres" onClose={() => setShowHelp(false)}>
          <p>
            The farm is a map of four districts. Drag to look around, pinch or scroll to zoom, or
            tap a district&apos;s name to travel straight to it.
          </p>
          <p>
            <strong>Everything is tapped on the map itself.</strong> Tap a crop or an animal to
            collect it when it is ready, feed it when it is hungry, or clear it when it comes up
            weather-worn. Tap the bare ground inside a district and a small menu opens right there
            to seed something new.
          </p>
          <p>
            The handle on the right edge opens that district&apos;s panel, which is where Gold buys
            stock outright and buys more room to keep at once. Close it and it folds back to the
            handle without moving the camera.
          </p>
          <p>
            <strong>Everything is paid in Gold, in one step.</strong> Bringing in a harvest works
            out what the produce is worth and puts the Gold straight in your balance — there is no
            second currency, no barn to empty and nothing to queue for. Gold also buys your seed,
            your feed, stock outright, and more room to keep at once.
          </p>
          <p>
            Bringing several fields in <em>together</em> can earn a <strong>Bountiful Harvest</strong>.
            Three or more of the same kind is <strong>Mono-cropping</strong>; a balanced mix of
            things grown and things an animal made is <strong>Crop Rotation</strong>. Either
            multiplies what the whole harvest pays, so the Harvest button is worth more than
            tapping each field on its own.
          </p>
          <p>
            Holding land costs a daily <strong>Land Maintenance</strong> fee, taken out of what you
            harvest rather than out of your balance. It climbs faster than the land earns, so a
            sprawling estate keeps less of each extra field than a small one does.
          </p>
          <p>
            Every farm can send out the same {exchange.ceiling.toLocaleString()} Gold a day, whatever
            it owns — owning more reaches that sooner, it never gets more than that. Anything still
            standing keeps until tomorrow.
          </p>
          <ul>
            <li>Seed a crop or stock a pen with Gold, then come back when it turns gold.</li>
            <li>Crops look after themselves. Animals need feeding, and stop working when hungry.</li>
            <li>Nothing here can die and nothing can be lost. Neglect costs you time, not produce.</li>
            <li>
              Each kind of animal or crop can have three going at once, more if you spend Gold to
              expand it — one kind&apos;s room has nothing to do with any other&apos;s.
            </li>
            <li>
              Something finished sometimes comes up weather-worn and needs clearing, in Gold,
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
