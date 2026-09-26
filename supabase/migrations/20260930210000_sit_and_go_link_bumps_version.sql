-- Linking a Sit & Go table to its game now bumps the table's version.
--
-- The sweep that cancels a table stuck 'active' with no game reads the row,
-- then cancels it guarded on that version. A slow deal could link its game
-- in between, and the cancel would still land on a table that was now being
-- played, refunding everyone mid-tournament. With the link bumping the
-- version, that cancel loses the race instead.

create or replace function public.set_sit_and_go_game_id(p_table_id uuid, p_game_id uuid)
returns public.sit_and_go_tables
language sql
security definer
set search_path = public
as $$
  update public.sit_and_go_tables
  set game_id = p_game_id,
      version = version + 1
  where id = p_table_id
    and status = 'active'
    and game_id is null
  returning *;
$$;

revoke all on function public.set_sit_and_go_game_id(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_sit_and_go_game_id(uuid, uuid) to service_role;
