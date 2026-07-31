-- Brings the trigger onto the same broadcast envelope as the TypeScript
-- publisher. The contract lives in lib/game/table-channel.ts; this function
-- and that file are the only two things that construct the payload, and the
-- browser parses both with one reader.
--
-- Still just an invalidation ping. Pot, street and stacks stay out of it on
-- purpose: the receiver re-fetches its own snapshot, which is the only place
-- per-viewer redaction happens, and the channel is public (a guest has no JWT
-- to authorize a private one against -- see the note in table-channel.ts).
--
-- The added fields are additive, and the browser accepts the old bare
-- {version} shape as envelope v0, so an app deployed ahead of this migration
-- keeps working rather than going quiet.

create or replace function public.broadcast_game_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'v', 1,
      'version', new.version,
      'updatedAt', to_char(
        new.updated_at at time zone 'utc',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    'TABLE_STATE_CHANGED',
    'table:' || new.game_id::text,
    false
  );
  return null;
end;
$$;

revoke all on function public.broadcast_game_signal() from public, anon, authenticated;
