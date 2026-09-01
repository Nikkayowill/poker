"use client";

/**
 * The persistent desktop header for every route except `/`, which keeps its
 * own full header (components/poker-app.tsx's `.lobby-header`) untouched --
 * that one carries the daily-Gold claim, push-notification toggle, and other
 * poker-app-local actions that would drag a lot of unrelated state up into
 * the shell for no real benefit. This is deliberately a leaner sibling, not
 * an extraction of that one: just enough to orient and navigate from
 * anywhere else in the app, since desktop has never had persistent chrome
 * outside `/` at all. Never rendered at `/` itself -- see
 * components/shell/persistent-chrome.tsx.
 */

import Link from "next/link";
import { Coins, LayoutGrid, Settings2, Trophy } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";
import { StackChipsLogo } from "@/components/brand/stackchips-logo";
import { GoldBadge } from "@/components/profile/gold-badge";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { Menu, type MenuItem } from "@/components/nav/menu";
import { useAppShell } from "@/components/shell/app-shell";

export function DesktopHeader({ profile }: { profile: PlayerProfile }) {
  const { musicEnabled, toggleMenuMusic } = useAppShell();

  // Deliberately no sign-in/out or edit-profile row here: those live behind
  // Supabase auth flows and modal state that stay local to poker-app.tsx (see
  // this file's own header comment). "Manage account" is the one link out to
  // where they still live, at `/`, rather than duplicating that logic here.
  const items: MenuItem[] = [
    { kind: "link", label: "Collection", href: "/collection", icon: <LayoutGrid size={15} /> },
    { kind: "link", label: "Buy Gold", href: "/store/gold", icon: <Coins size={15} /> },
    { kind: "link", label: "Leaderboard", href: "/leaderboard", icon: <Trophy size={15} /> },
    { kind: "separator" },
    {
      kind: "action",
      label: musicEnabled ? "Menu music: On" : "Menu music: Off",
      onSelect: toggleMenuMusic,
    },
    { kind: "separator" },
    { kind: "link", label: "Manage account", href: "/", icon: <Settings2 size={15} /> },
  ];

  return (
    <header className="app-shell-header">
      <Link href="/" className="wordmark wordmark-mark-only" aria-label="StackChips home">
        <StackChipsLogo className="header-logo" />
      </Link>
      <div className="header-actions">
        <GoldBadge profile={profile} />
        <Menu
          label="Open player menu"
          trigger={
            <span className="app-menu-profile-trigger">
              <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
              <strong className="app-menu-player-name">{profile.displayName}</strong>
            </span>
          }
          items={items}
        />
      </div>
    </header>
  );
}
