/**
 * Standalone entry for the published simulation artifact.
 *
 * Bundled by esbuild into one inline script (three + React + the scene),
 * because the artifact page's CSP allows no external hosts. Reuses the
 * exact modules the app uses — scripted hand, scene-model derivation,
 * PokerScene, ActionHud, SeatNameplates — with no Next.js imports
 * (next/dynamic is a server-bundle concern; here everything is client by
 * construction).
 *
 * Two layers of control sit around the scripted hand:
 *
 * - VIEWPORT PRESETS letterbox the whole simulation into a device-sized
 *   stage (scaled to fit the window, CSS-transform only, so the canvas
 *   still renders at the preset's true aspect and the camera solves the
 *   framing that device would actually get).
 *
 * - DIRECTOR OVERLAYS repaint the *current* snapshot — everyone folds, the
 *   table bets, the hero wins, the seats recast — then hand the stage back
 *   to the script after a few seconds. They go through the same
 *   `GameSnapshot` wire shape as everything else, which is the point: the
 *   demo can only show states the real API could produce.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
// Side-effect import: inlines the six seat renders as data URIs, because
// the artifact CSP allows no fetches. Must precede the scene.
import "@/components/game3d/demo/artifact-sprites";
import type { GameSnapshot } from "@/lib/game/types";
import { deriveSceneModel } from "@/lib/game3d/scene-model";
import { PokerScene } from "@/components/game3d/scene/poker-scene";
import { ActionHud } from "@/components/game3d/hud/action-hud";
import { SeatNameplates } from "@/components/game3d/hud/seat-nameplates";
import { BoardCards } from "@/components/game3d/hud/board-cards";
import {
  openingSteps,
  type DemoAction,
  type DemoStep,
} from "@/components/game3d/demo/scripted-hand";
import styles from "@/components/game3d/game3d.module.css";

/* ------------------------------------------------------------------ */
/* Viewport presets                                                    */
/* ------------------------------------------------------------------ */

const VIEWPORTS = [
  { key: "fill", label: "Fill window", width: 0, height: 0 },
  { key: "desktop", label: "1440 × 900", width: 1440, height: 900 },
  { key: "phone-l", label: "844 × 390", width: 844, height: 390 },
  { key: "phone-p", label: "390 × 844", width: 390, height: 844 },
  { key: "laptop", label: "1280 × 800", width: 1280, height: 800 },
] as const;

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/* ------------------------------------------------------------------ */
/* Director overlays                                                   */
/* ------------------------------------------------------------------ */

type OverlayKey = "none" | "fold" | "bet" | "win";

const OVERLAY_HOLD_MS = 5000;

/** Alternates for the recast button: name plus a different equipped
 * character, so a recast visibly re-seats the whole table. (The seats
 * render the stylized 3D bust now — no artwork travels with the page —
 * but the cosmetic id still rides the snapshot like the real wire.) */
const RECAST_POOL = [
  { name: "Marisol", art: "avatar-ace" },
  { name: "Dmitri", art: "avatar-crusher" },
  { name: "Big Tony", art: "avatar-veteran" },
  { name: "Priya", art: "avatar-rounder" },
  { name: "Santos", art: "avatar-host" },
  { name: "Yuki", art: "avatar-prospect" },
  { name: "Nadia", art: "avatar-nightowl" },
  { name: "Kenji", art: "avatar-shark" },
  { name: "Rosa", art: "avatar-maniac" },
  { name: "Elder Vasquez", art: "avatar-highroller" },
];

/**
 * Repaint the shown snapshot with the requested overlay. Pure, and always a
 * structurally valid GameSnapshot: chip sums stay honest (the bet overlay
 * pays its bets into the pot), because the scene asserts felt-sums-to-pot.
 */
function directedSnapshot(
  base: GameSnapshot,
  overlay: OverlayKey,
  recast: number
): GameSnapshot {
  let snapshot = base;

  if (recast > 0) {
    snapshot = {
      ...snapshot,
      seats: snapshot.seats.map((seat, index) => {
        if (index === 0) return seat;
        const cast = RECAST_POOL[(index - 1 + recast) % RECAST_POOL.length];
        return { ...seat, name: cast.name, avatarCosmetic: cast.art };
      }),
    };
  }

  if (overlay === "fold") {
    return {
      ...snapshot,
      version: snapshot.version + 9100,
      currentPlayer: null,
      legalActions: null,
      message: "The table folds back into the dark.",
      seats: snapshot.seats.map((seat, index) =>
        index === 0
          ? { ...seat, isCurrent: false }
          : { ...seat, status: "folded", streetBet: 0, isCurrent: false }
      ),
    };
  }

  if (overlay === "bet") {
    let added = 0;
    const seats = snapshot.seats.map((seat) => {
      if (seat.status === "folded" || seat.status === "out") return seat;
      // Top a smaller bet up to 40; never repaint a larger one down.
      const wager = Math.max(seat.streetBet, 40);
      const put = wager - seat.streetBet;
      added += put;
      return {
        ...seat,
        streetBet: wager,
        stack: Math.max(0, seat.stack - put),
        isCurrent: false,
      };
    });
    return {
      ...snapshot,
      version: snapshot.version + 9200,
      currentPlayer: null,
      legalActions: null,
      pot: snapshot.pot + added,
      message: "Everyone commits — leaning into the light.",
      seats,
    };
  }

  if (overlay === "win") {
    const hero = snapshot.seats[0];
    return {
      ...snapshot,
      version: snapshot.version + 9300,
      status: "complete",
      currentPlayer: null,
      legalActions: null,
      message: hero.name === "You" ? "You take it down." : `${hero.name} takes it down.`,
      winners: [
        {
          seatId: hero.id,
          name: hero.name,
          amount: snapshot.pot,
          hand: "Two Pair, Aces and Kings",
          bestFive: null,
        },
      ],
      seats: snapshot.seats.map((seat, index) =>
        index === 0 ? { ...seat, isCurrent: false } : seat
      ),
    };
  }

  return snapshot;
}

/* ------------------------------------------------------------------ */

function App() {
  const [queue, setQueue] = useState<DemoStep[]>(() => openingSteps(1));
  const [index, setIndex] = useState(0);
  const handRef = useRef(1);

  const [viewportIndex, setViewportIndex] = useState(0);
  const [overlay, setOverlay] = useState<OverlayKey>("none");
  const [recast, setRecast] = useState(0);
  const windowSize = useWindowSize();

  const step: DemoStep | undefined = queue[index];

  useEffect(() => {
    if (!step) {
      handRef.current += 1;
      setQueue(openingSteps(handRef.current));
      setIndex(0);
      return;
    }
    if (step.next) return; // holding for the player's decision
    const timer = setTimeout(() => setIndex((i) => i + 1), step.holdMs);
    return () => clearTimeout(timer);
  }, [step]);

  // An overlay is a beat, not a mode: it plays, then the script resumes.
  useEffect(() => {
    if (overlay === "none") return;
    const timer = setTimeout(() => setOverlay("none"), OVERLAY_HOLD_MS);
    return () => clearTimeout(timer);
  }, [overlay]);

  const act = (action: DemoAction) => {
    const current = queue[index];
    if (!current?.next) return;
    const continuation = current.next(action);
    setQueue([...queue.slice(0, index + 1), ...continuation]);
    setIndex(index + 1);
  };

  // Keep showing the last step while the next hand swaps in — a null frame
  // would tear down and rebuild the WebGL context every hand.
  const shown = step ?? queue[queue.length - 1];
  const snapshot = useMemo(
    () => directedSnapshot(shown.snapshot, overlay, recast),
    [shown.snapshot, overlay, recast]
  );
  const model = useMemo(() => deriveSceneModel(snapshot), [snapshot]);

  const viewport = VIEWPORTS[viewportIndex];
  const framed = viewport.width > 0;
  const stageWidth = framed ? viewport.width : windowSize.width;
  const stageHeight = framed ? viewport.height : windowSize.height;
  const scale = framed
    ? Math.min(
        1,
        (windowSize.width - 32) / stageWidth,
        (windowSize.height - 32) / stageHeight
      )
    : 1;
  const aspect = stageHeight > 0 ? stageWidth / stageHeight : 1;

  return (
    <div className={styles.frameViewport}>
      <div
        className={framed ? `${styles.stage} ${styles.stageFramed}` : styles.stage}
        style={{
          width: stageWidth,
          height: stageHeight,
          minHeight: 0,
          transform: scale < 1 ? `scale(${scale})` : undefined,
        }}
      >
        {/* Keyed per preset: switching viewports boots a fresh WebGL room at
            the new size — the same cold-start a real device gives it — after
            live-resizing the context through a preset switch was observed to
            latch a dimmed frame under software GL. A window resize (no key
            change) still resizes the live context, which is unaffected. */}
        <PokerScene key={viewport.key} model={model} />
        <BoardCards cards={model.community} width={stageWidth} height={stageHeight} />
        <SeatNameplates model={model} aspect={aspect} />
        <header className="sim-brand">
          <span className="sim-eyebrow">StackChips · 3D studio experiment</span>
          <span className="sim-note">
            Scripted six-max hand under the studio light, looping. Your
            seat&rsquo;s call is real — Fold, Call and Raise branch the hand.
          </span>
        </header>
        <ActionHud
          pot={snapshot.pot}
          message={snapshot.message}
          legalActions={snapshot.legalActions}
          onFold={() => act("fold")}
          onCall={() => act("call")}
          onRaise={() => act("raise")}
        />
      </div>

      <div className={styles.controlDock}>
        <div className={styles.tray}>
          <span className={styles.trayLabel}>Viewport</span>
          <div className={styles.trayRow}>
            {VIEWPORTS.map((preset, i) => (
              <button
                key={preset.key}
                type="button"
                className={
                  i === viewportIndex
                    ? `${styles.trayButton} ${styles.trayButtonActive}`
                    : styles.trayButton
                }
                onClick={() => setViewportIndex(i)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {framed && scale < 1 ? (
            <span className={styles.trayCaption}>
              rendered at {stageWidth}×{stageHeight}, shown at {Math.round(scale * 100)}%
            </span>
          ) : null}
        </div>
        <div className={styles.tray}>
          <span className={styles.trayLabel}>Director</span>
          <div className={styles.trayRow}>
            <button
              type="button"
              className={
                overlay === "fold"
                  ? `${styles.trayButton} ${styles.trayButtonActive}`
                  : styles.trayButton
              }
              onClick={() => setOverlay(overlay === "fold" ? "none" : "fold")}
            >
              Everyone folds
            </button>
            <button
              type="button"
              className={
                overlay === "bet"
                  ? `${styles.trayButton} ${styles.trayButtonActive}`
                  : styles.trayButton
              }
              onClick={() => setOverlay(overlay === "bet" ? "none" : "bet")}
            >
              Table bets
            </button>
            <button
              type="button"
              className={
                overlay === "win"
                  ? `${styles.trayButton} ${styles.trayButtonActive}`
                  : styles.trayButton
              }
              onClick={() => setOverlay(overlay === "win" ? "none" : "win")}
            >
              Hero wins
            </button>
            <button
              type="button"
              className={styles.trayButton}
              onClick={() => setRecast((n) => n + 1)}
            >
              Recast seats
            </button>
          </div>
          <span className={styles.trayCaption}>
            scene beats play ~5s, then the hand resumes
          </span>
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
