-- Defense in depth for the server-authoritative data model. RLS already
-- denies browser access to these relations, but explicit privilege revocation
-- keeps private cards, session tokens and action history inaccessible even if
-- a policy is added incorrectly later.
revoke all privileges on table
  public.player_sessions,
  public.profiles,
  public.games,
  public.game_seats,
  public.game_state_private,
  public.game_actions,
  public.game_signals
from public, anon, authenticated;

-- This table contains only an opaque game id, version and update timestamp.
-- Browser clients need SELECT solely to receive filtered Realtime
-- invalidations before refetching their redacted snapshot from Next.js.
grant select on table public.game_signals to anon, authenticated;

-- No browser path inserts directly into identity-backed action sequences.
revoke all privileges on all sequences in schema public
from public, anon, authenticated;
