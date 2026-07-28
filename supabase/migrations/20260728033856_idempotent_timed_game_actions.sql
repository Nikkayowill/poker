-- Timed deadline advancement is intentionally optimistic: every seated browser can
-- wake at the same persisted deadline, but only one may commit that version.
-- Convert the expected concurrency loser into a normal false result so routine
-- timer races do not flood Postgres with propagated serialization errors.
create or replace function public.try_persist_timed_game_action(
  p_game_id uuid,
  p_expected_version bigint,
  p_state jsonb,
  p_action_type public.action_type,
  p_amount integer,
  p_actor_seat_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.persist_game_action(
    p_game_id,
    p_expected_version,
    p_state,
    p_action_type,
    p_amount,
    p_actor_seat_id
  );
  return true;
exception
  when serialization_failure then
    return false;
end;
$$;

revoke all on function public.try_persist_timed_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) from public, anon, authenticated;
grant execute on function public.try_persist_timed_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) to service_role;

comment on function public.try_persist_timed_game_action(
  uuid, bigint, jsonb, public.action_type, integer, uuid
) is
  'Persists one deadline action and returns false, rather than raising 40001, when another request won the version race.';
