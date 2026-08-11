"use client";

import { useEffect, useRef, useState } from "react";
import type { GameSnapshot } from "@/lib/game/types";
import type { SceneModel } from "@/lib/game3d/scene-model";
import type { PlayerProfile } from "@/lib/profile/types";
import { BetAmounts } from "./bet-amounts";
import { BoardCards } from "./board-cards";
import { OwnHoleCards } from "./own-hole-cards";
import { SeatNameplates } from "./seat-nameplates";
import { PlayerHudCorner } from "./player-hud-corner";
import { useMinWidth } from "./use-min-width";
import styles from "../game3d.module.css";

/** Matches 06-table.css's `min-width: 901px`, where the 3D room's action
 * bar leaves the flex column and floats over the bottom-right corner. The
 * local player's own corner HUD only exists past that same width -- below
 * it, their plate stays in the ordinary projected layer like every other
 * seat. */
const DESKTOP_HUD_MIN_WIDTH = 901;

export function LiveTableHud({
  game,
  model,
  profile,
}: {
  game: GameSnapshot;
  model: SceneModel;
  profile: PlayerProfile | null;
}) {
  const hudRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const isDesktopHud = useMinWidth(DESKTOP_HUD_MIN_WIDTH);
  const mine = model.seats.find((seat) => seat.isMine) ?? null;
  const showCornerHud = isDesktopHud && mine !== null;

  useEffect(() => {
    const element = hudRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const active = model.seats.find((seat) => seat.isCurrent) ?? null;
  const latestAction = game.log[0]?.text ?? game.message;

  return (
    <div ref={hudRef} className={styles.liveHud}>
      <div className={styles.liveHudTop}>
        <span className={styles.liveStreet}>{game.street}</span>
        <div className={styles.livePot}>
          <small>Pot</small>
          <strong>{game.pot.toLocaleString()}</strong>
        </div>
        <span className={styles.liveBlinds}>
          {game.smallBlind.toLocaleString()} / {game.bigBlind.toLocaleString()}
        </span>
      </div>

      <div
        className={`${styles.liveTurn} ${active?.isMine ? styles.liveTurnMine : ""}`}
        role="status"
        aria-live="polite"
      >
        <i aria-hidden="true" />
        <span>
          {active
            ? active.isMine ? "Your turn" : `${active.name} to act`
            : model.hasWinners ? "Hand complete" : "Dealing"}
        </span>
        {latestAction ? <small>{latestAction}</small> : null}
      </div>

      {size.width > 0 && size.height > 0 ? (
        <>
          <SeatNameplates
            model={model}
            aspect={size.width / size.height}
            containerHeight={size.height}
            hideMine={showCornerHud}
          />
          <BetAmounts model={model} aspect={size.width / size.height} />
          <BoardCards cards={model.community} width={size.width} height={size.height} />
        </>
      ) : null}
      <OwnHoleCards seats={model.seats} live />
      {showCornerHud && mine ? (
        <PlayerHudCorner name={mine.name} stack={mine.stack} profile={profile} />
      ) : null}
    </div>
  );
}
