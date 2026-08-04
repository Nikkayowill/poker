# StackChips milestone history

Short handoff ledger derived from Git history through 2026-08-01. Milestones were not always implemented in number order.

| Milestone | Landed outcome |
| --- | --- |
| M1 | First-time guests receive a profile before the lobby opens. |
| M2 | Added no-flop-no-drop rake behavior and rule tests. |
| M3/M3a | Declared design tokens, repaired responsive breakpoint ownership, documented landscape constraints, and prevented E2E runs against a real database. |
| M4 | Added the menu/dropdown and room share flow; reduced the table HUD and lobby header. |
| M5 | Rebuilt a stable action bar and closed the mobile nameplate-overlap defect (D1). |
| M6 | Added showdown hand labels and the seat-mounted turn-clock burn. |
| M7/M7a | Standardized the Realtime invalidation envelope and moved pot/stakes out of the felt HUD. |
| M8 | Dealing now animates from the deck instead of from beneath each seat. |
| M9 | Highlights the exact winning five cards; documented the client-ignited/server-validated loop. |
| M10 | Represents the pot as chip art on the felt and corrected payout-flight geometry. |
| M11 | Added the table sound mix and distinct local turn cue. |
| M12 | Equipped card-back cosmetics now render on hidden felt cards. |
| M13 | Completed hands auto-deal through persisted deadlines, browser prompts, and optimistic server writes. |
| M14a | Repeatedly inactive humans are released; their stacks return to Gold and a bot takes the seat. |
| M14b | The seat a busted player leaves behind is funded again when their rebuy grace expires. |

## Current Claude Code handoff

- Updated 2026-08-04. The August 1 entries above are the historical record and are unchanged.
- Documented active slice: M16, friends and table invites. Everything through M14b is committed and verified.
- M15's server half is now committed (`114b643`): the `hand_archives` / `hand_archive_players` migration and `archive_hand` RPC, `lib/server/hand-archive-store.ts` with its memory-mode mirror, and `GET /api/history` plus `GET /api/history/[gameId]/[hand]`. There is still no history UI.
- M16's friends half is **uncommitted in the working tree**: `lib/server/friends-store.ts` and its tests, `lib/server/api-auth.ts`, `/api/friends/*`, `lib/social/types.ts`, `components/social/friends-drawer.tsx` with `app/styles/21-friends.css`, `Seat.profileId` through the engine and snapshot, and the `accept_friend_request` + `revoke_archive_hand_from_public` migrations. Table invites are schema-only.
- Landed alongside it: `lib/server/hand-completion.ts`, the single `onHandCompleted` hook both completion paths now call. It replaced two `recordHandStats` call sites that had drifted — the human-action path never checked avatar unlocks, so a player who ended their own hand had unlocks evaluated late, whenever a later hand happened to end on a bot action or a timeout instead.
- Also landed: `lib/supabase/public-env.ts` resolves the browser-safe key from either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`, the prerequisite `FUTURE_M15_M19.md` names for M15.
- The card-redaction rule now lives in one exported place, `lib/game/engine.ts`'s `seatCardsWereShown`, read by both `toSnapshot` and the archiver. Do not add a second copy: a replay that unmucks folded cards is a silent leak.
- Treat these items as in progress, not landed, until commits exist. Preserve the dirty worktree.

## Next proposed track

See `FUTURE_M15_M19.md`: hand history, friends/invites, safe table communication, missions/rewards, then sit-and-go tournaments.
