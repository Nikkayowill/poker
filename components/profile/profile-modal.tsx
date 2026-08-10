"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import Link from "next/link";
import { Camera, Palette, Save, Upload, X } from "lucide-react";
import { profileAccents } from "@/lib/profile/types";
import type { AvatarPreset, PlayerProfile } from "@/lib/profile/types";
import { ProfileAvatar, type AvatarView } from "./profile-avatar";

export function ProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: PlayerProfile;
  onClose: () => void;
  onSaved: (profile: PlayerProfile) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  // Legacy field: still sent so the existing column stays populated, but the
  // layered avatar has replaced it as what players actually choose.
  const [avatarPreset] = useState<AvatarPreset>(profile.avatarPreset);
  const [accent, setAccent] = useState(profile.accent);
  const [previewUrl, setPreviewUrl] = useState<string | null>(profile.avatarUrl);
  const [usingUpload, setUsingUpload] = useState(Boolean(profile.avatarUrl));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [idCopied, setIdCopied] = useState(false);
  const copyPlayerId = async () => {
    try {
      await navigator.clipboard.writeText(profile.id);
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 1800);
    } catch {
      // Clipboard access can be denied by browser policy; the id is still visible to copy by hand.
    }
  };

  const preview: AvatarView = {
    displayName: displayName || "Player",
    initials: (displayName || "P").slice(0, 2).toUpperCase(),
    avatarUrl: usingUpload ? previewUrl : null,
    avatarPreset,
    accent,
    avatarCosmetic: profile.equipped.avatar2d,
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          avatarPreset,
          accent,
                clearUpload: !usingUpload,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save your profile.");
      onSaved(data.profile);
      setMessage("Profile saved");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("avatar", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not upload that image.");
      setPreviewUrl(data.profile.avatarUrl);
      setUsingUpload(true);
      onSaved(data.profile);
      setMessage("Photo uploaded");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not upload that image.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header className="profile-modal-header">
          <div>
            <span>PROFILE</span>
            <h2 id="profile-title">Edit player details</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close profile editor"><X size={18} /></button>
        </header>
        <form onSubmit={save}>
          <div className="profile-preview">
            <div className="avatar-stage">
              <ProfileAvatar profile={preview} />
              <label className="camera-button">
                <Camera size={15} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={upload}
                  disabled={uploading}
                />
              </label>
            </div>
            <div>
              <strong>{displayName || "Player"}</strong>
              <span>{usingUpload ? "Personal photo" : "Your table look"}</span>
              <label className="upload-button">
                <Upload size={13} /> {uploading ? "Uploading…" : "Upload photo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={upload}
                  disabled={uploading}
                />
              </label>
              <small>PNG, JPEG, WebP or GIF · 2 MB max</small>
            </div>
          </div>

          <div className="profile-field">
            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              value={displayName}
              maxLength={18}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
              required
            />
            <span>{displayName.length}/18</span>
          </div>

          <p className="avatar-hint">
            Avatars are chosen in the <Link href="/collection">Collection</Link>. Upload a photo
            above to use your own instead.
          </p>

          <fieldset className="accent-fieldset">
            <legend><Palette size={13} /> Table color</legend>
            <div className="accent-row">
              {profileAccents.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={accent === color ? "selected" : ""}
                  style={{ "--swatch": color } as React.CSSProperties}
                  onClick={() => setAccent(color)}
                  aria-label={`Use color ${color}`}
                />
              ))}
            </div>
          </fieldset>

          <div className="player-id-row">
            <span>
              <small>Player ID</small>
              <code>{profile.id}</code>
            </span>
            <button type="button" onClick={copyPlayerId}>
              {idCopied ? "Copied!" : "Copy"}
            </button>
          </div>

          <footer className="profile-modal-footer">
            <span className={message?.includes("saved") || message?.includes("uploaded") ? "success-message" : ""}>
              {message}
            </span>
            <button className="primary-action" type="submit" disabled={saving || uploading}>
              <Save size={15} /> {saving ? "Saving…" : "Save profile"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
