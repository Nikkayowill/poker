import { NextRequest, NextResponse } from "next/server";
import { saveAvatar } from "@/lib/server/profile-store";
import { persistenceMode } from "@/lib/server/game-store";
import { detectImage, readImageDimensions, MAX_AVATAR_DIMENSION, MAX_AVATAR_PIXELS } from "@/lib/profile/image";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readSessionToken } from "@/lib/server/session";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "profile:avatar", 8, 10 * 60 * 1000);
  if (limited) return limited;
  try {
    const token = readSessionToken(request);
    if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });
    const form = await request.formData();
    const file = form.get("avatar");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: "Avatar images must be 2 MB or smaller." }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImage(bytes);
    if (!detected) {
      return NextResponse.json(
        { error: "Use a PNG, JPEG, WebP, or GIF image." },
        { status: 415 },
      );
    }
    const dimensions = readImageDimensions(bytes, detected.contentType);
    if (
      !dimensions ||
      dimensions.width <= 0 ||
      dimensions.height <= 0 ||
      dimensions.width > MAX_AVATAR_DIMENSION ||
      dimensions.height > MAX_AVATAR_DIMENSION ||
      dimensions.width * dimensions.height > MAX_AVATAR_PIXELS
    ) {
      return NextResponse.json(
        { error: `Use an image no larger than ${MAX_AVATAR_DIMENSION}x${MAX_AVATAR_DIMENSION}.` },
        { status: 422 },
      );
    }
    const profile = await saveAvatar(token, bytes, detected.contentType, detected.extension);
    return NextResponse.json({ profile, persistence: persistenceMode() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload that avatar.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
