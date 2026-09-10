"use client";

import { useEffect, useRef } from "react";
import {
  KEEPSAKE_CATALOGUE,
  giftPreference,
  type GiftOutcome,
  type KeepsakeId,
  type NpcId,
  type StackAcresFriendshipView,
} from "@/lib/stackacres/friendship";
import { MACHINE_ITEM_CATALOGUE, type MachineItemId } from "@/lib/stackacres/machine-items";
import type { StackAcresInventory } from "@/lib/stackacres/inventory";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";
import type { TapPoint } from "./stackacres-scene";

/**
 * NPC friendship: a gift dialogue, same screen-anchored treatment as
 * StackAcresMonkDialogue and built on the exact same phase shape (a
 * "greeting" the player answers, then a "result" of what that answer did) --
 * see that component's own header for the convention this one restates
 * rather than shares a component with. The two stay separate components
 * because a gift's own "greeting" is an item PICKER (any number of choices)
 * where a prayer's is a plain yes/no, and forcing that difference into one
 * component would mean threading item props through every prayer render.
 *
 * "greeting" -- one of the NPC's rotating opening lines, then a row per
 * processing-track item the player currently holds at least one of, each
 * tappable to send that exact gift immediately (no separate confirm step,
 * the same "the tap IS the commitment" posture StackAcresRadialMenu's own
 * seed buttons already take). Holding nothing to give shows a plain line
 * and only a close button -- there is no picker to draw.
 *
 * "result" -- shown once a gift answers. Leads with what THIS gift did
 * (points earned, or the day-gate/insufficient-item refusal line), then a
 * keepsake-grant line only when one was just earned, then the ongoing
 * standing (title, progress to the next rung, keepsakes held) so a repeat
 * visit is never just a blank restatement of the picker.
 */

export interface StackAcresFriendshipDialogueProps {
  at: TapPoint;
  npc: NpcId;
  npcLabel: string;
  inventory: StackAcresInventory;
  friendship: StackAcresFriendshipView;
  result:
    | { phase: "greeting"; line: string }
    | { phase: "result"; outcome: GiftOutcome | "insufficient-item"; points: number; grantedKeepsake: KeepsakeId | null };
  busy: boolean;
  onGift: (item: MachineItemId) => void;
  onClose: () => void;
  /**
   * Opens the supply store or Ray's Mythic Blueprints. Only passed for
   * `npc === "ray"`. With the places list gone, tapping Ray is the way to
   * reach both, so his greeting grew two buttons instead of being replaced.
   */
  onOpenShop?: () => void;
  onOpenBlueprints?: () => void;
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
  onClose,
  onOpenShop,
  onOpenBlueprints,
}: StackAcresFriendshipDialogueProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);

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

  const heldItems = (Object.keys(inventory) as MachineItemId[]).filter((item) => (inventory[item] ?? 0) > 0);

  return (
    <div className="sa-gift-dialogue" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-gift-dialogue-pin" aria-hidden="true" />
      <div className="sa-gift-dialogue-card" role="dialog" aria-label={`Give ${npcLabel} a gift`}>
        <button type="button" className="sa-gift-dialogue-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {(onOpenShop || onOpenBlueprints) && (
          <div className="sa-gift-dialogue-errands">
            {onOpenShop && (
              <button type="button" className="sa-gift-dialogue-errand" onClick={onOpenShop}>
                Shop
              </button>
            )}
            {onOpenBlueprints && (
              <button type="button" className="sa-gift-dialogue-errand" onClick={onOpenBlueprints}>
                Blueprints
              </button>
            )}
          </div>
        )}
        {result.phase === "greeting" ? (
          <>
            <p className="sa-gift-dialogue-line">{result.line}</p>
            {heldItems.length === 0 ? (
              <p className="sa-gift-dialogue-prompt">
                You have nothing on hand to give him right now -- the Mill, Dairy or Loom might fix that.
              </p>
            ) : (
              <>
                <p className="sa-gift-dialogue-prompt">Give him something?</p>
                <ul className="sa-gift-dialogue-items">
                  {heldItems.map((item) => {
                    const def = MACHINE_ITEM_CATALOGUE[item];
                    const preference = giftPreference(npc, item);
                    return (
                      <li key={item}>
                        <button
                          type="button"
                          className="sa-gift-dialogue-item"
                          disabled={busy}
                          onClick={() => onGift(item)}
                          ref={item === heldItems[0] ? firstRef : undefined}
                        >
                          <span className="sa-gift-dialogue-item-badge" aria-hidden="true">
                            <StackAcresIcon name={def.icon as PainterName} size={22} />
                          </span>
                          <span className="sa-gift-dialogue-item-name">{def.plural}</span>
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
                {heldItems.length === 0 ? "Alright" : "Not today"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sa-gift-dialogue-line">
              {result.outcome === "already-gifted-today"
                ? `You have already given him something today. Come back tomorrow.`
                : result.outcome === "insufficient-item"
                  ? "That's already spent -- check what you're still holding."
                  : `He is glad to have it. ${friendship.points} points now.`}
            </p>
            {result.grantedKeepsake && (
              <p className="sa-gift-dialogue-keepsake">
                {KEEPSAKE_CATALOGUE[result.grantedKeepsake].icon} He gives you his{" "}
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
