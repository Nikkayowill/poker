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

/** A brand new profile's starting balance, and the flat amount a daily claim grants. */
const STARTING_GOLD = 2000;
const DAILY_GOLD_GRANT = 1000;

function publicProfile(profile: StoredProfile): PlayerProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    initials: profile.initials,
    avatarUrl: profile.avatarUrl,
    avatarPreset: profile.avatarPreset,
    accent: profile.accent,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    goldBalance: profile.goldBalance,
    unlimitedGold: profile.unlimitedGold,
    lastDailyClaimAt: profile.lastDailyClaimAt,
  };
}

function defaultProfile(displayName = "Player"): StoredProfile {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    displayName,
    initials: initials(displayName),
    avatarUrl: null,
    avatarPath: null,
    avatarPreset: "ace",
    accent: "#e7c66a",
    createdAt: now,
    updatedAt: now,
    goldBalance: STARTING_GOLD,
    unlimitedGold: false,
    lastDailyClaimAt: null,
  };
}

function fromRow(row: Record<string, unknown>): StoredProfile {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    initials: String(row.initials),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    avatarPath: row.avatar_path ? String(row.avatar_path) : null,
    avatarPreset: String(row.avatar_preset) as AvatarPreset,
    accent: String(row.accent),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    goldBalance: Number(row.gold_balance),
    unlimitedGold: Boolean(row.unlimited_gold),
    lastDailyClaimAt: row.last_daily_claim_at ? String(row.last_daily_claim_at) : null,
  };
}

/** UTC calendar-day comparison -- "daily" resets at midnight UTC, not per-user local time. */
function isSameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
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

/**
 * Deducts `amount` Gold, or does nothing if the profile is flagged
 * `unlimitedGold`. Throws if the balance is insufficient. The Supabase path
 * uses the `spend_gold` RPC (a guarded single UPDATE) rather than a
 * read-then-write, so two concurrent spends can't both pass a balance check
 * against the same stale read and drive the balance negative.
 */
export async function spendGold(token: string, amount: number): Promise<PlayerProfile> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid Gold amount.");
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (!current) throw new Error("Profile not found.");
    if (!current.unlimitedGold && current.goldBalance < amount) throw new Error("Not enough Gold.");
    const next: StoredProfile = {
      ...current,
      goldBalance: current.unlimitedGold ? current.goldBalance : current.goldBalance - amount,
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data, error } = await supabase.rpc("spend_gold", { p_token: token, p_amount: amount }).single();
  if (error) throw new Error(`Could not spend Gold: ${error.message}`);
  const result = data as { success: boolean; gold_balance: number } | null;
  if (!result?.success) throw new Error("Not enough Gold.");
  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("session_token", token)
    .single();
  if (readError) throw new Error(`Could not load profile: ${readError.message}`);
  return publicProfile(fromRow(row));
}

/**
 * Refunds a prior spendGold call that turned out not to buy anything (e.g.
 * a seat-claim or rebuy that failed to persist after Gold was already
 * deducted). This is a rare error-recovery path, not the spend hot path, so
 * it uses a plain read-then-write rather than a guarded RPC -- a slight
 * race here would only ever over-refund in the player's favor.
 */
export async function creditGold(token: string, amount: number): Promise<PlayerProfile> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid Gold amount.");
  const now = new Date().toISOString();
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (!current) throw new Error("Profile not found.");
    const next: StoredProfile = { ...current, goldBalance: current.goldBalance + amount, updatedAt: now };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data: current, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("session_token", token)
    .single();
  if (readError) throw new Error(`Could not load profile: ${readError.message}`);
  const { data, error } = await supabase
    .from("profiles")
    .update({ gold_balance: Number(current.gold_balance) + amount, updated_at: now })
    .eq("session_token", token)
    .select("*")
    .single();
  if (error) throw new Error(`Could not credit Gold: ${error.message}`);
  return publicProfile(fromRow(data));
}

/**
 * Credits the flat daily amount once per UTC calendar day. Throws if
 * already claimed today rather than silently no-op-ing, so the client can
 * tell the difference between "claimed" and "nothing happened."
 */
export async function claimDailyGold(token: string): Promise<PlayerProfile> {
  const supabase = adminClient();
  const now = new Date();
  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (!current) throw new Error("Profile not found.");
    if (current.lastDailyClaimAt && isSameUtcDay(new Date(current.lastDailyClaimAt), now)) {
      throw new Error("You already claimed your daily Gold today.");
    }
    const next: StoredProfile = {
      ...current,
      goldBalance: current.goldBalance + DAILY_GOLD_GRANT,
      lastDailyClaimAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data, error } = await supabase
    .rpc("claim_daily_gold", { p_token: token, p_amount: DAILY_GOLD_GRANT })
    .single();
  if (error) throw new Error(`Could not claim Gold: ${error.message}`);
  const result = data as { gold_balance: number; claimed: boolean } | null;
  if (!result?.claimed) throw new Error("You already claimed your daily Gold today.");
  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("session_token", token)
    .single();
  if (readError) throw new Error(`Could not load profile: ${readError.message}`);
  return publicProfile(fromRow(row));
}

/**
 * Every profile, newest first -- the closest thing this authless app has to
 * a "signups" list, since a profile is created the moment a new visitor's
 * session cookie is first seen (see ensureProfile). Used only by the
 * admin dashboard, so a flat cap replaces real pagination.
 */
export async function listProfiles(): Promise<PlayerProfile[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryProfiles.values()]
      .map(publicProfile)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Could not list profiles: ${error.message}`);
  return (data ?? []).map((row) => publicProfile(fromRow(row)));
}

/** Flags (or unflags) a profile so spendGold never actually deducts from it -- for gifting a specific person free play. */
export async function setUnlimitedGold(profileId: string, unlimited: boolean): Promise<void> {
  const supabase = adminClient();
  const now = new Date().toISOString();
  if (!supabase) {
    const entry = [...memoryProfiles.entries()].find(([, stored]) => stored.id === profileId);
    if (!entry) throw new Error("Profile not found.");
    const [token, current] = entry;
    memoryProfiles.set(token, { ...current, unlimitedGold: unlimited, updatedAt: now });
    return;
  }
  const { data, error } = await supabase
    .from("profiles")
    .update({ unlimited_gold: unlimited, updated_at: now })
    .eq("id", profileId)
    .select("id");
  if (error) throw new Error(`Could not update Gold flag: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Profile not found.");
}
