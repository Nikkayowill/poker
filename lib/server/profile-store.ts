import "server-only";
import { randomUUID } from "crypto";
import { avatarPresets, profileAccents } from "@/lib/profile/types";
import type { AvatarPreset, PlayerProfile, ProfileUpdate, PublicProfileSummary } from "@/lib/profile/types";
import { defaultEquipped, normalizeEquipped, type EquippedCosmetics } from "@/lib/cosmetics/catalog";
import { BACKSTOP_COOLDOWN_MS, BACKSTOP_GRANT } from "@/lib/profile/backstop";
import { adminClient } from "./supabase-admin";

// isRegistered is omitted and derived from userId in publicProfile, so the
// owning account is the single source of truth rather than a flag that can
// drift out of sync with it.
interface StoredProfile extends Omit<PlayerProfile, "isRegistered"> {
  avatarPath: string | null;
  /** Last broke-player recovery grant, rate limited separately from the daily claim. */
  lastBackstopAt: string | null;
  /** Owning auth account, or null while this is still a guest profile. */
  userId: string | null;
  /** Admin-only moderation fields -- never leave publicProfile()'s shape. */
  banned: boolean;
  lastSeenIp: string | null;
}

/** The admin dashboard's view of a profile -- adds the moderation fields that publicProfile() deliberately omits from every player-facing response. */
export type AdminProfileSummary = PlayerProfile & {
  banned: boolean;
  lastSeenIp: string | null;
};

function adminProfileView(profile: StoredProfile): AdminProfileSummary {
  return { ...publicProfile(profile), banned: profile.banned, lastSeenIp: profile.lastSeenIp };
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

/**
 * A guest's starting balance. Registering (linking a real account) tops a
 * profile up to SIGNUP_GOLD_TARGET instead -- see linkProfileToUser -- so
 * the free-guest number and the signup number are deliberately different.
 */
const STARTING_GOLD = 2000;
const SIGNUP_GOLD_TARGET = 10000;
/**
 * The base daily grant, before any streak multiplier.
 *
 * Exported because the streak lives outside this module -- claimDailyGold takes
 * the already-multiplied amount, and lib/progression/streak.ts' dailyGrantFor
 * needs the base to multiply. Keeping the number here means the base is still
 * defined once, beside the profile it credits.
 */
export const DAILY_GOLD_GRANT = 1000;

function publicProfile(profile: StoredProfile): PlayerProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    initials: profile.initials,
    avatarUrl: profile.avatarUrl,
    avatarPreset: profile.avatarPreset,
    equipped: profile.equipped,
    accent: profile.accent,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    goldBalance: profile.goldBalance,
    unlimitedGold: profile.unlimitedGold,
    lastDailyClaimAt: profile.lastDailyClaimAt,
    lastBackstopAt: profile.lastBackstopAt,
    isRegistered: profile.userId !== null,
  };
}

/** The subset of publicProfile() that's safe to show about someone *else*. See PublicProfileSummary. */
function otherPlayerSummary(profile: StoredProfile): PublicProfileSummary {
  return {
    id: profile.id,
    displayName: profile.displayName,
    initials: profile.initials,
    avatarUrl: profile.avatarUrl,
    avatarPreset: profile.avatarPreset,
    accent: profile.accent,
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
    equipped: defaultEquipped,
    accent: "#e7c66a",
    createdAt: now,
    updatedAt: now,
    goldBalance: STARTING_GOLD,
    unlimitedGold: false,
    lastDailyClaimAt: null,
    userId: null,
    banned: false,
    lastSeenIp: null,
    lastBackstopAt: null,
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
    equipped: normalizeEquipped(row.equipped),
    accent: String(row.accent),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    goldBalance: Number(row.gold_balance),
    unlimitedGold: Boolean(row.unlimited_gold),
    lastDailyClaimAt: row.last_daily_claim_at ? String(row.last_daily_claim_at) : null,
    userId: row.user_id ? String(row.user_id) : null,
    banned: Boolean(row.banned),
    lastSeenIp: row.last_seen_ip ? String(row.last_seen_ip) : null,
    lastBackstopAt: row.last_backstop_at ? String(row.last_backstop_at) : null,
  };
}


/**
 * Memory-mode equip. Lives here because the profile map is module-private;
 * the Supabase path writes the column directly from the cosmetics store.
 */
export function setEquippedInMemory(token: string, equipped: EquippedCosmetics, now: string): void {
  const current = memoryProfiles.get(token);
  if (!current) return;
  memoryProfiles.set(token, { ...current, equipped, updatedAt: now });
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
  if (error) {
    // 23505 on profiles_session_token_key: somebody else created this
    // session's profile between the read above and this insert. The read is a
    // check-then-insert and cannot be made safe by checking harder -- the
    // whole window is between the two statements -- so the loser of the race
    // reads the winner's row instead of failing. Same shape the blackjack
    // rounds, friend requests and the challenge escrow already use: detect the
    // duplicate from the 23505, never by looking first.
    //
    // This is not a theoretical race. A single cookieless GET of a duel lobby
    // reproduces it on production: app/api/pvp/[game]/route.ts fans
    // readDuelMatch and listDuelChallenges out through Promise.all and both
    // call ensureProfile with the same brand-new token, so a first-time
    // visitor to /games/chess had a coin-toss chance of a 500 that said
    // "Could not create profile". Fixed here rather than by serialising that
    // route, because the same collision is reachable any time two requests
    // carrying one new cookie land together -- two tabs, a page issuing
    // parallel fetches, a retry overlapping its original.
    if (error.code === "23505") {
      const { data: raced, error: racedError } = await supabase
        .from("profiles")
        .select("*")
        .eq("session_token", token)
        .maybeSingle();
      if (racedError) throw new Error(`Could not load profile: ${racedError.message}`);
      if (raced) return publicProfile(fromRow(raced));
    }
    throw new Error(`Could not create profile: ${error.message}`);
  }
  return publicProfile(fromRow(data));
}

/**
 * Reads the profile behind a session without creating one.
 *
 * This is intentionally separate from ensureProfile: a cookie is client
 * supplied, so security-sensitive routes must not turn an unknown token into
 * a new server-side identity while trying to authenticate it.
 */
export async function findProfileBySessionToken(token: string): Promise<PlayerProfile | null> {
  if (!token) return null;

  const supabase = adminClient();
  if (!supabase) {
    const profile = memoryProfiles.get(token);
    return profile ? publicProfile(profile) : null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("session_token", token)
    .maybeSingle();
  if (error) throw new Error(`Could not validate profile session: ${error.message}`);
  return data ? publicProfile(fromRow(data)) : null;
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
 * Returns Gold to a player: a cash-out when they leave a table, or a refund
 * for a spend that bought nothing (a seat claim or rebuy that failed to
 * persist).
 *
 * The Supabase path uses the `credit_gold` RPC (a guarded read-lock-then-
 * write, mirroring `spend_gold`) rather than a read-then-write, for the same
 * reason `spendGold` does: two concurrent credits to the same token -- a
 * rebuy refund racing a cash-out credit, or two browser tabs -- could
 * otherwise both read the same stale balance, and the second write would
 * silently drop the first. This used to be a plain read-then-write on the
 * reasoning that a slight race here would only ever over-refund; in fact the
 * race under-credits (a lost update), and bot seats now carry deeper,
 * randomized stacks (see `randomBotStack` in `lib/game/engine.ts`), so the
 * amount a dropped credit could cost is no longer small.
 *
 * Mirrors spendGold's unlimited-Gold handling exactly, and must keep doing
 * so: an unlimited profile is never charged a buy-in, so paying its stack
 * back out would mint the buy-in on every sit-down/stand-up cycle.
 */
export async function creditGold(token: string, amount: number): Promise<PlayerProfile> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid Gold amount.");
  const now = new Date().toISOString();
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (!current) throw new Error("Profile not found.");
    if (current.unlimitedGold) return publicProfile(current);
    const next: StoredProfile = { ...current, goldBalance: current.goldBalance + amount, updatedAt: now };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data, error } = await supabase.rpc("credit_gold", { p_token: token, p_amount: amount }).single();
  if (error) throw new Error(`Could not credit Gold: ${error.message}`);
  const result = data as { success: boolean; gold_balance: number } | null;
  if (!result?.success) throw new Error("Profile not found.");
  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("session_token", token)
    .single();
  if (readError) throw new Error(`Could not load profile: ${readError.message}`);
  return publicProfile(fromRow(row));
}

/**
 * Credits the daily amount once per UTC calendar day. Throws if already
 * claimed today rather than silently no-op-ing, so the client can tell the
 * difference between "claimed" and "nothing happened."
 *
 * `amount` is a parameter rather than the constant because the streak
 * multiplier (lib/progression/streak.ts) is applied by the caller, which is the
 * only place that knows how many consecutive days this is. The once-per-day
 * rule is still decided here and inside claim_daily_gold, so a caller that
 * passes a larger amount cannot claim twice with it.
 */
export async function claimDailyGold(
  token: string,
  amount: number = DAILY_GOLD_GRANT,
): Promise<PlayerProfile> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid daily grant.");
  const supabase = adminClient();
  const now = new Date();
  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (!current) throw new Error("Profile not found.");
    // The recurring faucet requires an identity that survives a cleared
    // cookie. Guests keep their starter Gold and can play freely; only the
    // repeatable reward asks them to be someone, which converts on real
    // value and closes the obvious farming route in the same rule.
    if (!current.userId) throw new Error("Save your progress to claim daily Gold.");
    if (current.lastDailyClaimAt && isSameUtcDay(new Date(current.lastDailyClaimAt), now)) {
      throw new Error("You already claimed your daily Gold today.");
    }
    const next: StoredProfile = {
      ...current,
      goldBalance: current.goldBalance + amount,
      lastDailyClaimAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  // Checked here rather than inside the RPC so an unregistered player gets
  // told what to do about it, instead of the RPC's generic "already claimed".
  const { data: gate, error: gateError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("session_token", token)
    .single();
  if (gateError) throw new Error("Profile not found.");
  if (!gate.user_id) throw new Error("Save your progress to claim daily Gold.");

  const { data, error } = await supabase
    .rpc("claim_daily_gold", { p_token: token, p_amount: amount })
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
 * Attaches an authenticated account to the profile behind a session, turning
 * a guest into a registered player without disturbing their Gold, avatar or
 * history -- the session cookie stays the gameplay identity either way.
 *
 * Idempotent for the same account, and refuses to re-point a profile at a
 * different account, which would silently transfer one player's balance to
 * another.
 */
export async function linkProfileToUser(token: string, userId: string): Promise<PlayerProfile> {
  const now = new Date().toISOString();
  const supabase = adminClient();

  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (!current) throw new Error("Profile not found.");
    if (current.userId && current.userId !== userId) {
      throw new Error("This profile already belongs to another account.");
    }
    // The signup bonus fires exactly once, on the transition from guest
    // (userId null) to registered -- re-linking the same account later never
    // tops up again, and a profile that already earned or bought past
    // SIGNUP_GOLD_TARGET is never reduced.
    const isFirstLink = current.userId === null;
    const goldBalance = isFirstLink ? Math.max(current.goldBalance, SIGNUP_GOLD_TARGET) : current.goldBalance;
    const next: StoredProfile = { ...current, userId, goldBalance, updatedAt: now };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("session_token", token)
    .single();
  if (readError) throw new Error("Profile not found.");
  const current = fromRow(row);
  if (current.userId && current.userId !== userId) {
    throw new Error("This profile already belongs to another account.");
  }

  const isFirstLink = current.userId === null;
  const goldBalance = isFirstLink ? Math.max(current.goldBalance, SIGNUP_GOLD_TARGET) : current.goldBalance;

  const { data, error } = await supabase
    .from("profiles")
    .update({ user_id: userId, gold_balance: goldBalance, updated_at: now })
    .eq("session_token", token)
    .select("*")
    .single();
  if (error) throw new Error(`Could not link your account: ${error.message}`);
  return publicProfile(fromRow(data));
}

/**
 * Finds the profile an account already owns, along with the session token
 * that addresses it. Used to restore a returning player whose cookie is
 * gone: their browser gets pointed back at the profile they already have,
 * rather than starting over as a stranger.
 */
export async function findSessionByUserId(
  userId: string,
): Promise<{ token: string; profile: PlayerProfile } | null> {
  const supabase = adminClient();

  if (!supabase) {
    const entry = [...memoryProfiles.entries()].find(([, stored]) => stored.userId === userId);
    return entry ? { token: entry[0], profile: publicProfile(entry[1]) } : null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not look up your account: ${error.message}`);
  if (!data) return null;
  return { token: String(data.session_token), profile: publicProfile(fromRow(data)) };
}

/**
 * Tops a stranded player back up to one Micro buy-in. Only fires when they
 * genuinely cannot afford the cheapest seat, and only once per cooldown, so
 * it is a safety net rather than an income stream. Unlimited-Gold profiles
 * never need it and are rejected outright.
 */
export async function claimBackstopGold(token: string, threshold: number): Promise<PlayerProfile> {
  const now = new Date();
  const supabase = adminClient();

  const eligible = (balance: number, unlimited: boolean, lastAt: string | null) => {
    if (unlimited) throw new Error("You have unlimited Gold.");
    if (balance >= threshold) throw new Error("You still have enough Gold to sit down.");
    if (lastAt && now.getTime() - Date.parse(lastAt) < BACKSTOP_COOLDOWN_MS) {
      throw new Error("You've already had a top-up recently. Try again later.");
    }
  };

  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (!current) throw new Error("Profile not found.");
    eligible(current.goldBalance, current.unlimitedGold, current.lastBackstopAt);
    const next: StoredProfile = {
      ...current,
      goldBalance: current.goldBalance + BACKSTOP_GRANT,
      lastBackstopAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("session_token", token)
    .single();
  if (readError) throw new Error("Profile not found.");
  const current = fromRow(row);
  eligible(current.goldBalance, current.unlimitedGold, current.lastBackstopAt);

  const { data, error } = await supabase
    .from("profiles")
    .update({
      gold_balance: current.goldBalance + BACKSTOP_GRANT,
      last_backstop_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("session_token", token)
    // Only pay out if the balance is still under the threshold, so two
    // concurrent requests can't both pass the check above and double-grant.
    .lt("gold_balance", threshold)
    .select("*")
    .single();
  if (error) throw new Error("You've already had a top-up recently. Try again later.");
  return publicProfile(fromRow(data));
}

/**
 * Every profile, newest first -- the closest thing this authless app has to
 * a "signups" list, since a profile is created the moment a new visitor's
 * session cookie is first seen (see ensureProfile). Used only by the
 * admin dashboard, so a flat cap replaces real pagination.
 */
/**
 * Public profile fields for a batch of ids, keyed by id. Used to decorate a
 * leaderboard (built from player_stats/season_stats, which know nothing
 * about display names or avatars) without every reader needing to know the
 * profiles table's column names.
 */
export async function getPublicProfilesByIds(ids: string[]): Promise<Map<string, PublicProfileSummary>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const supabase = adminClient();
  if (!supabase) {
    const byId = new Map([...memoryProfiles.values()].map((profile) => [profile.id, profile]));
    return new Map(
      unique.flatMap((id) => {
        const profile = byId.get(id);
        return profile ? [[id, otherPlayerSummary(profile)] as const] : [];
      }),
    );
  }
  const { data, error } = await supabase.from("profiles").select("*").in("id", unique);
  if (error) throw new Error(`Could not load profiles: ${error.message}`);
  return new Map((data ?? []).map((row) => [String(row.id), otherPlayerSummary(fromRow(row))]));
}

const LIST_PROFILES_PAGE_SIZE = 1000;
// A safety backstop on the internal drain loop below, not a visibility cap --
// at 1000/page this is 500k profiles before the loop gives up and returns
// what it has, far past anything this app has seen.
const LIST_PROFILES_MAX_PAGES = 500;

export async function listProfiles(): Promise<AdminProfileSummary[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryProfiles.values()]
      .map(adminProfileView)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  // Was a flat `.limit(1000)` -- past 1000 signups the admin dashboard
  // silently couldn't see anyone older than that, with no way to page
  // further. This drains the whole table internally via a keyset cursor
  // (created_at, id) instead, so the dashboard's own "load everything, then
  // search/filter client-side" behavior keeps working unchanged. A plain
  // OFFSET-based page walk would do here too, except profiles are inserted
  // continuously (every new visitor mints one) -- paging by offset while
  // rows keep landing at the front shifts everything underneath the walk and
  // skips or repeats a row at each page boundary; a keyset cursor is what
  // the same problem was already solved with in hand-archive-store.ts.
  const all: AdminProfileSummary[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  for (let page = 0; page < LIST_PROFILES_MAX_PAGES; page += 1) {
    let query = supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(LIST_PROFILES_PAGE_SIZE);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(`Could not list profiles: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows.map((row) => adminProfileView(fromRow(row))));
    if (rows.length < LIST_PROFILES_PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    cursor = { createdAt: String(last.created_at), id: String(last.id) };
  }
  return all;
}

/** Cheap ban check -- called by every join-flow route and the actions route before letting a token do anything. */
export async function isBanned(token: string): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) return memoryProfiles.get(token)?.banned ?? false;
  const { data, error } = await supabase
    .from("profiles")
    .select("banned")
    .eq("session_token", token)
    .maybeSingle();
  if (error) throw new Error(`Could not check profile status: ${error.message}`);
  return Boolean(data?.banned);
}

/** Flags (or unflags) a profile so it can't join a table or act at one -- for blocking toxic players. */
export async function banProfile(profileId: string, banned: boolean): Promise<void> {
  const supabase = adminClient();
  const now = new Date().toISOString();
  if (!supabase) {
    const entry = [...memoryProfiles.entries()].find(([, stored]) => stored.id === profileId);
    if (!entry) throw new Error("Profile not found.");
    const [token, current] = entry;
    memoryProfiles.set(token, { ...current, banned, updatedAt: now });
    return;
  }
  const { data, error } = await supabase
    .from("profiles")
    .update({ banned, updated_at: now })
    .eq("id", profileId)
    .select("id");
  if (error) throw new Error(`Could not update ban status: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Profile not found.");
}

/**
 * Permanently erases up to 1,000 profiles in one atomic database operation.
 * Historical game seats and Stripe payments are retained but detached by
 * their foreign-key policies, while profile-owned cosmetics, stats and legal
 * acceptances cascade away with the profile.
 */
export async function deleteProfiles(profileIds: string[]): Promise<string[]> {
  const uniqueIds = [...new Set(profileIds)];
  if (uniqueIds.length === 0) throw new Error("Choose at least one profile.");
  if (uniqueIds.length > 1000) throw new Error("Delete at most 1,000 profiles at once.");

  const supabase = adminClient();
  if (!supabase) {
    const requested = new Set(uniqueIds);
    const deleted: string[] = [];
    for (const [token, stored] of memoryProfiles.entries()) {
      if (!requested.has(stored.id)) continue;
      memoryProfiles.delete(token);
      deleted.push(stored.id);
    }
    return deleted;
  }

  // Capture avatar object paths before the rows disappear. Object cleanup is
  // best-effort after the atomic database delete: a missing image must never
  // roll back or falsely report a profile that was already removed.
  const { data: candidates, error: candidateError } = await supabase
    .from("profiles")
    .select("id, avatar_path")
    .in("id", uniqueIds);
  if (candidateError) throw new Error(`Could not prepare profile deletion: ${candidateError.message}`);

  const { data, error } = await supabase.rpc("delete_profiles", {
    p_profile_ids: uniqueIds,
  });
  if (error) throw new Error(`Could not delete profiles: ${error.message}`);

  const deletedIds = Array.isArray(data) ? data.map(String) : [];
  const deletedSet = new Set(deletedIds);
  const avatarPaths = (candidates ?? [])
    .filter((row) => deletedSet.has(String(row.id)) && row.avatar_path)
    .map((row) => String(row.avatar_path));
  if (avatarPaths.length > 0) {
    await supabase.storage.from("avatars").remove(avatarPaths);
  }
  return deletedIds;
}

/** Single-profile compatibility wrapper used outside the bulk admin route. */
export async function deleteProfile(profileId: string): Promise<void> {
  const deletedIds = await deleteProfiles([profileId]);
  if (!deletedIds.includes(profileId)) throw new Error("Profile not found.");
}

/**
 * Stamps the IP a token most recently joined/hosted a table from -- an
 * admin-only signal for spotting multiple accounts played from the same
 * address (collusion/chip dumping), never surfaced to players. Best-effort:
 * callers swallow failures rather than let this block real play.
 */
export async function recordSeenIp(token: string, ip: string): Promise<void> {
  const supabase = adminClient();
  const now = new Date().toISOString();
  if (!supabase) {
    const current = memoryProfiles.get(token);
    if (!current) return;
    memoryProfiles.set(token, { ...current, lastSeenIp: ip, updatedAt: now });
    return;
  }
  await supabase
    .from("profiles")
    .update({ last_seen_ip: ip, updated_at: now })
    .eq("session_token", token);
}

/**
 * Admin override: adds (or, with a negative delta, subtracts) Gold directly
 * by profile id, clamped at 0. Bypasses spendGold's unlimited-Gold/
 * insufficient-funds guard entirely -- this is a manual correction tool (bug
 * fixes, tournament prizes), not a purchase.
 */
export async function adjustGold(profileId: string, delta: number): Promise<PlayerProfile> {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("Invalid Gold adjustment.");
  const now = new Date().toISOString();
  const supabase = adminClient();
  if (!supabase) {
    const entry = [...memoryProfiles.entries()].find(([, stored]) => stored.id === profileId);
    if (!entry) throw new Error("Profile not found.");
    const [token, current] = entry;
    const next: StoredProfile = {
      ...current,
      goldBalance: Math.max(0, current.goldBalance + delta),
      updatedAt: now,
    };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data: rpcData, error: rpcError } = await supabase
    .rpc("adjust_gold_by_profile", { p_profile_id: profileId, p_delta: delta })
    .single();
  if (rpcError) throw new Error(`Could not adjust Gold: ${rpcError.message}`);
  const result = rpcData as { success: boolean; gold_balance: number } | null;
  if (!result?.success) throw new Error("Profile not found.");

  const { data, error } = await supabase.from("profiles").select("*").eq("id", profileId).single();
  if (error) throw new Error(`Could not load profile: ${error.message}`);
  return publicProfile(fromRow(data));
}

/**
 * Debits a player identified by profile id, with the same row-lock guard as
 * `spendGold`. Returns null when the balance will not cover it.
 *
 * ## Why this exists alongside spendGold
 *
 * Every other Gold path here keys on the session token, because the mover and
 * the moved-to were always the same person and a cookie is a better key than
 * an id the request supplied. Player-versus-player settlement (lib/pvp/) is
 * the first case where they differ: a duel's pot has to reach the *winner*,
 * and the request that ends the match came from whoever moved last -- the
 * loser about half the time, and neither player on a timeout sweep.
 *
 * Deliberately NOT `adjustGold`, which also takes a profile id: that one is a
 * plain read-then-write with no lock, documented as an admin correction tool
 * for exactly that reason. Two clients settling the same match at once is a
 * real race here, not a theoretical one, so this goes through the guarded RPC.
 *
 * Returns null rather than throwing on an insufficient balance because the
 * caller has to distinguish "they cannot afford the ante" (an ordinary answer
 * a challenge lobby renders) from "the database is down".
 */
export async function spendGoldByProfile(
  profileId: string,
  amount: number,
): Promise<PlayerProfile | null> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid Gold amount.");
  const supabase = adminClient();
  if (!supabase) {
    const entry = [...memoryProfiles.entries()].find(([, stored]) => stored.id === profileId);
    if (!entry) return null;
    const [token, current] = entry;
    if (!current.unlimitedGold && current.goldBalance < amount) return null;
    const next: StoredProfile = {
      ...current,
      goldBalance: current.unlimitedGold ? current.goldBalance : current.goldBalance - amount,
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data, error } = await supabase
    .rpc("spend_gold_by_profile", { p_profile_id: profileId, p_amount: amount })
    .single();
  if (error) throw new Error(`Could not spend Gold: ${error.message}`);
  const result = data as { success: boolean; gold_balance: number } | null;
  if (!result?.success) return null;

  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .single();
  if (readError) throw new Error(`Could not load profile: ${readError.message}`);
  return publicProfile(fromRow(row));
}

/**
 * Credits a player identified by profile id, with the same row-lock guard as
 * `creditGold`. See `spendGoldByProfile` for why the id-keyed pair exists.
 *
 * Mirrors creditGold's unlimited-Gold handling exactly, and must keep doing
 * so. It bites harder here than anywhere else: an unlimited profile antes
 * nothing into a duel pot, so crediting one the pot would mint the loser's
 * stake out of nothing on every match.
 */
export async function creditGoldByProfile(
  profileId: string,
  amount: number,
): Promise<PlayerProfile | null> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid Gold amount.");
  const supabase = adminClient();
  if (!supabase) {
    const entry = [...memoryProfiles.entries()].find(([, stored]) => stored.id === profileId);
    if (!entry) return null;
    const [token, current] = entry;
    if (current.unlimitedGold) return publicProfile(current);
    const next: StoredProfile = {
      ...current,
      goldBalance: current.goldBalance + amount,
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(token, next);
    return publicProfile(next);
  }

  const { data, error } = await supabase
    .rpc("credit_gold_by_profile", { p_profile_id: profileId, p_amount: amount })
    .single();
  if (error) throw new Error(`Could not credit Gold: ${error.message}`);
  const result = data as { success: boolean; gold_balance: number } | null;
  if (!result?.success) return null;

  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .single();
  if (readError) throw new Error(`Could not load profile: ${readError.message}`);
  return publicProfile(fromRow(row));
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
