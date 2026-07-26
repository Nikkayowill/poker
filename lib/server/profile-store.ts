import "server-only";
import { randomUUID } from "crypto";
import { avatarPresets, profileAccents } from "@/lib/profile/types";
import type { AvatarPreset, PlayerProfile, ProfileUpdate } from "@/lib/profile/types";
import { adminClient } from "./game-store";

interface StoredProfile extends PlayerProfile {
  avatarPath: string | null;
}

declare global {
  var __riverRoomProfiles: Map<string, StoredProfile> | undefined;
}

const memoryProfiles = globalThis.__riverRoomProfiles ?? new Map<string, StoredProfile>();
globalThis.__riverRoomProfiles = memoryProfiles;

function initials(displayName: string) {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function publicProfile(profile: StoredProfile): PlayerProfile {
  return {
    displayName: profile.displayName,
    initials: profile.initials,
    avatarUrl: profile.avatarUrl,
    avatarPreset: profile.avatarPreset,
    accent: profile.accent,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function defaultProfile(displayName = "Player"): StoredProfile {
  const now = new Date().toISOString();
  return {
    displayName,
    initials: initials(displayName),
    avatarUrl: null,
    avatarPath: null,
    avatarPreset: "ace",
    accent: "#e7c66a",
    createdAt: now,
    updatedAt: now,
  };
}

function fromRow(row: Record<string, unknown>): StoredProfile {
  return {
    displayName: String(row.display_name),
    initials: String(row.initials),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    avatarPath: row.avatar_path ? String(row.avatar_path) : null,
    avatarPreset: String(row.avatar_preset) as AvatarPreset,
    accent: String(row.accent),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function ensureProfile(token: string, preferredName?: string): Promise<PlayerProfile> {
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (current) return publicProfile(current);
    const created = defaultProfile(preferredName);
    memoryProfiles.set(token, created);
    return publicProfile(created);
  }

  const displayName = preferredName?.trim() || "Player";
  const { error: sessionError } = await supabase.from("player_sessions").upsert(
    { token, display_name: displayName, last_seen_at: new Date().toISOString() },
    { onConflict: "token", ignoreDuplicates: true },
  );
  if (sessionError) throw new Error(`Could not initialize profile: ${sessionError.message}`);

  const { data: existing, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("session_token", token)
    .maybeSingle();
  if (readError) throw new Error(`Could not load profile: ${readError.message}`);
  if (existing) return publicProfile(fromRow(existing));

  const profile = defaultProfile(displayName);
  const { data, error } = await supabase
    .from("profiles")
    .insert({
      session_token: token,
      display_name: profile.displayName,
      initials: profile.initials,
      avatar_preset: profile.avatarPreset,
      accent: profile.accent,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Could not create profile: ${error.message}`);
  return publicProfile(fromRow(data));
}

export async function updateProfile(token: string, update: ProfileUpdate): Promise<PlayerProfile> {
  const validPreset = avatarPresets.some((preset) => preset.id === update.avatarPreset);
  const validAccent = profileAccents.includes(update.accent as (typeof profileAccents)[number]);
  if (!validPreset || !validAccent) throw new Error("That profile style is not available.");
  const displayName = update.displayName.trim();
  const now = new Date().toISOString();
  const supabase = adminClient();

  if (!supabase) {
    const current = memoryProfiles.get(token) ?? defaultProfile(displayName);
    const next: StoredProfile = {
      ...current,
      displayName,
      initials: initials(displayName),
      avatarPreset: update.avatarPreset,
      accent: update.accent,
      avatarUrl: update.clearUpload ? null : current.avatarUrl,
      avatarPath: update.clearUpload ? null : current.avatarPath,
      updatedAt: now,
    };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  await ensureProfile(token, displayName);
  const { data: previous } = update.clearUpload
    ? await supabase
        .from("profiles")
        .select("avatar_path")
        .eq("session_token", token)
        .single()
    : { data: null };
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      initials: initials(displayName),
      avatar_preset: update.avatarPreset,
      accent: update.accent,
      ...(update.clearUpload ? { avatar_url: null, avatar_path: null } : {}),
      updated_at: now,
    })
    .eq("session_token", token)
    .select("*")
    .single();
  if (error) throw new Error(`Could not save profile: ${error.message}`);
  await supabase
    .from("player_sessions")
    .update({ display_name: displayName, last_seen_at: now })
    .eq("token", token);
  if (update.clearUpload && previous?.avatar_path) {
    await supabase.storage.from("avatars").remove([String(previous.avatar_path)]);
  }
  return publicProfile(fromRow(data));
}

export async function saveAvatar(
  token: string,
  bytes: Uint8Array,
  contentType: string,
  extension: string,
): Promise<PlayerProfile> {
  await ensureProfile(token);
  const now = new Date().toISOString();
  const supabase = adminClient();
  if (!supabase) {
    const stored = memoryProfiles.get(token)!;
    stored.avatarUrl = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
    stored.avatarPath = "memory";
    stored.updatedAt = now;
    return publicProfile(stored);
  }

  const { data: previous } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("session_token", token)
    .single();
  const path = `${token}/avatar-${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
  if (uploadError) throw new Error(`Could not upload avatar: ${uploadError.message}`);
  const { data: publicUrl } = supabase.storage.from("avatars").getPublicUrl(path);

  const { data, error } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl.publicUrl, avatar_path: path, updated_at: now })
    .eq("session_token", token)
    .select("*")
    .single();
  if (error) {
    await supabase.storage.from("avatars").remove([path]);
    throw new Error(`Could not attach avatar: ${error.message}`);
  }

  const oldPath = previous?.avatar_path ? String(previous.avatar_path) : null;
  const stored = fromRow(data);
  if (oldPath && oldPath !== path) await supabase.storage.from("avatars").remove([oldPath]);
  return publicProfile(stored);
}
