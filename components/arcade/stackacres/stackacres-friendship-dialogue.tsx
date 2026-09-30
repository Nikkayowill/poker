"use client";

import { useEffect, useRef } from "react";
import {
  KEEPSAKE_CATALOGUE,
  giftPreference,
  isGiftableItem,
  type GiftOutcome,
  type GreetOutcome,
  type KeepsakeId,
  type NpcId,
  type StackAcresFriendshipView,
} from "@/lib/stackacres/friendship";
import { machineItemIcon, machineItemLabel, type MachineItemId } from "@/lib/stackacres/machine-items";
import type { StackAcresInventory } from "@/lib/stackacres/inventory";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";
import type { TapPoint } from "./world-contract";
import { useKeepOnScreen } from "./use-keep-on-screen";

/**
 * NPC friendship: a greet-and-gift dialogue, one NPC at a time, for anyone
 * in FRIENDSHIP_NPCS (Ray, Chef Pierre, Botanist Ivy) -- opened by
 * onWorldRayTap for Ray, and by onWorldTravelerTap for a traveler whose
 * quest line is already done. Same screen-anchored treatment as
 * StackAcresMonkDialogue and built on the exact same phase shape (a
 * "greeting" the player answers, then a "result" of what that answer did) --
 * see that component's own header for the convention this one restates
 * rather than shares a component with. The two stay separate components
 * because a gift's own "greeting" is an item PICKER (any number of choices)
 * where a prayer's is a plain yes/no, and forcing that difference into one
 * component would mean threading item props through every prayer render.
 *
 * "greeting" -- one of the NPC's rotating opening lines, a "Say hi" button
 * (always available, once already-greeted-today is simply what the server
 * answers), then a row per processing-track item the player currently holds
 * at least one of, each tappable to send that exact gift immediately (no
 * separate confirm step, the same "the tap IS the commitment" posture
 * StackAcresRadialMenu's own seed buttons already take). Holding nothing to
 * give still shows "Say hi" -- there is only no picker to draw.
 *
 * "result" -- shown once a gift OR a greet answers. Leads with what THIS
 * one did (points earned, or the day-gate/insufficient-item refusal line),
 * then a keepsake-grant line only when one was just earned, then the
 * ongoing standing (title, progress to the next rung, keepsakes held) so a
 * repeat visit is never just a blank restatement of the picker.
 */

export interface StackAcresFriendshipDialogueProps {
  at: TapPoint;
  npc: NpcId;
  npcLabel: string;
  inventory: StackAcresInventory;
  friendship: StackAcresFriendshipView;
  result:
    | { phase: "greeting"; line: string }
    | {
        phase: "result";
        outcome: GiftOutcome | "insufficient-item" | GreetOutcome;
        points: number;
        grantedKeepsake: KeepsakeId | null;
      };
  busy: boolean;
  onGift: (item: MachineItemId) => void;
  onGreet: () => void;
  onClose: () => void;
}

function friendshipProgressLine(friendship: StackAcresFriendshipView, npcLabel: string): string {
  if (!friendship.nextRungTitle) return `Every keepsake ${npcLabel} keeps is now yours.`;
  const remaining = Math.max(0, friendship.nextRungPoints! - friendship.points);
  return remaining <= 0
    ? `${npcLabel} is ready to call you "${friendship.nextRungTitle}."`
    : `${remaining} more ${remaining === 1 ? "point" : "points"} until ${npcLabel} calls you "${friendship.nextRungTitle}."`;
}

export function StackAcresFriendshipDialogue({
  at,
  npc,
  npcLabel,
  inventory,
  friendship,
  result,
  busy,
  onGift,
  onGreet,
  onClose,
}: StackAcresFriendshipDialogueProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useKeepOnScreen<HTMLDivElement>();

  useEffect(() => {
    const timer = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const heldItems = (Object.keys(inventory) as MachineItemId[]).filter(
    (item) => isGiftableItem(item) && (inventory[item] ?? 0) > 0,
  );

  return (
    <div className="sa-gift-dialogue" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-gift-dialogue-pin" aria-hidden="true" />
      <div ref={cardRef} className="sa-gift-dialogue-card" role="dialog" aria-label={`Talk to ${npcLabel}`}>
        <button type="button" className="sa-gift-dialogue-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {result.phase === "greeting" ? (
          <>
            <p className="sa-gift-dialogue-line">{result.line}</p>
            <div className="sa-gift-dialogue-actions">
              {/* Never pre-disabled by `greetedToday`, same posture every gift-item
                  button already takes toward `giftedToday`: a repeat tap is a real,
                  server-refused request (the "result" phase explains it), not a dead
                  button -- a disabled button also cannot hold the dialogue's own
                  mount-time autofocus, which this one always carries. */}
              <button type="button" className="sa-gift-dialogue-greet" disabled={busy} onClick={onGreet} ref={firstRef}>
                👋 Say hi
              </button>
            </div>
            {heldItems.length === 0 ? (
              <p className="sa-gift-dialogue-prompt">
                Nothing on hand to give {npcLabel} right now -- the Mill, Dairy or Loom might fix that.
              </p>
            ) : (
              <>
                <p className="sa-gift-dialogue-prompt">Give {npcLabel} something?</p>
                <ul className="sa-gift-dialogue-items">
                  {heldItems.map((item) => {
                    const preference = giftPreference(npc, item);
                    return (
                      <li key={item}>
                        <button
                          type="button"
                          className="sa-gift-dialogue-item"
                          disabled={busy}
                          onClick={() => onGift(item)}
                        >
                          <span className="sa-gift-dialogue-item-badge" aria-hidden="true">
                            <StackAcresIcon name={machineItemIcon(item) as PainterName} size={22} />
                          </span>
                          <span className="sa-gift-dialogue-item-name">
                            {machineItemLabel(item, inventory[item] ?? 0)}
                          </span>
                          <span className={`sa-gift-dialogue-item-pref is-${preference}`}>
                            {preference === "loved" ? "❤ Loved" : preference === "liked" ? "🙂 Liked" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <div className="sa-gift-dialogue-actions">
              <button type="button" className="sa-gift-dialogue-no" onClick={onClose}>
                Not today
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sa-gift-dialogue-line">
              {result.outcome === "already-gifted-today"
                ? `You have already given ${npcLabel} something today. Come back tomorrow.`
                : result.outcome === "already-greeted-today"
                  ? `You already said hi to ${npcLabel} today. Come back tomorrow.`
                  : result.outcome === "insufficient-item"
                    ? "That's already spent -- check what you're still holding."
                    : `${npcLabel} is glad ${result.outcome === "greeted" ? "to see you" : "to have it"}. ${friendship.points} points now.`}
            </p>
            {result.grantedKeepsake && (
              <p className="sa-gift-dialogue-keepsake">
                {KEEPSAKE_CATALOGUE[result.grantedKeepsake].icon} {npcLabel} gives you their{" "}
                {KEEPSAKE_CATALOGUE[result.grantedKeepsake].label} -- {KEEPSAKE_CATALOGUE[result.grantedKeepsake].blurb}
              </p>
            )}
            <p className="sa-gift-dialogue-progress">{friendshipProgressLine(friendship, npcLabel)}</p>
            {friendship.keepsakesHeld.length > 0 && (
              <p className="sa-gift-dialogue-keepsakes-held" aria-label="Keepsakes held">
                {friendship.keepsakesHeld.map((id) => (
                  <span key={id} title={KEEPSAKE_CATALOGUE[id].label}>
                    {KEEPSAKE_CATALOGUE[id].icon}
                  </span>
                ))}
              </p>
            )}
            <div className="sa-gift-dialogue-actions">
              <button type="button" className="sa-gift-dialogue-no" ref={firstRef} onClick={onClose}>
                Thanks
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
