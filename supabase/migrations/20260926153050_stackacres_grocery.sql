/* -------------------------------------------------------------------- */
/* The city grocery, once a player owns it                              */
/* -------------------------------------------------------------------- */

-- One row per owner. Owning it is development-only until the purchase
-- story is built (lib/stackacres/grocery.ts), so production gets the
-- table empty.
--
-- staff: the names of who works there (lib/stackacres-td/store-cast.ts).
-- layout: its fixtures and decor, [{id, kind, tx, ty}] with tx/ty null for
--   anything in storage. Where each may go is application code's call
--   (lib/stackacres/grocery-layout.ts).
-- till_*: what the till had banked when the store's rate last changed, and
--   when it was last emptied. The server works out what it holds from these
--   and the time (lib/stackacres/grocery-economy.ts); nothing ticks here.
-- collected: every Gold ever paid out of the till, for the owner's records.
-- version: bumped by every write. Each write names the version it read
--   and changes nothing if the row has moved on since, so a hire, a move
--   and emptying the till can never undo one another, and the till is
--   paid out at most once for what it held.
create table public.empire_grocery (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  staff text[] not null default '{}',
  layout jsonb not null default '[]'::jsonb check (jsonb_typeof(layout) = 'array'),
  till_takings double precision not null default 0 check (till_takings >= 0),
  till_wages double precision not null default 0 check (till_wages >= 0),
  till_since timestamptz not null default now(),
  till_opened_at timestamptz not null default now(),
  collected bigint not null default 0 check (collected >= 0),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.empire_grocery is
  'The city grocery a profile owns: its staff, fixtures and decor, and its till. Written only by the service, each write guarded on version. Service-role only.';

alter table public.empire_grocery enable row level security;
revoke all on public.empire_grocery from public, anon, authenticated;
