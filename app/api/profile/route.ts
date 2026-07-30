import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile, updateProfile } from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  readOrCreateSessionToken,
  readSessionToken,
  withRequestSessionCookie,
} from "@/lib/server/session";

export const runtime = "nodejs";

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(18),
  avatarPreset: z.enum([
    "ace",
    "crown",
    "diamond",
    "lucky",
    "bolt",
    "river",
  ]),
  accent: z.enum([
    "#e7c66a",
    "#c08dff",
    "#ff9e78",
    "#79c9ff",
    "#65d6a2",
    "#f08ca7",
  ]),
  clearUpload: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(
    request,
    "profile:read",
    120,
    60 * 1000,
  );

  if (limited) return limited;

  try {
    const token = readSessionToken(request);

    if (!token) {
      return NextResponse.json({
        profile: null,
        persistence: persistenceMode(),
      });
    }

    const profile = await ensureProfile(token);

    return NextResponse.json({
      profile,
      persistence: persistenceMode(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load your profile.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(
    request,
    "profile:create",
    10,
    60 * 1000,
  );

  if (limited) return limited;

  try {
    const token = readOrCreateSessionToken(request);
    const profile = await ensureProfile(token);

    return withRequestSessionCookie(
      request,
      NextResponse.json({
        profile,
        persistence: persistenceMode(),
      }),
      token,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not create your profile.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const limited = enforceRateLimit(
    request,
    "profile:update",
    20,
    5 * 60 * 1000,
  );

  if (limited) return limited;

  try {
    const token = readSessionToken(request);

    if (!token) {
      return NextResponse.json(
        { error: "Your profile session expired." },
        { status: 401 },
      );
    }

    const parsed = updateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Choose a valid name, avatar, and profile color.",
        },
        { status: 400 },
      );
    }

    const profile = await updateProfile(token, parsed.data);

    return NextResponse.json({
      profile,
      persistence: persistenceMode(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not save your profile.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}