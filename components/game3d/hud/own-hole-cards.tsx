"use client";

/**
 * <OwnHoleCards> — the local player's own pair, as crisp DOM cards, not a
 * 3D texture.
 *
 * WHY. The in-scene atlas renderer (scene/cards-instanced.tsx) draws every
 * hole card as a baked canvas texture on a tilted plane. That is fine for a
 * face-down pair nobody has to read, but the local player's own face-up
 * pair is the one thing on this felt that always has to be legible, and it
 * sat right next to the community board's own DOM cards reading visibly
 * softer than they do — same trade board-cards.tsx already made for the
 * same reason, applied here.
 *
 * OFF THE FELT ON PURPOSE. This is a fixed HUD element above the action
 * bar (see .ownHandLayer in game3d.module.css), not a projected 3D anchor
 * like the board. The player's own hand reads as something they're
 * holding, not another prop lying on the cloth, so it never has to fight
 * the felt's perspective or share space with a folding seat's recede.
 *
 * Everyone else's hole cards stay entirely in-scene: a modelled face-down
 * pair (props/hole-card-prop.tsx) while hidden, or the atlas renderer once
 * revealed at showdown — see lib/game3d/scene-model.ts's
 * seatHoleCardsHidden, the one predicate both that split and this
 * component's own skip agree on.
 */

import type { SeatModel } from "@/lib/game3d/scene-model";
import { CardFace } from "./card-face";
import styles from "../game3d.module.css";

export function OwnHoleCards({ seats }: { seats: SeatModel[] }) {
  const mine = seats.find((seat) => seat.isMine);
  if (!mine || !mine.inHand || mine.holeCards.length === 0) return null;

  return (
    <div className={styles.ownHandLayer}>
      {mine.holeCards.map((card, i) =>
        card ? (
          <div key={i} className={styles.ownHandCard}>
            <CardFace card={card} />
          </div>
        ) : null
      )}
    </div>
  );
}
