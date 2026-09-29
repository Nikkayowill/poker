-- A personal, reusable "add me" code -- the shortest path from "we just
-- played" to friends once the two of you are no longer seated at the same
-- table. Today the only way to add someone is the friends drawer's "At this
-- table" row, which disappears the moment either of you leaves; there is no
-- search and no other way to hand someone your identity.
--
-- One code per profile, not one-time-use: it's meant to be handed out more
-- than once over its life (texted to a partner, dropped in a group chat),
-- the same way a Discord or Steam friend link works. Regenerating replaces
-- it outright -- there is no history of retired codes to keep.
--
-- Redeeming a code creates the friendship directly, with no request/accept
-- step. That's a deliberate difference from friend_requests: possessing the
-- code already means its owner chose to share it, so the consent an accept
-- step would otherwise collect has already happened.

create table public.friend_invite_codes (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  -- 10 characters from the same ambiguity-free alphabet generateRoomCode()
  -- uses (lib/game/engine.ts), just longer -- this code is reusable rather
  -- than single-use, so it is worth making harder to stumble onto by chance.
  code text not null unique check (code ~ '^[A-Z0-9]{10}$'),
  created_at timestamptz not null default now()
);

comment on table public.friend_invite_codes is
  'One reusable "add me" code per profile. Redeeming it creates the friendship directly (no request/accept step) -- see lib/server/friends-store.ts.';

alter table public.friend_invite_codes enable row level security;

-- Same posture as the rest of the M16 social tables: no policies, no grants.
-- Reachable only through the service role, from routes that have already
-- identified the caller by their river_session cookie.
revoke all on public.friend_invite_codes from anon, authenticated;
