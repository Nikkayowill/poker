-- Realtime invalidation for PvP duels, on the same Broadcast pattern
-- broadcast_game_signal() established for the poker table
-- (game_signal_broadcast.sql / broadcast_envelope_v1.sql): a trigger sends a
-- tiny "something changed" ping, and the browser re-fetches its own snapshot
-- rather than trusting anything in the payload.
--
-- Neither pvp_challenges nor pvp_matches was ever added to the
-- supabase_realtime publication, so unlike game_signals there is no
-- postgres_changes workload to retire here -- this goes straight to
-- Broadcast.
--
-- One function serves both tables rather than one apiece, because the two
-- differ only in which columns name the participants (challenger_id/
-- opponent_id vs player0_id/player1_id) and TG_TABLE_NAME is enough to branch
-- on that. A challenge and a match don't share a single monotonic version
-- counter the way one poker table's rows do, so the payload carries none --
-- see lib/pvp/duel-channel.ts for why the client doesn't need one either.
--
-- Channel is per-profile (`pvp:<profileId>`), not per-match: before a match
-- exists there is no id to key on, and a player needs to hear about a new or
-- accepted challenge just as much as an opponent's move. profiles.id is
-- documented in lib/profile/types.ts as "stable, safe-to-share" -- a 122-bit
-- UUID -- so this is the same public-channel exposure argument
-- table-channel.ts already makes for a table id: a guessed profile id buys
-- nothing but a signal to re-fetch data that is itself gated server-side by
-- the caller's own session.
create or replace function public.broadcast_pvp_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_id uuid;
  second_id uuid;
begin
  if tg_table_name = 'pvp_challenges' then
    first_id := new.challenger_id;
    second_id := new.opponent_id;
  elsif tg_table_name = 'pvp_matches' then
    first_id := new.player0_id;
    second_id := new.player1_id;
  else
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object('v', 1),
    'PVP_STATE_CHANGED',
    'pvp:' || first_id::text,
    false
  );

  if second_id is not null then
    perform realtime.send(
      jsonb_build_object('v', 1),
      'PVP_STATE_CHANGED',
      'pvp:' || second_id::text,
      false
    );
  end if;

  return null;
end;
$$;

drop trigger if exists broadcast_pvp_signal_after_challenge_write
  on public.pvp_challenges;

create trigger broadcast_pvp_signal_after_challenge_write
after insert or update on public.pvp_challenges
for each row execute function public.broadcast_pvp_signal();

drop trigger if exists broadcast_pvp_signal_after_match_write
  on public.pvp_matches;

create trigger broadcast_pvp_signal_after_match_write
after insert or update on public.pvp_matches
for each row execute function public.broadcast_pvp_signal();

-- Same hardening every trigger function here gets (see
-- 20260813170000_revoke_pvp_trigger_function_execute.sql): Postgres invokes a
-- trigger function directly regardless of the firing role's EXECUTE grant, so
-- revoking it only closes the accidental /rest/v1/rpc/broadcast_pvp_signal
-- call path, which would error on NEW being unassigned anyway but shouldn't
-- be reachable at all.
revoke execute on function public.broadcast_pvp_signal() from public, anon, authenticated;
