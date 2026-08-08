"use client";

/**
 * The HTML overlay: pot readout, table message, and the action bar. Pure
 * DOM on top of the canvas — text and numbers never enter WebGL, so they
 * stay crisp at any DPI and remain accessible to screen readers.
 */

import type { LegalActions } from "@/lib/game/types";
import styles from "../game3d.module.css";

export interface ActionHudProps {
  pot: number;
  message?: string;
  legalActions: LegalActions | null;
  onFold: () => void;
  onCall: () => void;
  onRaise: () => void;
}

export function ActionHud({
  pot,
  message,
  legalActions,
  onFold,
  onCall,
  onRaise,
}: ActionHudProps) {
  const acting = legalActions !== null;
  const toCall = legalActions?.toCall ?? 0;
  return (
    <div className={styles.hud}>
      <div className={styles.hudTop}>
        <div className={styles.potReadout}>
          Pot<span>{pot.toLocaleString()}</span>
        </div>
      </div>
      {message ? <div className={styles.message}>{message}</div> : null}
      <div className={styles.actionBar}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.fold}`}
          disabled={!acting || !legalActions.canFold}
          onClick={onFold}
        >
          Fold
        </button>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.call}`}
          disabled={!acting || !(legalActions.canCall || legalActions.canCheck)}
          onClick={onCall}
        >
          {toCall > 0 ? "Call" : "Check"}
          {toCall > 0 ? (
            <span className={styles.subLabel}>{toCall.toLocaleString()}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.raise}`}
          disabled={!acting || !legalActions.canRaise}
          onClick={onRaise}
        >
          Raise
          {legalActions?.canRaise ? (
            <span className={styles.subLabel}>
              to {legalActions.minRaiseTo.toLocaleString()}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
