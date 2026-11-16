"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from "@/lib/stackstrike/content";
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
        audio: { noAudio: true },
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

      {touch !== null && !started && (
        <div data-testid="stackstrike-gate" style={COVER}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 4 }}>STACKSTRIKE</div>
          <div style={{ fontSize: 14, color: "#9aa3af", maxWidth: 520, lineHeight: 1.5 }}>
            {touch
              ? "Left stick moves. Drag the right pad to aim the gun and its red laser (they can't see it), tap it anywhere to fire. Red glows are the enemy, and the map shows them all. Each carries a flashlight: stay out of the beam and they can't see you, step into it and their meter fills. Press into a dark corner to disappear. They come through the red doors."
              : "WASD moves. The mouse aims, click fires, R reloads. Red glows are the enemy, and the map shows them all. Each carries a flashlight: stay out of the beam and they can't see you, step into it and their meter fills. Press into a dark corner to disappear. They come through the red doors."}
          </div>
          <div role="group" aria-label="Difficulty" style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {DIFFICULTY_IDS.map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`stackstrike-difficulty-${id}`}
                aria-pressed={difficulty === id}
                onClick={() => setDifficulty(id)}
                style={{
                  padding: "9px 20px",
                  fontSize: 14,
                  fontWeight: 700,
                  borderRadius: 8,
                  border: `2px solid ${difficulty === id ? "#ffd98a" : "#3a3f48"}`,
                  background: difficulty === id ? "#3a2f15" : "#0d0e10",
                  color: difficulty === id ? "#ffd98a" : "#9aa3af",
                }}
              >
                {DIFFICULTIES[id].label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#8b93a1", minHeight: 16 }}>{DIFFICULTIES[difficulty].blurb}</div>
          <button
            type="button"
            onClick={begin}
            style={{
              marginTop: 2,
              padding: "14px 38px",
              fontSize: 18,
              fontWeight: 800,
              color: "#1a1204",
              background: "#ffd98a",
              border: 0,
              borderRadius: 10,
            }}
          >
            {touch ? "Tap to play" : "Play"}
          </button>
          {touch && <div style={{ fontSize: 12, color: "#6b7280" }}>Plays in landscape.</div>}
        </div>
      )}

      {uprightPhone && (
        <div data-testid="stackstrike-rotate" style={{ ...COVER, zIndex: 10 }}>
          <div style={{ fontSize: 46, transform: "rotate(90deg)" }}>📱</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Turn your phone sideways</div>
          <div style={{ fontSize: 13, color: "#9aa3af" }}>StackStrike plays in landscape.</div>
        </div>
      )}
    </div>
  );
}
