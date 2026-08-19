-- Covers the unindexed-foreign-key findings from the Supabase performance
-- advisor (2026-08-19), one per live table. cash_game_sessions also has one
-- but that table's store was deleted in the 2026-08-06 repo-quality pass
-- (CLAUDE.md) -- the migration stays append-only, but there's no code path
-- left to query it, so it's skipped here rather than indexed for nothing.
create index if not exists mission_reward_grants_mission_code_idx
  on public.mission_reward_grants (mission_code);

create index if not exists player_mission_progress_mission_code_idx
  on public.player_mission_progress (mission_code);

create index if not exists profile_badges_season_id_idx
  on public.profile_badges (season_id);

create index if not exists season_results_profile_id_idx
  on public.season_results (profile_id);

create index if not exists season_stats_profile_id_idx
  on public.season_stats (profile_id);

create index if not exists table_invites_inviter_id_idx
  on public.table_invites (inviter_id);
