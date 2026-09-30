"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { playStackAcresMusic } from "@/lib/audio/stackacres-music";
import { tapSound, toggleSound } from "@/lib/audio/ui-sounds";
import { useAppShell } from "@/components/shell/app-shell";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { useFloorBack } from "@/components/arcade/floor-back-link";
import { StackAcresLogo } from "@/components/brand/stackacres-logo";
import { ProfileModal } from "@/components/profile/profile-modal";
import type { PlayerProfile } from "@/lib/profile/types";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";

interface StackAcresPlayScreenProps {
  onStart: () => void;
  /** Loads in the background under this screen; null until it arrives. */
  profile: PlayerProfile | null;
  onProfileSaved: (profile: PlayerProfile) => void;
}

type MenuView = "root" | "settings" | "profile" | "credits";

/**
 * The title screen: Play, Settings, Credits and Leave over the Homestead at
 * golden hour. Settings and Credits open over this screen; Leave goes back to
 * the arcade the same way the farm's back link does.
 */
export function StackAcresPlayScreen({ onStart, profile, onProfileSaved }: StackAcresPlayScreenProps) {
  const [isActive, setIsActive] = useState(true);
  const [menu, setMenu] = useState<MenuView>("root");
  const { soundEnabled, toggleSound: toggleAppSound, musicEnabled, toggleMenuMusic } = useAppShell();
  const leave = useFloorBack();

  const handlePlay = async () => {
    tapSound();
    await playStackAcresMusic();
    setIsActive(false);
    // Let the fade finish before the farm takes over.
    setTimeout(onStart, 300);
  };

  const open = (view: MenuView) => {
    tapSound();
    setMenu(view);
  };

  return (
    <div className={clsx("sa-play-screen", { "is-fading": !isActive })}>
      <div className="sa-play-content">
        <h1 className="sr-only">StackAcres</h1>
        <StackAcresLogo variant="stacked" className="sa-play-logo" aria-hidden="true" alt="" />
        <nav className="sa-play-menu" aria-label="StackAcres">
          <button type="button" className="sa-play-go" onClick={() => void handlePlay()}>
            Play
          </button>
          <div className="sa-play-row">
            <button type="button" className="sa-play-item" onClick={() => open("settings")}>
              Settings
            </button>
            <button type="button" className="sa-play-item" onClick={() => open("credits")}>
              Credits
            </button>
            <button
              type="button"
              className="sa-play-item"
              onClick={() => {
                tapSound();
                leave();
              }}
            >
              <StackAcresPixelIcon name="back" />
              Leave
            </button>
          </div>
        </nav>
      </div>
      <p className="sa-play-foot">A StackChips game</p>

      {menu === "settings" && (
        <StackAcresSettingsPanel
          soundEnabled={soundEnabled}
          onToggleSound={toggleAppSound}
          musicEnabled={musicEnabled}
          onToggleMenuMusic={toggleMenuMusic}
          profileReady={profile !== null}
          onEditProfile={() => open("profile")}
          onClose={() => setMenu("root")}
        />
      )}

      {menu === "profile" && profile && (
        <ProfileModal
          profile={profile}
          onClose={() => setMenu("settings")}
          onSaved={(saved) => {
            onProfileSaved(saved);
            setMenu("settings");
          }}
        />
      )}

      {menu === "credits" && <StackAcresCreditsPanel onClose={() => setMenu("root")} />}
    </div>
  );
}

function StackAcresSettingsPanel({
  soundEnabled,
  onToggleSound,
  musicEnabled,
  onToggleMenuMusic,
  profileReady,
  onEditProfile,
  onClose,
}: {
  soundEnabled: boolean;
  onToggleSound: () => void;
  musicEnabled: boolean;
  onToggleMenuMusic: () => void;
  profileReady: boolean;
  onEditProfile: () => void;
  onClose: () => void;
}) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section className="profile-modal htp-modal" role="dialog" aria-modal="true" aria-labelledby="sa-settings-title">
        <header className="profile-modal-header">
          <div>
            <h2 id="sa-settings-title">Settings</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={() => {
              tapSound();
              onClose();
            }}
            aria-label="Close settings"
          >
            <StackAcresPixelIcon name="close" />
          </button>
        </header>
        <div className="htp-body">
          <button
            type="button"
            className="sa-settings-row"
            onClick={() => {
              toggleSound();
              onToggleSound();
            }}
          >
            <StackAcresPixelIcon name={soundEnabled ? "sound" : "mute"} />
            <span className="sa-settings-row-label">Sound</span>
            <span className="sa-settings-row-value">{soundEnabled ? "On" : "Off"}</span>
          </button>
          <button
            type="button"
            className="sa-settings-row"
            onClick={() => {
              toggleSound();
              onToggleMenuMusic();
            }}
          >
            <StackAcresPixelIcon name={musicEnabled ? "sound" : "mute"} />
            <span className="sa-settings-row-label">Menu music</span>
            <span className="sa-settings-row-value">{musicEnabled ? "On" : "Off"}</span>
          </button>
          <button type="button" className="sa-settings-row" disabled={!profileReady} onClick={onEditProfile}>
            <StackAcresPixelIcon name="journal" />
            <span className="sa-settings-row-label">Player profile</span>
            <span className="sa-settings-row-value">Edit</span>
          </button>
        </div>
      </section>
    </div>
  );
}

const CAST_ARTISTS =
  "Benjamin K. Smith (BenCreating), bluecarrot16, Durrani, Eliza Wyatt (ElizaWy), Evert, Inboxninja, " +
  "JaidynReiman, Joe White, Johannes Sjölund (wulax), Manuel Riecke (MrBeast), Marcel van de Steeg (MadMarcel), " +
  "Matthew Krohn (makrohn), Michael Whitlock (bigbeargames), MuffinElZangano, Napsio (Vitruvian Studio), " +
  "Nila122, Pierre Vigier (pvigier), Stephen Challener (Redshrike), TheraHedwig and Tuomo Untinen (reemax)";

const LAND_ARTISTS =
  "Lanea Zimmerman (Sharm), Daniel Eddeland, Casper Nilsson, Johann Charlot, Skyler Robert Colladay, " +
  "Stephen Challener (Redshrike), Charles Sanchez (CharlesGabriel), Manuel Riecke (MrBeast) and " +
  "Daniel Armstrong (HughSpectrum)";

function StackAcresCreditsPanel({ onClose }: { onClose: () => void }) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={onBackdropMouseDown}>
      <section
        className="profile-modal htp-modal sa-credits"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-credits-title"
      >
        <header className="profile-modal-header">
          <div>
            <h2 id="sa-credits-title">Credits</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={() => {
              tapSound();
              onClose();
            }}
            aria-label="Close credits"
          >
            <StackAcresPixelIcon name="close" />
          </button>
        </header>
        <div className="htp-body">
          <h3>StackAcres</h3>
          <p>Made for StackChips. The logo, menus and icons are drawn for the farm in its own pixel art.</p>
          <h3>The people</h3>
          <p>
            Built from the Universal LPC Spritesheet Character Generator, art from the Liberated Pixel Cup on
            OpenGameArt. Drawn by {CAST_ARTISTS}. CC0, OGA-BY 3.0, CC-BY 3.0 and CC-BY 4.0.
          </p>
          <h3>The land</h3>
          <p>Ground, water, paths and props use Liberated Pixel Cup art by {LAND_ARTISTS}. CC-BY-SA 3.0 and GPL 3.0.</p>
          <h3>Lettering</h3>
          <p>Pixelify Sans by Stefie Justprince and Baloo 2 by Ek Type, both under the SIL Open Font License.</p>
          <p>
            <Link href="/credits" prefetch={false}>
              Every credit, layer by layer
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
