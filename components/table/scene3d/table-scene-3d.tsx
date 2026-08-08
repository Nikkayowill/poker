"use client";

/**
 * The WebGL room, wearing the Canvas-2D room's mount contract.
 *
 * This file is the whole swap. `<TableScene>` and `<TableScene3D>` are
 * interchangeable at `poker-table.tsx`'s one call site because both:
 *
 *   - mount as the first child of `.table-area`, in a `.table-scene` host,
 *   - are `aria-hidden` and `pointer-events: none` (99-scene.css owns both,
 *     and the pointer rule is load-bearing: the room covers every seat and
 *     the action bar, and a canvas that eats a tap looks exactly like a
 *     button that did not fire),
 *   - and report through a single `onReady(boolean)`, which is what applies
 *     `.scene-lit` and stops the DOM felt painting.
 *
 * Nothing else at the table branches on which room is underneath. The
 * nameplates, the board, the local player's hole cards, the action bar, the
 * feed, the turn-clock fuse, every cosmetic card back and every sound are
 * DOM above the canvas and were not touched to make this work.
 *
 * WHY THIS TAKES A SNAPSHOT WHERE THE 2D ROOM TAKES ELEVEN PROPS. The 2D room
 * is fed pre-chewed deltas — `betFlights`, `paying`, `sceneStreetBets` — that
 * `poker-table.tsx` computes for it. The 3D room does its own diffing inside
 * `chip-field.tsx` (bets, sweeps, awards, hand boundaries all fall out of
 * successive SceneModels), so handing it the same deltas would mean two
 * disagreeing sources for one animation. It takes the snapshot and derives.
 *
 * `deriveSceneModel` rotates the local player into slot 0 itself, so passing
 * the raw snapshot rather than `orderedSeats` is correct and not an accident:
 * given already-ordered seats it finds `isMine` at index 0 and rotates by
 * zero. Its tests pin both directions.
 */

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GameSnapshot } from "@/lib/game/types";
import { deriveSceneModel } from "@/lib/game3d/scene-model";
import { PokerScene } from "@/components/game3d/scene/poker-scene";

export interface TableScene3DProps {
  game: GameSnapshot;
  onReady: (ready: boolean) => void;
}

/**
 * A render error inside the Canvas must not take the page with it.
 *
 * Without this, an exception thrown in the scene graph — an unknown stakes
 * tier reaching `TIER_CONFIG[...]`, a malformed .glb, a driver rejecting a
 * texture — propagates to the app shell and blanks the whole table. The DOM
 * felt underneath is a complete, working table on its own, so the correct
 * response to any scene failure is to say `onReady(false)` and get out of the
 * way. Written as a class because that is still the only way to catch a
 * descendant's render error in React.
 */
class SceneBoundary extends Component<
  { onFailed: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailed();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function TableScene3D({ game, onReady }: TableScene3DProps) {
  const model = useMemo(() => deriveSceneModel(game), [game]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Unmounting hands the felt back, matching the 2D room's cleanup exactly.
    return () => onReady(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return null;

  return (
    <div className="table-scene" aria-hidden="true">
      <SceneBoundary
        onFailed={() => {
          setFailed(true);
          onReady(false);
        }}
      >
        <PokerScene model={model} onReady={onReady} />
      </SceneBoundary>
    </div>
  );
}
