import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeAvatar } from "@/lib/avatar/catalog";
import { ensureProfile, updateProfile } from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(18),
  avatarPreset: z.enum(["ace", "crown", "diamond", "lucky", "bolt", "river"]),
  // Loosely typed on the way in and tightened by normalizeAvatar, which
  // drops anything unrecognised: a client cannot invent a hairstyle, and an
  // older client that omits a newer category still saves cleanly.
  avatar: z.record(z.string(), z.unknown()).optional(),
  accent: z.enum(["#e7c66a", "#c08dff", "#ff9e78", "#79c9ff", "#65d6a2", "#f08ca7"]),
  clearUpload: z.boolean().optional(),
});

function withSession(response: NextResponse, token: string) {
  response.cookies.set("river_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:read", 120, 60 * 1000);
  if (limited) return limited;
  try {
    const token = request.cookies.get("river_session")?.value ?? randomUUID();
    const profile = await ensureProfile(token);
    return withSession(
      NextResponse.json({ profile, persistence: persistenceMode() }),
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:update", 20, 5 * 60 * 1000);
  if (limited) return limited;
  try {
    const token = request.cookies.get("river_session")?.value;
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Choose a valid name, avatar, and profile color." },
        { status: 400 },
      );
    }
    const profile = await updateProfile(token, {
      ...parsed.data,
      avatar: normalizeAvatar(parsed.data.avatar),
    });
    return NextResponse.json({ profile, persistence: persistenceMode() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
