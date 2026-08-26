"use client";

/**
 * The local player's own corner HUD on the racetrack table -- bottom-left,
 * originally a direct port of the now-deleted WebGL 3D room's own
 * <PlayerHudCorner> (mirrored call for call rather than reinvented;
 * recoverable from the `archive/webgl-3d-table` git tag if that history is
 * ever needed).
 *
 * `.seat-mine` used to carry its own avatar figure at the near edge (see
 * 16-first-person.css's own header for that layout's history), which meant
 * the one thing every player asks first, "which cards are mine", had to
 * share the near-field band with a face crop that added nothing a nameplate
 * didn't already say. Hiding that figure on desktop (16-first-person.css,
 * `min-width: 901px`) and putting the avatar here instead is what frees the
 * near-field band for the cards alone.
 *
 * Classic-table mobile keeps the figure instead of this HUD: a phone's
 * near-field band has no spare corner to plant a second HUD in without
 * crowding the action bar underneath it. The racetrack table is the one
 * exception, since its local seat never has a figure at any width (the
 * camera sits in that chair), so it shows this HUD at every width instead
 * of only past 901px; see 42-racetrack-table.css's own note.
 */

import { useProgression } from "@/components/profile/use-progression";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import type { PlayerProfile } from "@/lib/profile/types";
import type { ReactionId } from "@/lib/game/reaction-channel";
import { ReactionButton } from "./table-reactions";

/** A poker chip, not a coin -- this reads the table stack, not the Gold
 * wallet the navbar's Coins icon already means. */
function ChipGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="currentColor" opacity="0.22" />
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.3" />
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <rect
          key={deg}
          x="11"
          y="1.4"
          width="2"
          height="3.6"
          rx="1"
          fill="currentColor"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </svg>
  );
}

export function LocalPlayerHud({
  name,
  stack,
  profile,
  handLabel,
  onSendReaction,
  reactionCooldown,
  activeReaction,
}: {
  /** The seat's name, not the profile's: a bot-turned-human mid-hand or a
   * guest's session name is what the felt actually calls this seat. */
  name: string;
  stack: number;
  profile: PlayerProfile | null;
  handLabel?: string | null;
  onSendReaction?: (reactionId: ReactionId) => void;
  reactionCooldown?: boolean;
  activeReaction?: ReactionId | null;
}) {
  const data = useProgression();
  const progression = data?.progression ?? null;
  const avatar = profile ? (
    <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
  ) : (
    <span className="player-hud-portrait-fallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );

  return (
    <div className="player-hud">
      <div className="player-hud-portrait">
        {onSendReaction ? (
          <ReactionButton
            onSend={onSendReaction}
            disabled={reactionCooldown ?? false}
            trigger={avatar}
            activeReaction={activeReaction}
          />
        ) : avatar}
        {progression && (
          <span className="player-hud-level" title={progression.title}>
            {progression.level}
          </span>
        )}
      </div>

      <div className="player-hud-body">
        <span className="player-hud-name">{name}</span>

        {progression && (
          <div
            className="player-hud-xp-track"
            role="progressbar"
            aria-label="Level progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progression.ratio * 100)}
          >
            <div
              className="player-hud-xp-fill"
              style={{ width: `${Math.round(progression.ratio * 100)}%` }}
            />
          </div>
        )}

        <span className="player-hud-cash">
          <ChipGlyph />${stack.toLocaleString()}
        </span>
      </div>

      {handLabel && (
        <span className="player-hud-hand-strength" aria-live="polite">
          {handLabel}
        </span>
      )}
    </div>
  );
}
