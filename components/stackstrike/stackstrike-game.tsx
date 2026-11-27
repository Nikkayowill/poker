"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from "@/lib/stackstrike/content";
import { loadProgress, NEW_PROGRESS, rankFor, unlocksBetween, type Progress } from "@/lib/stackstrike/progress";
import type { DifficultyId } from "@/lib/stackstrike/types";
import type { Insets, StackStrikeScene } from "./stackstrike-scene";

/**
 * Mounts StackStrike full screen. It is a phone game played sideways, so:
 *
 * - A start screen comes first, where the player picks a difficulty. On a
 *   touch device its button is the user gesture browsers require before they
 *   will go fullscreen and lock the screen to landscape. Where locking is not
 *   possible (iPhone Safari), the game pauses behind a "rotate your phone"
 *   screen while held upright.
 * - The canvas is drawn at the device's pixel ratio (capped) so shapes are
 *   sharp on a phone, and the scene is told the safe-area insets so the HUD
 *   keeps clear of a notch.
 *
 * Phaser and the scene are imported at runtime so none of it lands in any
 * other page's bundle.
 */

const MAX_PIXEL_RATIO = 2;

const DIFFICULTY_KEY = "stackstrike:difficulty";
const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as DifficultyId[];
const MUTE_KEY = "stackstrike:muted";

/** Whether sound was turned off last time, if the browser lets us remember. */
function rememberedMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The last difficulty picked, if the browser lets us remember it. A convenience only. */
function rememberedDifficulty(): DifficultyId {
  try {
    const saved = window.localStorage.getItem(DIFFICULTY_KEY);
    if (saved && (DIFFICULTY_IDS as string[]).includes(saved)) return saved as DifficultyId;
  } catch {
    // Storage can be blocked; the default is fine.
  }
  return DEFAULT_DIFFICULTY;
}

function pixelRatio(): number {
  return Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
}

/** A media query as live state. null on the server, where there is no screen to ask. */
function useMedia(query: string): boolean | null {
  return useSyncExternalStore<boolean | null>(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}

/** Not every browser's TypeScript lib knows `lock`, and many browsers refuse it; both are fine. */
function lockLandscape(): void {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> };
  try {
    void orientation.lock?.("landscape").catch(() => {});
  } catch {
    // Unsupported (iPhone Safari): the rotate screen covers it instead.
  }
}

const PAGE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "#000",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  overscrollBehavior: "none",
  fontFamily: "system-ui, sans-serif",
};

const COVER: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 5,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 14,
  padding: "16px 24px",
  textAlign: "center",
  color: "#e6edf3",
  background: "#050506",
};

export function StackStrikeGame() {
  const pageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StackStrikeScene | null>(null);
  const heldUpright = useRef(false);

  // null until we are on the client and can ask the screen.
  const touch = useMedia("(pointer: coarse)");
  const portrait = useMedia("(orientation: portrait)") === true;
  const [begun, setBegun] = useState(false);
  // The start screen only shows once the client has asked the screen (touch is null until then),
  // so reading storage here cannot disagree with the server's markup.
  const [difficulty, setDifficulty] = useState<DifficultyId>(() =>
    typeof window === "undefined" ? DEFAULT_DIFFICULTY : rememberedDifficulty(),
  );
  const started = begun;
  // Only shown once play has started, which is on the client, so reading storage here is safe.
  const [muted, setMuted] = useState<boolean>(() => (typeof window === "undefined" ? false : rememberedMuted()));
  const mutedRef = useRef(muted);
  // Read on the client only; the title screen does not render until the screen has been asked.
  const [progress] = useState<Progress>(() => (typeof window === "undefined" ? NEW_PROGRESS : loadProgress()));

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overscrollBehavior;
    root.style.overscrollBehavior = "none";
    return () => {
      root.style.overscrollBehavior = previous;
      try {
        screen.orientation?.unlock?.();
        if (document.fullscreenElement) void document.exitFullscreen();
      } catch {
        // Not all browsers allow it; nothing to undo then.
      }
    };
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    sceneRef.current?.setMuted(muted);
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Not remembered; nothing is lost.
    }
  }, [muted]);

  const uprightPhone = touch === true && portrait;

  useEffect(() => {
    heldUpright.current = uprightPhone;
    sceneRef.current?.setPaused(uprightPhone);
  }, [uprightPhone]);

  useEffect(() => {
    const host = hostRef.current;
    if (touch === null || !started || !host) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let game: { destroy: (removeCanvas: boolean) => void } | null = null;

    const readInsets = (): Insets => {
      const probe = probeRef.current;
      if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
      const style = getComputedStyle(probe);
      return {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
      };
    };

    void (async () => {
      const [Phaser, { StackStrikeScene: SceneClass }] = await Promise.all([
        import("phaser"),
        import("./stackstrike-scene"),
      ]);
      if (cancelled) return;

      const scene = new SceneClass({ touch, difficulty, pixelRatio, insets: readInsets });
      sceneRef.current = scene;
      scene.setPaused(heldUpright.current);
      scene.setMuted(mutedRef.current);

      const size = () => {
        const ratio = pixelRatio();
        return {
          width: Math.max(16, Math.floor(host.clientWidth * ratio)),
          height: Math.max(16, Math.floor(host.clientHeight * ratio)),
        };
      };
      const first = size();
      const instance = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        backgroundColor: "#000000",
        // Drawn at device resolution; the canvas is then stretched back to the host in CSS.
        scale: { mode: Phaser.Scale.NONE, width: first.width, height: first.height },
        scene,
      });
      game = instance;

      const fit = () => {
        const canvas = instance.canvas;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        instance.scale.updateBounds();
      };
      fit();
      instance.scale.on("resize", fit);

      observer = new ResizeObserver(() => {
        const next = size();
        instance.scale.resize(next.width, next.height);
        fit();
      });
      observer.observe(host);
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      game?.destroy(true);
      game = null;
      sceneRef.current = null;
    };
    // The difficulty is fixed once play starts, so it is not a reason to rebuild the game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch, started]);

  const begin = () => {
    try {
      window.localStorage.setItem(DIFFICULTY_KEY, difficulty);
    } catch {
      // Not remembered; nothing is lost.
    }
    // A desktop has nothing to unlock. A phone goes fullscreen and locks to landscape.
    if (touch) {
      const page = pageRef.current;
      try {
        if (page?.requestFullscreen) void page.requestFullscreen({ navigationUI: "hide" }).then(lockLandscape, lockLandscape);
        else lockLandscape();
      } catch {
        lockLandscape();
      }
    }
    setBegun(true);
  };

  return (
    <div ref={pageRef} style={PAGE}>
      <div ref={hostRef} data-testid="stackstrike-host" style={{ position: "absolute", inset: 0 }} />

      {/* Zero-size probe: its padding is the device's safe-area insets, which the scene reads. */}
      <div
        ref={probeRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          paddingTop: "env(safe-area-inset-top)",
          paddingRight: "env(safe-area-inset-right)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
        }}
      />

      {started && (
        <Link
          href="/"
          style={{
            position: "absolute",
            left: "50%",
            top: "calc(8px + env(safe-area-inset-top))",
            transform: "translateX(-50%)",
            zIndex: 2,
            color: "#7d8591",
            font: "600 12px system-ui, sans-serif",
            textDecoration: "none",
            padding: "6px 10px",
          }}
        >
          ← Exit
        </Link>
      )}

      {started && (
        <button
          type="button"
          data-testid="stackstrike-sound"
          aria-pressed={!muted}
          onClick={() => setMuted((value) => !value)}
          style={{
            position: "absolute",
            left: "calc(50% + 46px)",
            top: "calc(8px + env(safe-area-inset-top))",
            zIndex: 2,
            background: "none",
            border: 0,
            color: muted ? "#5b626d" : "#7d8591",
            font: "600 12px system-ui, sans-serif",
            padding: "6px 10px",
            cursor: "pointer",
          }}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
      )}

      {touch !== null && !started && (
        <TitleScreen
          touch={touch}
          difficulty={difficulty}
          progress={progress}
          onDifficulty={setDifficulty}
          onPlay={begin}
        />
      )}

      {uprightPhone && (
        <div data-testid="stackstrike-rotate" style={{ ...COVER, zIndex: 10 }}>
          <div style={{ fontSize: 46, transform: "rotate(90deg)" }}>📱</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Turn your phone sideways</div>
          <div style={{ fontSize: 13, color: "#9aa3af" }}>StackDead plays in landscape.</div>
        </div>
      )}
    </div>
  );
}

const HOW_TO_TOUCH = [
  "Left thumb moves.",
  "Right thumb: drag to aim the red laser, let go to fire. Slide back to the middle first to cancel.",
  "Zombies come in waves, and every wave is bigger. Kill them for XP: each level, pick one of three cards.",
  "Walk over pickups. Green heals, orange is a bomb that clears the screen, yellow doubles your fire rate.",
  "Keep killing to build a streak and a bigger score. Rank carries over between runs and unlocks guns.",
];
const HOW_TO_DESKTOP = [
  "WASD moves, the mouse aims the red laser, click fires, R reloads, 1-3 or the wheel swaps guns.",
  "Zombies come in waves, and every wave is bigger. Kill them for XP: each level, pick one of three cards (1-3, R to redraw, X to skip).",
  "Walk over pickups. Green heals, orange is a bomb that clears the screen, yellow doubles your fire rate.",
  "Keep killing to build a streak and a bigger score. Rank carries over between runs and unlocks guns.",
];

const TITLE_CSS = `
@keyframes ss-drift { from { transform: scale(1.04) translate3d(0,0,0); } to { transform: scale(1.14) translate3d(-2.2%, -1.4%, 0); } }
@keyframes ss-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(125,255,106,.0), 0 8px 26px rgba(0,0,0,.55); } 50% { box-shadow: 0 0 26px 2px rgba(125,255,106,.45), 0 8px 26px rgba(0,0,0,.55); } }
@keyframes ss-rise { from { opacity: 0; transform: translate3d(0,14px,0); } to { opacity: 1; transform: none; } }
.ss-title-bg { animation: ss-drift 22s ease-in-out infinite alternate; }
.ss-rise { animation: ss-rise .6s ease-out both; }
.ss-play { animation: ss-glow 2.4s ease-in-out infinite; }
.ss-play:active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) { .ss-title-bg, .ss-rise, .ss-play { animation: none; } }
`;

function TitleScreen({
  touch,
  difficulty,
  progress,
  onDifficulty,
  onPlay,
}: {
  touch: boolean;
  difficulty: DifficultyId;
  progress: Progress;
  onDifficulty: (id: DifficultyId) => void;
  onPlay: () => void;
}) {
  const [help, setHelp] = useState(false);
  const lines = touch ? HOW_TO_TOUCH : HOW_TO_DESKTOP;
  const rank = rankFor(progress.xp);
  const next = unlocksBetween(rank.level, rank.level + 1);
  return (
    <div data-testid="stackstrike-gate" style={{ ...COVER, alignItems: "stretch", justifyContent: "center", padding: 0, overflow: "hidden", textAlign: "left" }}>
      <style>{TITLE_CSS}</style>
      <div
        className="ss-title-bg"
        aria-hidden
        style={{ position: "absolute", inset: 0, backgroundImage: "url(/stackstrike/keyart.svg)", backgroundSize: "cover", backgroundPosition: "62% 50%" }}
      />
      <div
        aria-hidden
        style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,5,6,.95) 0%, rgba(5,5,6,.9) 44%, rgba(5,5,6,.15) 76%, rgba(5,5,6,.35) 100%)" }}
      />
      <div
        className="ss-rise"
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "clamp(8px, 2.2vh, 16px)",
          width: "min(460px, 92vw)",
          height: "100%",
          boxSizing: "border-box",
          padding: "max(16px, env(safe-area-inset-top)) 20px max(16px, env(safe-area-inset-bottom)) max(28px, env(safe-area-inset-left))",
        }}
      >
        <div>
          <div style={{ fontSize: "clamp(34px, 11vh, 60px)", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1, color: "#f4f1ea", textShadow: "0 3px 0 #000, 0 0 24px rgba(0,0,0,.6)" }}>
            STACK<span style={{ color: "#7dff6a" }}>DEAD</span>
          </div>
          <div style={{ marginTop: 8, fontSize: "clamp(10px, 2.4vh, 13px)", fontWeight: 700, letterSpacing: "0.32em", color: "#9aa3af" }}>HOLD THE LINE. SURVIVE THE WAVES.</div>
        </div>

        <div data-testid="stackstrike-rank" style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 340 }}>
          <div style={{ flex: "none", padding: "4px 10px", borderRadius: 6, background: "rgba(125,255,106,.14)", border: "1px solid rgba(125,255,106,.45)", color: "#7dff6a", fontSize: 12, fontWeight: 900, letterSpacing: "0.1em" }}>
            RANK {rank.level}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,.12)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round(rank.fraction * 100)}%`, height: "100%", background: "#7dff6a" }} />
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: "#8b93a1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {rank.needed === 0 ? "Top rank" : next.length > 0 ? `Next: ${next.join(", ")}` : `${rank.needed - rank.into} XP to rank ${rank.level + 1}`}
            </div>
          </div>
        </div>
        {progress.runs > 0 && (
          <div data-testid="stackstrike-best" style={{ marginTop: -6, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: "#9aa3af" }}>
            Best: wave {progress.bestWave} · {progress.bestScore.toLocaleString("en-US")} pts
          </div>
        )}

        <div role="group" aria-label="Difficulty" style={{ display: "flex", background: "rgba(255,255,255,.07)", borderRadius: 999, padding: 3, width: "fit-content", border: "1px solid rgba(255,255,255,.12)" }}>
          {DIFFICULTY_IDS.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`stackstrike-difficulty-${id}`}
              aria-pressed={difficulty === id}
              onClick={() => onDifficulty(id)}
              style={{
                padding: "9px 20px",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.04em",
                border: 0,
                borderRadius: 999,
                background: difficulty === id ? "#7dff6a" : "transparent",
                color: difficulty === id ? "#1a1204" : "#b6bdc8",
              }}
            >
              {DIFFICULTIES[id].label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#9aa3af", minHeight: 16, marginTop: -4 }}>{DIFFICULTIES[difficulty].blurb}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            type="button"
            className="ss-play"
            data-testid="stackstrike-play"
            onClick={onPlay}
            style={{ padding: "clamp(11px, 3vh, 15px) 44px", fontSize: 19, fontWeight: 900, letterSpacing: "0.08em", color: "#07160a", background: "linear-gradient(#b6ffa6, #5fe04a)", border: 0, borderRadius: 12 }}
          >
            PLAY
          </button>
          <button
            type="button"
            aria-expanded={help}
            onClick={() => setHelp((open) => !open)}
            style={{ background: "transparent", border: 0, color: "#b6bdc8", fontSize: 13, fontWeight: 700, padding: "10px 6px", textDecoration: "underline", textUnderlineOffset: 4 }}
          >
            {help ? "Hide" : "How to play"}
          </button>
        </div>
        {touch && !help && <div style={{ fontSize: 11, color: "#6b7280" }}>Plays in landscape.</div>}

        {help && (
          <ul style={{ margin: 0, padding: "10px 14px 10px 28px", fontSize: 12, lineHeight: 1.45, color: "#cfd5de", background: "rgba(0,0,0,.55)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, maxHeight: "44vh", overflowY: "auto" }}>
            {lines.map((line) => (
              <li key={line} style={{ marginBottom: 4 }}>
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
