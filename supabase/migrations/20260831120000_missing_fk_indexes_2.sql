-- Second pass on unindexed-foreign-key findings from the Supabase performance
-- advisor (2026-08-31); the 2026-08-19 pass (missing_fk_indexes.sql) covered
-- what existed then, these are the ones added since. cash_game_sessions has
-- one too but that table's store is still dead code (see that migration's
-- own note) -- skipped again for the same reason, still nothing to query it.
--
-- winner_id/opponent_id here all reference profiles(id); head_to_head_records'
-- is ON DELETE CASCADE. Without these, deleting a profile (delete_profiles,
-- admin-only but real -- 22 calls averaging 125ms in pg_stat_statements) has
-- to seq-scan cribbage_tables/heads_up_tables/sit_and_go_tables/
-- head_to_head_records to find rows that reference it, and any future
-- "games this player won" style lookup pays the same cost.
create index if not exists cribbage_tables_winner_id_idx
  on public.cribbage_tables (winner_id);

create index if not exists heads_up_tables_winner_id_idx
  on public.heads_up_tables (winner_id);

create index if not exists sit_and_go_tables_winner_id_idx
  on public.sit_and_go_tables (winner_id);

create index if not exists head_to_head_records_opponent_id_idx
  on public.head_to_head_records (opponent_id);

create index if not exists sit_and_go_tables_game_id_idx
  on public.sit_and_go_tables (game_id);

create index if not exists sit_and_go_table_players_token_idx
  on public.sit_and_go_table_players (token);

create index if not exists achievement_grants_achievement_code_idx
  on public.achievement_grants (achievement_code);
