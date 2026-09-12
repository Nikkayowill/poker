/**
 * Whether the StackAcres hub tile advertises itself to players who haven't
 * been granted access yet -- the locked "Coming soon" card in
 * components/lobby/lobby.tsx and components/lobby/mobile-shell.tsx. Off by
 * default: the game is still an invite-only tryout (docs/launch-checklist.md),
 * and a locked teaser card is still advertising a feature to the public.
 *
 * A profile with `stackacresAccess` already granted gets a live tile
 * regardless of this flag, in every environment -- this only decides what
 * everyone else sees where that tile would be: the locked placeholder when
 * `true`, or nothing at all when `false`. It has no bearing on whether
 * `/games/stackacres` itself is reachable; that stays gated by
 * `tokenHasStackAcresAccess` (and, in local dev only,
 * `STACKACRES_DEV_BYPASS_ACCESS`) exactly as before.
 */
export const STACKACRES_TILE_ADVERTISED = process.env.NEXT_PUBLIC_STACKACRES_TILE_ADVERTISED === "1";
