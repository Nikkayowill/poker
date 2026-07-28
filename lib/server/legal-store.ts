import "server-only";
import { adminClient } from "./supabase-admin";
import { currentVersion, type LegalDocumentSlug } from "@/lib/legal/documents";

declare global {
  var __riverRoomLegalAcceptances: Set<string> | undefined;
}

const memoryAcceptances = globalThis.__riverRoomLegalAcceptances ?? new Set<string>();
globalThis.__riverRoomLegalAcceptances = memoryAcceptances;

function memoryKey(profileId: string, slug: LegalDocumentSlug, version: number): string {
  return `${profileId}:${slug}:${version}`;
}

/**
 * Records that a profile accepted a document at its *current* version.
 * Idempotent: accepting twice (a duplicate submit, a retried request) is a
 * no-op, enforced by a unique constraint in Supabase and a Set in memory
 * mode -- the same shape as every other idempotent write in this app.
 */
export async function recordAcceptance(profileId: string, slug: LegalDocumentSlug): Promise<void> {
  const version = currentVersion(slug);
  const supabase = adminClient();
  if (!supabase) {
    memoryAcceptances.add(memoryKey(profileId, slug, version));
    return;
  }
  const { error } = await supabase.from("legal_acceptances").upsert(
    { profile_id: profileId, document: slug, version },
    { onConflict: "profile_id,document,version", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not record acceptance: ${error.message}`);
}

/** Whether a profile has accepted a document at the version currently in force. */
export async function hasAcceptedCurrent(profileId: string, slug: LegalDocumentSlug): Promise<boolean> {
  const version = currentVersion(slug);
  const supabase = adminClient();
  if (!supabase) {
    return memoryAcceptances.has(memoryKey(profileId, slug, version));
  }
  const { data, error } = await supabase
    .from("legal_acceptances")
    .select("profile_id")
    .eq("profile_id", profileId)
    .eq("document", slug)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new Error(`Could not check acceptance: ${error.message}`);
  return data !== null;
}

/**
 * Every document a profile still needs to accept at the current version --
 * empty once they have accepted all of them. Purchasing checks this itself
 * (belt and suspenders against a client that skipped the prompt); the UI
 * uses it to decide whether to show the prompt at all.
 */
export async function pendingAcceptances(profileId: string): Promise<LegalDocumentSlug[]> {
  const slugs: LegalDocumentSlug[] = ["terms_of_service", "gold_disclosure"];
  const results = await Promise.all(slugs.map((slug) => hasAcceptedCurrent(profileId, slug)));
  return slugs.filter((_, index) => !results[index]);
}
