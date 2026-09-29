-- archiveStaleGames (lib/server/game-store.ts) sweeps for
-- status = 'playing' order by updated_at asc limit 25 -- the oldest still-
-- "playing" tables, to archive the ones nothing is coming back to. Neither
-- existing index fits: games_updated_at_idx sorts every status descending
-- (wrong direction, no status filter), and games_public_open_idx is scoped to
-- is_private = false and sorts by created_at (wrong column, and this sweep
-- has to catch private tables too). Games are never deleted, only flagged
-- archived/complete, so the sweep query gets slower precisely because
-- cleanup never removes rows -- a partial index scoped to the one status this
-- query cares about stays small regardless of how much history piles up.

create index games_playing_updated_at_idx
  on public.games(updated_at)
  where status = 'playing';
