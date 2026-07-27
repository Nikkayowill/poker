import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Shared gate for every /api/admin/* route. Comparing SHA-256 digests
 * (always 32 bytes) rather than the raw strings keeps timingSafeEqual valid
 * regardless of either string's length, without leaking length via an early
 * mismatch. Unset ADMIN_SECRET disables every admin route outright.
 */
export function isAdminAuthorized(request: NextRequest): boolean {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) return false;
  const provided = request.headers.get("x-admin-secret") ?? "";
  const providedHash = createHash("sha256").update(provided).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(providedHash, configuredHash);
}
