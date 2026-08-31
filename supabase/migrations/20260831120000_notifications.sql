-- In-app notifications: a friend request landing, a friend request being
-- accepted, an achievement unlocking, a mission completing.
--
-- Schema only, same posture as M16's friend tables
-- (20260804120000_friends_and_table_invites.sql): reachable only through the
-- service role, nothing here is granted to anon/authenticated. The identity
-- is public.profiles.id, not auth.uid(), for the same reason every other
-- social table here is keyed that way -- StackChips' default player is a
-- guest with no auth user to key against.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'friend_request_received',
    'friend_request_accepted',
    'achievement_unlocked',
    'mission_completed'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.notifications is
  'A player''s in-app notification feed: friend requests/adds, achievement and mission unlocks. Written only by lib/server/notifications-store.ts.';

-- The inbox read: newest first, capped in the store (NOTIFICATIONS_PAGE_SIZE).
create index notifications_profile_created_idx
  on public.notifications(profile_id, created_at desc);

-- The unread badge count and "mark all read": a partial index rather than a
-- full one on (profile_id, read_at), since only the unread rows are ever
-- queried by this predicate and a read notification never needs to be found
-- this way again.
create index notifications_profile_unread_idx
  on public.notifications(profile_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- No policies and no grants, matching every other social table here: RLS is
-- enabled so a later grant cannot silently expose the whole table, but there
-- is no policy for it to expose anything through today.
revoke all on public.notifications from anon, authenticated;
