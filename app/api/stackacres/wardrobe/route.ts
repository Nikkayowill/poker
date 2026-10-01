import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buyOwnedItem, listOwnedCosmetics } from "@/lib/server/cosmetics-store";
import { ensureProfile, stackAcresActionGate } from "@/lib/server/profile-store";
import { publicErrorMessage } from "@/lib/server/public-error";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken, withRequestSessionCookie } from "@/lib/server/session";
import { stackacresLocked, tokenHasStackAcresAccess } from "@/lib/server/stackacres-access";
import { readFarmerWardrobe, writeFarmerWardrobe } from "@/lib/server/wardrobe-store";
import { WARDROBE_CATALOGUE } from "@/lib/stackacres/wardrobe/catalogue";
import { normalizeLook, readWardrobe, wardrobeCosmeticId, wardrobeItem } from "@/lib/stackacres/wardrobe/look";
import { OUTFIT_SLOTS, type FarmerWardrobeState } from "@/lib/stackacres/wardrobe/types";

export const runtime = "nodejs";

/** Paid wardrobe items this player owns, as player_cosmetics ids. */
async function ownedWardrobe(profileId: string): Promise<Set<string>> {
  return new Set((await listOwnedCosmetics(profileId)).filter((id) => id.startsWith("farmer:")));
}

async function wardrobeView(profileId: string) {
  const [raw, owned] = await Promise.all([readFarmerWardrobe(profileId), ownedWardrobe(profileId)]);
  return {
    wardrobe: readWardrobe(raw, WARDROBE_CATALOGUE, owned),
    owned: [...owned],
    // Never saved a look: the farm offers "make your farmer" once.
    chosen: raw !== undefined,
  };
}

/** The farmer's look, saved outfits and bought extras. Read-only: never mints a session. */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "stackacres:wardrobe:read", 60, 60 * 1000);
  if (limited) return limited;
  const token = readSessionToken(request);
  if (!token || !(await tokenHasStackAcresAccess(token))) return stackacresLocked();
  try {
    const profile = await ensureProfile(token);
    return NextResponse.json(await wardrobeView(profile.id));
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Could not load your look.") }, { status: 500 });
  }
}

const lookSchema = z.object({ body: z.string(), picks: z.record(z.string(), z.unknown()) });
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-look"), look: lookSchema }),
  z.object({ action: z.literal("save-outfit"), slot: z.number().int().min(0).max(OUTFIT_SLOTS - 1), look: lookSchema.nullable() }),
  z.object({ action: z.literal("buy"), item: z.string().min(1).max(64) }),
]);

/**
 * Wearing a look, saving or clearing an outfit slot, or buying an extra. Every
 * look is checked against the catalogue and what the player owns; a paid item
 * is priced from the catalogue on the server and bought in one locked step.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "stackacres:wardrobe:act", 30, 60 * 1000);
  if (limited) return limited;
  const token = readSessionToken(request);
  if (!token) return stackacresLocked();
  const gate = await stackAcresActionGate(token);
  if (!gate.access) return stackacresLocked();
  if (gate.banned) return NextResponse.json({ error: "This account can't do that." }, { status: 403 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a valid wardrobe action." }, { status: 400 });
  const body = parsed.data;

  try {
    const profile = await ensureProfile(token);
    if (body.action === "buy") {
      const item = wardrobeItem(WARDROBE_CATALOGUE, body.item);
      if (!item || item.price === null) {
        return NextResponse.json({ error: "That isn't for sale." }, { status: 400 });
      }
      const owned = await ownedWardrobe(profile.id);
      if (owned.has(wardrobeCosmeticId(item.id))) {
        return NextResponse.json({ error: "You already have that." }, { status: 409 });
      }
      const bought = await buyOwnedItem(token, profile, wardrobeCosmeticId(item.id), item.price);
      return withRequestSessionCookie(request, NextResponse.json({ ...(await wardrobeView(profile.id)), profile: bought.profile }), token);
    }

    const [raw, owned] = await Promise.all([readFarmerWardrobe(profile.id), ownedWardrobe(profile.id)]);
    const current = readWardrobe(raw, WARDROBE_CATALOGUE, owned);
    const look = body.look === null ? null : normalizeLook(body.look, WARDROBE_CATALOGUE, owned);
    if (body.look !== null && look === null) {
      return NextResponse.json({ error: "That look isn't available." }, { status: 400 });
    }
    let next: FarmerWardrobeState;
    if (body.action === "save-look") {
      next = { ...current, look: look! };
    } else {
      const outfits = [...current.outfits];
      outfits[body.slot] = look;
      next = { ...current, outfits };
    }
    await writeFarmerWardrobe(profile.id, next);
    return withRequestSessionCookie(request, NextResponse.json(await wardrobeView(profile.id)), token);
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Could not save your look.") }, { status: 400 });
  }
}
