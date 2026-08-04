-- M16: friends, blocks, and table invites.
--
-- Schema only. Nothing in lib/server or components reads these yet; the
-- routes and the invite UI land on top of this. Everything here is reachable
-- through the service role alone, exactly like the M15 archive tables --
-- browsers send intents to API routes and never touch these directly.
--
-- The identity is public.profiles.id throughout, not auth.uid(). StackChips'
-- default player is a guest whose profile has a null user_id by design, so
-- keying friendship on the auth user would exclude the primary player. This
-- is the same reason the private-Realtime work is blocked; see the note in
-- docs/game-loop.md before deciding these tables can carry RLS policies.

-- ---------------------------------------------------------------------------
-- Blocks come first: the other three tables all defer to them.
-- ---------------------------------------------------------------------------

create table public.profile_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  -- Directional on purpose, and NOT canonically ordered: "A blocked B" is a
  -- different fact from "B blocked A", and both can be true at once.
  constraint profile_blocks_not_self check (blocker_id <> blocked_id)
);

comment on table public.profile_blocks is
  'Directional block list. Unlike friendships this is deliberately not canonically ordered -- a block has a direction and both directions can exist independently.';

create index profile_blocks_blocked_idx on public.profile_blocks(blocked_id);

-- ---------------------------------------------------------------------------
-- Requests.
-- ---------------------------------------------------------------------------

create type public.friend_request_status as enum ('pending', 'accepted', 'declined', 'cancelled');

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.friend_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (requester_id <> addressee_id),
  -- A terminal row records when it became terminal; a pending one has not.
  constraint friend_requests_responded_at_matches_status check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

-- The partial index is the whole concurrency story for requests.
--
-- Only ONE pending request may exist between an ordered pair, but any number
-- of settled ones may: people decline and ask again, and a full unique
-- constraint would make the second ask fail forever. Partial on status keeps
-- history while making a duplicate pending request a database error rather
-- than something every caller has to remember to check for.
create unique index friend_requests_one_pending_per_pair
  on public.friend_requests(requester_id, addressee_id)
  where status = 'pending';

-- Stops the crossed-request race: A asks B while B is asking A. Without this
-- both rows are legal -- they are different ordered pairs -- and accepting
-- both would try to write the same friendship twice.
create unique index friend_requests_one_pending_per_unordered_pair
  on public.friend_requests(
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where status = 'pending';

create index friend_requests_addressee_pending_idx
  on public.friend_requests(addressee_id, created_at desc)
  where status = 'pending';

comment on table public.friend_requests is
  'Directional friend requests. At most one pending row per unordered pair; settled rows are kept as history.';

-- ---------------------------------------------------------------------------
-- Friendships.
-- ---------------------------------------------------------------------------

create table public.friendships (
  -- Canonical ordering: the lower uuid is always profile_a. A friendship is
  -- symmetric, so storing it twice -- or storing it in whichever order the
  -- accepting request happened to arrive in -- means every read has to check
  -- both columns and every uniqueness guarantee has a hole in it. The check
  -- constraint is what makes the primary key below actually mean "one row per
  -- pair"; without it (a,b) and (b,a) are two different primary keys.
  profile_a uuid not null references public.profiles(id) on delete cascade,
  profile_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_a, profile_b),
  constraint friendships_canonical_order check (profile_a < profile_b)
);

comment on table public.friendships is
  'Symmetric friendships, stored once in canonical order (profile_a < profile_b). Writers must order the pair before inserting; the check constraint rejects them if they do not.';
comment on constraint friendships_canonical_order on public.friendships is
  'Makes the (profile_a, profile_b) primary key mean one row per pair rather than one row per direction.';

-- Reading "my friends" means matching either column, so both need an index;
-- the primary key only covers profile_a.
create index friendships_profile_b_idx on public.friendships(profile_b, created_at desc);

-- ---------------------------------------------------------------------------
-- Table invites.
-- ---------------------------------------------------------------------------

create type public.table_invite_status as enum ('pending', 'accepted', 'declined', 'expired', 'revoked');

create table public.table_invites (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  -- The private table's join code, carried server-side.
  --
  -- This column is why nothing here is granted to anon/authenticated. The
  -- one-tap invite flow is meant to hand the invitee a working join without
  -- ever showing either party the code, so the code travels in the row and
  -- the accept route reads it -- a browser that could select from this table
  -- could enumerate live private rooms.
  room_code text not null check (room_code ~ '^[A-Z0-9]{6}$'),
  status public.table_invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  constraint table_invites_not_self check (inviter_id <> invitee_id),
  constraint table_invites_expiry_after_creation check (expires_at > created_at),
  constraint table_invites_responded_at_matches_status check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

-- One live invite per (inviter, invitee, table). Partial for the same reason
-- as friend_requests: re-inviting someone to the same table after they
-- declined, or after an invite expired, has to stay possible.
create unique index table_invites_one_pending_per_target
  on public.table_invites(game_id, inviter_id, invitee_id)
  where status = 'pending';

-- The invitee's "you have been invited" list, and the expiry sweep.
create index table_invites_invitee_pending_idx
  on public.table_invites(invitee_id, created_at desc)
  where status = 'pending';
create index table_invites_expiry_idx
  on public.table_invites(expires_at)
  where status = 'pending';

-- Deliberately no FK to public.games, matching hand_archives: a table that
-- gets reaped must not cascade-delete the invite rows a sweep still needs to
-- mark expired. The accept route resolves game_id at redemption time and
-- fails cleanly when the table has gone.
comment on table public.table_invites is
  'One-tap invites to a private table. Carries the room code server-side so neither party is shown it; no FK to games so table cleanup cannot delete invite history.';

-- ---------------------------------------------------------------------------
-- Access. Same posture as the M15 archive tables.
-- ---------------------------------------------------------------------------

alter table public.profile_blocks enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.table_invites enable row level security;

-- No policies and no grants: every one of these is reachable only through the
-- service role, from API routes that have already identified the caller by
-- their river_session cookie. RLS is enabled anyway so that a later grant
-- cannot silently expose whole tables -- with RLS on and no policy, a grant
-- alone still returns nothing.
revoke all on public.profile_blocks from anon, authenticated;
revoke all on public.friend_requests from anon, authenticated;
revoke all on public.friendships from anon, authenticated;
revoke all on public.table_invites from anon, authenticated;
