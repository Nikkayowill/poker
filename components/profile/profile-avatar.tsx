"use client";

import { useState } from "react";
import clsx from "clsx";
import Image from "next/image";
import { Settings2 } from "lucide-react";
import { avatarFace, cosmeticById } from "@/lib/cosmetics/catalog";
import type { PlayerProfile } from "@/lib/profile/types";
import { missingArtwork } from "@/components/artwork-cache";

export type AvatarView = Pick<PlayerProfile, "displayName" | "initials" | "avatarUrl" | "avatarPreset" | "accent">
  & { avatarCosmetic: string };

export function ProfileAvatar({
  profile,
  className,
}: {
  profile: AvatarView;
  className?: string;
}) {
  const [, forceRerender] = useState(0);
  // The head crop, not the figure: this is always drawn as a small circle.
  const declared = cosmeticById(profile.avatarCosmetic) ? avatarFace(profile.avatarCosmetic) : null;
  // Six seats can wear the same avatar, so remember a missing file once
  // rather than firing a failed request per seat, per render.
  const artwork = declared && !missingArtwork.has(declared) ? declared : null;
  return (
    <span
      className={clsx(
        "profile-avatar",
        className,
        profile.avatarUrl ? "has-avatar-image" : "has-avatar-figure",
      )}
      style={{
        "--avatar-accent": profile.accent,
        ...(profile.avatarUrl ? { backgroundImage: `url("${profile.avatarUrl}")` } : {}),
      } as React.CSSProperties}
      role="img"
      aria-label={`${profile.displayName}'s avatar`}
    >
      {/* An uploaded photo wins outright. Otherwise the monogram is always
          rendered underneath and the artwork lays over it, so a file that is
          missing, still loading, or slow never leaves an empty disc where a
          player should be -- no dependency on an error firing in time. */}
      {!profile.avatarUrl && (
        <>
          <span className="avatar-initials">{profile.initials}</span>
          {artwork && (
            <Image
              src={artwork}
              alt=""
              fill
              sizes="72px"
              className="avatar-art"
              onError={() => {
                missingArtwork.add(artwork);
                forceRerender((n) => n + 1);
              }}
            />
          )}
        </>
      )}
    </span>
  );
}

export function ProfileTrigger({
  profile,
  onClick,
  compact = false,
}: {
  profile: PlayerProfile;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button className={clsx("profile-trigger", compact && "profile-trigger-compact")} onClick={onClick}>
      <ProfileAvatar profile={{ ...profile, avatarCosmetic: profile.equipped.avatar2d }} />
      {!compact && (
        <span>
          <strong>{profile.displayName}</strong>
          <small>Profile</small>
        </span>
      )}
      <Settings2 size={14} />
    </button>
  );
}
