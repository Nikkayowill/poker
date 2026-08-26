"use client";

/**
 * The local player's own gaming HUD: desktop only, bottom-left, mirroring
 * the 3D room's action bar into the opposite corner (06-table.css floats
 * that bar bottom-right at the same `min-width: 901px`).
 *
 * It exists because the ordinary projected nameplate (seat-nameplates.tsx)
 * can't do this job for the local player: everyone else's plate floats
 * above their own head, but the local seat sits nearest the camera at the
 * bottom of the frame, so its "above the head" point lands mid-table
 * instead of naming a corner of the screen. live-table-hud.tsx drops the
 * local seat from that projected layer on desktop and renders this instead.
 *
 * Styled like a corner health-bar HUD (portrait, level badge, XP bar,
 * resource counter) rather than another glass pill matching the pot/turn
 * readouts, since the ask was to "look like a real video game" — and
 * portrait-plus-bars in a screen corner is the genre's own convention for
 * "this is you."
 */

import { useProgression } from "@/components/profile/use-progression";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import type { PlayerProfile } from "@/lib/profile/types";
import styles from "../game3d.module.css";

/** A poker chip, not a coin: this reads the table stack, not the Gold
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

export function PlayerHudCorner({
  name,
  stack,
  profile,
}: {
  /** The seat's name, not the profile's: a bot-turned-human mid-hand or a
   * guest's session name is what the felt actually calls this seat. */
  name: string;
  stack: number;
  profile: PlayerProfile | null;
}) {
  const data = useProgression();
  const progression = data?.progression ?? null;

  return (
    <div className={styles.playerHud}>
      <div className={styles.playerHudPortrait}>
        {profile ? (
          <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
        ) : (
          <span className={styles.playerHudPortraitFallback} aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        {progression && (
          <span className={styles.playerHudLevel} title={progression.title}>
            {progression.level}
          </span>
        )}
      </div>

      <div className={styles.playerHudBody}>
        <span className={styles.playerHudName}>{name}</span>

        {progression && (
          <div
            className={styles.playerHudXpTrack}
            role="progressbar"
            aria-label="Level progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progression.ratio * 100)}
          >
            <div
              className={styles.playerHudXpFill}
              style={{ width: `${Math.round(progression.ratio * 100)}%` }}
            />
          </div>
        )}

        <span className={styles.playerHudCash}>
          <ChipGlyph />
          {stack.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
