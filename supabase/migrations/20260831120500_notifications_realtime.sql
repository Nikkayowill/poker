-- Realtime invalidation for notifications, on the same Broadcast pattern
-- broadcast_pvp_signal() established for PvP duels
-- (20260826231500_pvp_duel_realtime_signals.sql): a trigger sends a tiny
-- "something changed" ping, and the browser re-fetches its own snapshot from
-- GET /api/notifications rather than trusting anything in the payload.
--
-- notifications was never added to the supabase_realtime publication, so
-- there is no postgres_changes workload to retire here -- this goes straight
-- to Broadcast, same as the PvP table.
--
-- Channel is per-profile (`notify:<profileId>`), matching
-- lib/notifications/notification-channel.ts. profiles.id is documented in
-- lib/profile/types.ts as "stable, safe-to-share" -- a 122-bit UUID -- so
-- this is the same public-channel exposure argument table-channel.ts and
-- duel-channel.ts already make: a guessed profile id buys nothing but a
-- signal to re-fetch data that is itself gated server-side by the caller's
-- own session.
create or replace function public.broadcast_notification_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('v', 1),
    'NOTIFICATION_CREATED',
    'notify:' || new.profile_id::text,
    false
  );
  return null;
end;
$$;

drop trigger if exists broadcast_notification_signal_after_insert
  on public.notifications;

create trigger broadcast_notification_signal_after_insert
after insert on public.notifications
for each row execute function public.broadcast_notification_signal();

-- Same hardening every trigger function here gets (see
-- 20260813170000_revoke_pvp_trigger_function_execute.sql): Postgres invokes a
-- trigger function directly regardless of the firing role's EXECUTE grant, so
-- revoking it only closes the accidental
-- /rest/v1/rpc/broadcast_notification_signal call path, which would error on
-- NEW being unassigned anyway but shouldn't be reachable at all.
revoke execute on function public.broadcast_notification_signal() from public, anon, authenticated;
