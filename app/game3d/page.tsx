"use client";

/**
 * /game3d — isolated demo route for the 3D table experiment.
 *
 * Drives <Game3DBridge> with scripted, fully-typed GameSnapshots (no server,
 * no engine import, no live game touched). Hands loop forever; the HUD's
 * Fold / Call / Raise are real choices at your turn and branch the script.
 * Deleting app/game3d + components/game3d + lib/game3d removes every trace.
 */

import { useEffect, useRef, useState } from "react";
import { Game3DBridge } from "@/components/game3d/game3d-bridge";
import { ActionHud } from "@/components/game3d/hud/action-hud";
import {
  openingSteps,
  type DemoAction,
  type DemoStep,
} from "@/components/game3d/demo/scripted-hand";

export default function Game3DDemoPage() {
  const [queue, setQueue] = useState<DemoStep[]>(() => openingSteps(1));
  const [index, setIndex] = useState(0);
  const handRef = useRef(1);

  const step: DemoStep | undefined = queue[index];

  useEffect(() => {
    if (!step) {
      // Hand finished: deal the next one. The bumped handNumber is what
      // tells the scene "hand boundary — clear the felt instantly".
      handRef.current += 1;
      setQueue(openingSteps(handRef.current));
      setIndex(0);
      return;
    }
    if (step.next) return; // holding for the player's decision
    const timer = setTimeout(() => setIndex((i) => i + 1), step.holdMs);
    return () => clearTimeout(timer);
  }, [step]);

  const act = (action: DemoAction) => {
    const current = queue[index];
    if (!current?.next) return;
    const continuation = current.next(action);
    setQueue([...queue.slice(0, index + 1), ...continuation]);
    setIndex(index + 1);
  };

  // While the effect above swaps in the next hand, keep showing the last
  // step — returning null for that frame would unmount the Canvas and
  // rebuild the WebGL context once per hand.
  const shown = step ?? queue[queue.length - 1];
  if (!shown) return null;

  const { snapshot } = shown;
  return (
    <main style={{ position: "fixed", inset: 0 }}>
      <Game3DBridge game={snapshot}>
        <ActionHud
          pot={snapshot.pot}
          message={snapshot.message}
          legalActions={snapshot.legalActions}
          onFold={() => act("fold")}
          onCall={() => act("call")}
          onRaise={() => act("raise")}
        />
      </Game3DBridge>
    </main>
  );
}
