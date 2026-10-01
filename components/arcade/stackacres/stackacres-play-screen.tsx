"use client";

import { useState } from "react";
import clsx from "clsx";
import { Music2, Settings2, User, Volume2, VolumeX, X } from "lucide-react";
import { playStackAcresMusic } from "@/lib/audio/stackacres-music";
import { tapSound, selectSound } from "@/lib/audio/ui-sounds";
import { useAppShell } from "@/components/shell/app-shell";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { StackAcresLogo } from "@/components/brand/stackacres-logo";
import { StackAcresCoverArt } from "./stackacres-cover-art";
import { ProfileModal } from "@/components/profile/profile-modal";
import type { PlayerProfile } from "@/lib/profile/types";

interface StackAcresPlayScreenProps {
  onStart: () => void;
  /** Loaded in the background by StackAcresFarm's own fetch effect, which
   * keeps running underneath this screen -- see that effect's comment. Null
   * until it resolves, so the Profile entry stays disabled rather than
   * opening on stale or missing data. */
  profile: PlayerProfile | null;
  onProfileSaved: (profile: PlayerProfile) => void;
}

type MenuView = "root" | "profile" | "settings";

/**
 * StackAcres' entry screen: Play / Profile / Settings, replacing the old
 * single tap-to-play affordance. All three stay on this screen -- nothing
 * here navigates back to the main StackChips lobby.
 *
 * - Play does exactly what the old tap-through did: starts the music, fades
 *   this screen, and calls onStart.
 * - Profile reuses the same ProfileModal the main lobby uses
 *   (components/profile/profile-modal.tsx) rather than a second profile UI.
 * - Settings is new: there was no settings surface StackAcres could reuse in
 *   place (the closest, the lobby's mobile-shell Settings section, is wired
 *   directly into that shell's own big prop list, not an importable
 *   component). It exposes the two real, already-wired app-wide toggles
 *   StackAcres itself already reads -- useAppShell's soundEnabled and
 *   musicEnabled (see stackacres-farm.tsx's own setFarmSfxMuted(!soundEnabled)
 *   effect) -- rather than inventing settings that don't map to anything.
 */
export function StackAcresPlayScreen({ onStart, profile, onProfileSaved }: StackAcresPlayScreenProps) {
  const [isActive, setIsActive] = useState(true);
  const [menu, setMenu] = useState<MenuView>("root");
  const { soundEnabled, toggleSound, musicEnabled, toggleMenuMusic } = useAppShell();

  const handlePlay = async () => {
    tapSound();
    await playStackAcresMusic();
    setIsActive(false);
    // Let the fade animation finish before calling onStart
    setTimeout(onStart, 300);
  };

  return (
    <div className={clsx("sa-play-screen", { "is-fading": !isActive })}>
      <StackAcresCoverArt />
      <div className="sa-play-content">
        <h1 className="sr-only">StackAcres</h1>
        <StackAcresLogo className="sa-play-logo" aria-hidden="true" />
        <p className="sa-play-subtitle">
          After a long grind at the tables, put your gold to work. Build a
          farm and watch it grow.
        </p>

        <div className="sa-play-menu">
          <button
            type="button"
            className="sa-play-menu-item sa-play-menu-primary"
            onClick={() => void handlePlay()}
          >
            Play
          </button>
          <button
            type="button"
            className="sa-play-menu-item"
            disabled={!profile}
            onClick={() => { tapSound(); setMenu("profile"); }}
          >
            <User size={16} aria-hidden="true" /> Profile
          </button>
          <button
            type="button"
            className="sa-play-menu-item"
            onClick={() => { tapSound(); setMenu("settings"); }}
          >
            <Settings2 size={16} aria-hidden="true" /> Settings
          </button>
        </div>
      </div>

      {menu === "profile" && profile && (
        <ProfileModal
          profile={profile}
          onClose={() => setMenu("root")}
          onSaved={(saved) => { onProfileSaved(saved); setMenu("root"); }}
        />
      )}

      {menu === "settings" && (
        <StackAcresSettingsPanel
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          musicEnabled={musicEnabled}
          onToggleMenuMusic={toggleMenuMusic}
          onClose={() => setMenu("root")}
        />
      )}
    </div>
  );
}

function StackAcresSettingsPanel({
  soundEnabled,
  onToggleSound,
  musicEnabled,
  onToggleMenuMusic,
  onClose,
}: {
  soundEnabled: boolean;
  onToggleSound: () => void;
  musicEnabled: boolean;
  onToggleMenuMusic: () => void;
  onClose: () => void;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section
        className="profile-modal htp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-settings-title"
      >
        <header className="profile-modal-header">
          <div>
            <span>STACKACRES</span>
            <h2 id="sa-settings-title">Settings</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={() => { tapSound(); onClose(); }}
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </header>
        <div className="htp-body">
          <button
            type="button"
            className="sa-settings-row"
            onClick={() => { selectSound(); onToggleSound(); }}
          >
            {soundEnabled ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
            <span className="sa-settings-row-label">Sound</span>
            <span className="sa-settings-row-value">{soundEnabled ? "On" : "Off"}</span>
          </button>
          <button
            type="button"
            className="sa-settings-row"
            onClick={() => { selectSound(); onToggleMenuMusic(); }}
          >
            <Music2 size={19} aria-hidden="true" />
            <span className="sa-settings-row-label">Menu music</span>
            <span className="sa-settings-row-value">{musicEnabled ? "On" : "Off"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
