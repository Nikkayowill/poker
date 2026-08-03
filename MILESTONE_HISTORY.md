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

## Current Claude Code handoff

- Documented active slice: M12 follow-up for felt cosmetics and responsive seat/card geometry. M12 and the geometry polish are at `HEAD`; verification/next-slice choice is pending.
- Current uncommitted work also includes an M14 follow-up that funds the replacement bot after a busted human's rebuy grace expires, with regression coverage for all three seat-release paths.
- Other uncommitted cleanup: StackChips display/storage naming migration and a stronger admin-secret storage assertion. Legacy `river_*` cookies/modules and Sentry identifiers remain compatibility IDs unless deliberately migrated.
- Treat these items as in progress, not landed, until tests pass and commits exist. Preserve the dirty worktree.

## Next proposed track

See `FUTURE_M15_M19.md`: hand history, friends/invites, safe table communication, missions/rewards, then sit-and-go tournaments.
