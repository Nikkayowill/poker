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

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { GameSnapshot } from "@/lib/game/types";
import { deriveSceneModel } from "@/lib/game3d/scene-model";
import type { RoomThemeId } from "@/lib/game3d/room-theme";
import { BetAmounts } from "./hud/bet-amounts";
import { BoardCards } from "./hud/board-cards";
import { OwnHoleCards } from "./hud/own-hole-cards";
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

  /** Which room look to render — see lib/game3d/room-theme.ts. Optional;
   * defaults to the standing look, same as PokerScene's own field. */
  roomThemeId?: RoomThemeId;
  /** HTML overlay content (action bar, readouts) layered above the canvas. */
  children?: ReactNode;
}

/**
 * The board is projected from the stage's own box, not the window — the
 * stage can be letterboxed or transform-scaled by a caller (the artifact
 * demo does exactly that), and reading window size there would size the
 * cards for a box the stage doesn't actually have.
 */
function useStageSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Game3DBridge({ game, roomThemeId, children }: Game3DBridgeProps) {
  const model = useMemo(() => deriveSceneModel(game), [game]);
  const [stageRef, stageSize] = useStageSize();
  return (
    <div ref={stageRef} className={styles.stage}>
      <PokerScene model={model} roomThemeId={roomThemeId} />
      <BoardCards
        cards={model.community}
        width={stageSize.width}
        height={stageSize.height}
      />
      {/* The number beside each pile. Mounted here as well as in
          hud/live-table-hud.tsx (the live table's overlay) because this
          bridge is its own overlay and shares none of that one — the chips
          are a size cue in both rooms, so both need the readout. Gated on a
          measured stage: the projection divides by the aspect. */}
      {stageSize.width > 0 && stageSize.height > 0 ? (
        <BetAmounts
          model={model}
          aspect={stageSize.width / stageSize.height}
          width={stageSize.width}
          height={stageSize.height}
        />
      ) : null}
      <OwnHoleCards seats={model.seats} />
      {children}
    </div>
  );
}
