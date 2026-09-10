"use client";

import clsx from "clsx";
import Image from "next/image";
import { avatarFace, cosmeticById } from "@/lib/cosmetics/catalog";
import type { PlayerProfile } from "@/lib/profile/types";

export type AvatarView = Pick<PlayerProfile, "displayName" | "initials" | "avatarUrl" | "avatarPreset" | "accent">
  & { avatarCosmetic: string };

export function ProfileAvatar({
  profile,
  className,
}: {
  profile: AvatarView;
  className?: string;
}) {
  // The head crop, not the figure: this is always drawn as a small circle.
  const artwork = cosmeticById(profile.avatarCosmetic) ? avatarFace(profile.avatarCosmetic) : null;
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
      {/* An uploaded photo wins outright. Otherwise the monogram sits
          underneath and the artwork lays over it, so the disc is never empty
          while the file loads or when there is no cosmetic to draw. */}
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
            />
          )}
        </>
      )}
    </span>
  );
}
