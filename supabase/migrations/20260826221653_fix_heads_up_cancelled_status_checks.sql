-- Mirror image of the sit_and_go started_at fix: heads_up_tables_game_
-- matches_status and heads_up_tables_started_at_matches_status both grouped
-- 'cancelled' with 'waiting', requiring game_id/started_at to be null.
-- True for leave_heads_up_table's pre-deal cancel, but cancel_stale_
-- heads_up_table cancels an already-dealt 'active' table (game_id and
-- started_at both already set) straight to 'cancelled' without clearing
-- either -- so the very first stale-table sweep to catch an abandoned
-- heads-up match would hard-fail both constraints. Confirmed with a
-- rollback-safe repro against production (no row persisted). Fixed the same
-- way sit_and_go's own started_at constraint was: 'cancelled' is
-- unconstrained on both columns, since it can land there pre-deal (null) or
-- post-deal via the stale sweep (already set).
alter table public.heads_up_tables
  drop constraint heads_up_tables_game_matches_status,
  add constraint heads_up_tables_game_matches_status
  check (
    (status = 'waiting' and game_id is null)
    or (status in ('active', 'completed') and game_id is not null)
    or status = 'cancelled'
  );

alter table public.heads_up_tables
  drop constraint heads_up_tables_started_at_matches_status,
  add constraint heads_up_tables_started_at_matches_status
  check (
    (status = 'waiting' and started_at is null)
    or (status in ('active', 'completed') and started_at is not null)
    or status = 'cancelled'
  );
