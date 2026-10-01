import "server-only";
import type { FarmerWardrobeState } from "@/lib/stackacres/wardrobe/types";
import { adminClient } from "./supabase-admin";

declare global {
  var __riverRoomFarmerWardrobe: Map<string, unknown> | undefined;
}

/** Memory-mode wardrobes, keyed by profile id. */
const memoryWardrobe = globalThis.__riverRoomFarmerWardrobe ?? new Map<string, unknown>();
globalThis.__riverRoomFarmerWardrobe = memoryWardrobe;

/**
 * The farmer's stored wardrobe, raw: `profiles.avatar_config.farmer`. That
 * column was added for a layered avatar that never shipped and nothing else
 * reads it. Undefined when the player has never saved a look. The caller
 * checks it against the catalogue (lib/stackacres/wardrobe/look.ts).
 */
export async function readFarmerWardrobe(profileId: string): Promise<unknown> {
  const supabase = adminClient();
  if (!supabase) return memoryWardrobe.get(profileId);
  const { data, error } = await supabase.from("profiles").select("avatar_config").eq("id", profileId).maybeSingle();
  if (error) throw new Error(`Could not read your look: ${error.message}`);
  const config = (data as { avatar_config?: unknown } | null)?.avatar_config;
  return config && typeof config === "object" ? (config as Record<string, unknown>).farmer : undefined;
}

/** Saves the farmer's wardrobe, keeping anything else in avatar_config. A look is cosmetic, so the last save wins. */
export async function writeFarmerWardrobe(profileId: string, state: FarmerWardrobeState): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryWardrobe.set(profileId, state);
    return;
  }
  const { data, error } = await supabase.from("profiles").select("avatar_config").eq("id", profileId).maybeSingle();
  if (error) throw new Error(`Could not save your look: ${error.message}`);
  const current = (data as { avatar_config?: unknown } | null)?.avatar_config;
  const config = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
  const { error: writeError } = await supabase
    .from("profiles")
    .update({ avatar_config: { ...config, farmer: state } })
    .eq("id", profileId);
  if (writeError) throw new Error(`Could not save your look: ${writeError.message}`);
}
