"use client";

/**
 * <Game3DBridge> — the entire seam between the existing engine and the 3D
 * room. It accepts the same redacted `GameSnapshot` the DOM table renders
 * from (the engine stays read-only; browser requests stay intents-only),
 * derives the pure SceneModel, and mounts the WebGL canvas client-side
 * only. Children render into the HTML overlay above the canvas.
 *
 * To try it against the live app, mount it where poker-app.tsx holds its
 * snapshot: <Game3DBridge game={game}>…HUD…</Game3DBridge>. Nothing else
 * is required, and removing it restores the DOM table untouched.
 */

import { useMemo, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { GameSnapshot } from "@/lib/game/types";
import { deriveSceneModel } from "@/lib/game3d/scene-model";
import styles from "./game3d.module.css";

const PokerScene = dynamic(
  () => import("./scene/poker-scene").then((m) => m.PokerScene),
  {
    ssr: false,
    loading: () => <div className={styles.loading}>Setting the table…</div>,
  }
);

export interface Game3DBridgeProps {
  game: GameSnapshot;
  /** Optional per-slot .glb avatar URLs (slot 0 is the local player). */
  avatarUrls?: Record<number, string>;
  /** HTML overlay content (action bar, readouts) layered above the canvas. */
  children?: ReactNode;
}

export function Game3DBridge({ game, avatarUrls, children }: Game3DBridgeProps) {
  const model = useMemo(() => deriveSceneModel(game), [game]);
  return (
    <div className={styles.stage}>
      <PokerScene model={model} avatarUrls={avatarUrls} />
      {children}
    </div>
  );
}
