"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Swords, UserPlus, X } from "lucide-react";
import { selectSound, tapSound } from "@/lib/audio/ui-sounds";
import { CHALLENGEABLE_DUELS } from "@/lib/pvp/duel-list";

/**
 * The seat-level "Challenge" affordance -- a direct shortcut to the same
 * `/games/<duel>?challenge=<profileId>&name=<name>` contract the friends
 * drawer's Challenge select already opens
 * (components/social/friends-drawer.tsx), skipping the
 * Friends -> Add friend -> Friends -> Challenge detour. Only ever rendered
 * for a seat `lib/game/seat-presence.ts`'s `isChallengeableSeat` allows --
 * a registered human, not yourself, not a bot.
 *
 * Also carries its own "Add friend" row, doing exactly what
 * friends-drawer.tsx's "At this table" section does (POST
 * /api/friends/requests) -- previously the only way to friend a seated
 * stranger you'd just challenged was to close this panel, open the Friends
 * drawer, and find them in that list separately.
 *
 * No friendship gate on the challenge itself: this is exactly the same
 * request `openDuelChallenge` already accepts from a stranger -- it only
 * refuses a blocked pairing (see lib/server/pvp-match-service.ts). Gating
 * this control on friendship would be inventing a policy the server does not
 * enforce, and the friends drawer's own "At this table" row already lets a
 * stranger be challenged this way once they're a friend; this just removes
 * the detour.
 *
 * The picker is portaled to <body> and fixed to the viewport rather than
 * anchored off the trigger's own position: a seat can land anywhere on the
 * felt, including a few pixels from the racetrack stage's own
 * overflow:hidden edge (see the winner badge's own clamp in
 * 42-racetrack-table.css), and a portal sidesteps that clipping instead of
 * re-deriving it for a second element.
 */
export function ChallengeSeatControl({
  profileId,
  displayName,
}: {
  profileId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // Mirrors friends-drawer.tsx's own addFriend: a POST against the same
  // /api/friends/requests route, just with its own local status rather than
  // that drawer's shared `overview`/`busy` state, since this control has
  // neither.
  const [friendStatus, setFriendStatus] = useState<"idle" | "sending" | "sent" | "already_pending" | "already_friends" | "blocked" | "error">("idle");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const challenge = (game: string) => {
    selectSound();
    close();
    const params = new URLSearchParams({ challenge: profileId, name: displayName });
    router.push(`/games/${game}?${params.toString()}`);
  };

  const addFriend = useCallback(async () => {
    selectSound();
    setFriendStatus("sending");
    try {
      const response = await fetch("/api/friends/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const data = (await response.json().catch(() => null)) as { status?: string } | null;
      if (!response.ok || !data?.status) {
        setFriendStatus("error");
        return;
      }
      if (data.status === "sent" || data.status === "already_pending" || data.status === "already_friends" || data.status === "blocked") {
        setFriendStatus(data.status);
      } else {
        setFriendStatus("error");
      }
    } catch {
      setFriendStatus("error");
    }
  }, [profileId]);

  const friendLabel: Record<typeof friendStatus, string> = {
    idle: "Add friend",
    sending: "Adding…",
    sent: "Friend request sent",
    already_pending: "Already pending",
    already_friends: "Already friends",
    blocked: "Can't add that player",
    error: "Couldn't send request",
  };

  return (
    <>
      <button
        type="button"
        className="seat-challenge-trigger"
        aria-label={`Challenge ${displayName} to a duel`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(event) => {
          // Seats carry no click handler of their own today, but this stops
          // one from landing underneath the trigger later and firing twice.
          event.stopPropagation();
          tapSound();
          setOpen(true);
        }}
      >
        <Swords size={10} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          className="seat-challenge-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <div
            className="seat-challenge-panel"
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={`Challenge ${displayName}`}
          >
            <div className="seat-challenge-heading">
              <span>Challenge {displayName}</span>
              <button
                type="button"
                className="seat-challenge-close"
                onClick={() => { tapSound(); close(); }}
                aria-label="Cancel"
              >
                <X size={14} />
              </button>
            </div>
            <button
              type="button"
              className="seat-challenge-add-friend"
              disabled={friendStatus !== "idle" && friendStatus !== "error"}
              onClick={() => void addFriend()}
            >
              <UserPlus size={13} aria-hidden="true" />
              {friendLabel[friendStatus]}
            </button>
            <div className="seat-challenge-options">
              {CHALLENGEABLE_DUELS.map((duel) => (
                <button
                  key={duel.id}
                  type="button"
                  className="app-menu-item"
                  onClick={() => challenge(duel.id)}
                >
                  {duel.label}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
