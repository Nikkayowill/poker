"use client";

/**
 * The four-section tab bar's markup, extracted out of components/lobby/
 * mobile-shell.tsx so it can render from two different places without
 * becoming two diverging implementations: MobileShell itself (phone, at `/`,
 * where "active" is the swipeable pane in view) and PersistentChrome (phone,
 * every other route, where "active" is derived from the URL and a tap
 * navigates rather than swipes). Purely presentational -- it takes
 * `activeIndex`/`onSelect` and has no opinion on what selecting a tab means.
 */

import type { LucideIcon } from "lucide-react";
import { Puzzle, Spade, Trophy } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";
import { ProfileAvatar } from "@/components/profile/profile-avatar";

export const TAB_LABELS = ["Play", "Ante Up", "Leaderboard", "Profile"] as const;
export const TAB_COUNT = TAB_LABELS.length;

// Puzzle over a generic controller glyph: this tab is Sudoku/Word Stack/
// Connections/Memory/Minesweeper/Nonogram plus the PvP duels, not "any
// game." Trophy is the same glyph the desktop header's own menu uses for its
// own Leaderboard link.
//
// Profile has no entry here -- Jakob's Law: TikTok, Instagram and YouTube
// all render their own last tab as the player's actual photo, not a generic
// person glyph, precisely because a familiar face is a stronger "this is
// yours" cue than a silhouette everyone's app uses. See the render below,
// which special-cases the last tab to <ProfileAvatar> instead of reading
// this array (it is deliberately one element short of TAB_LABELS).
const TAB_ICONS: readonly LucideIcon[] = [Spade, Puzzle, Trophy];

/**
 * Which pane the player was last on -- read by MobileShell on mount, and
 * written by PersistentChrome before it navigates to `/` for a tab with no
 * standalone route (Play, Profile), so landing there opens the right pane
 * instead of always resetting to Play. sessionStorage, never localStorage:
 * this is where you are in this visit, not a preference.
 */
export const LOBBY_PANE_STORAGE_KEY = "stackchips:lobby-pane";

export function TabBar({
  activeIndex,
  onSelect,
  profile,
}: {
  /** null when the current screen doesn't map onto any of the four tabs. */
  activeIndex: number | null;
  onSelect: (index: number) => void;
  profile: PlayerProfile;
}) {
  return (
    <nav className="mshell-nav" aria-label="Lobby sections">
      {TAB_LABELS.map((name, index) => {
        const Icon = TAB_ICONS[index];
        const active = index === activeIndex;
        return (
          <button
            key={name}
            type="button"
            className={`mshell-nav-item${active ? " mshell-nav-on" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(index)}
          >
            {/* The other two tabs swap outline/filled by toggling `fill`, the
                same active-state cue TikTok/Instagram/YouTube use on their
                own generic tabs. Wrapped so the press animation (CSS, on
                .mshell-nav-icon) can scale/rotate just the glyph -- the
                label underneath stays put, which is what keeps a tap from
                reading as the whole button wobbling. */}
            {Icon
              ? (
                <span className="mshell-nav-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.8} fill={active ? "currentColor" : "none"} />
                </span>
              )
              : (
                // aria-hidden, not just decorative styling: ProfileAvatar
                // sets its own role="img"/aria-label, which would otherwise
                // concatenate into this button's accessible name alongside
                // the visible "Profile" label.
                <span className="mshell-nav-icon" aria-hidden="true">
                  <ProfileAvatar
                    profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }}
                    className="mshell-nav-avatar"
                  />
                </span>
              )}
            <span className="mshell-nav-label">{name}</span>
          </button>
        );
      })}
    </nav>
  );
}
