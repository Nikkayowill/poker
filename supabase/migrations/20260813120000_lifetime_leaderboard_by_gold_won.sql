-- The all-time leaderboard now ranks player_stats by total_chips_won (Gold
-- won, lifetime, never nets out a loss) instead of net_profit -- see
-- lib/server/stats-store.ts's getLeaderboard. Seasons keep net_profit; only
-- the lifetime scope moved. player_stats had an index on net_profit for the
-- old sort but none on the column the query now orders by.

create index if not exists player_stats_total_chips_won_idx
  on public.player_stats (total_chips_won desc);
