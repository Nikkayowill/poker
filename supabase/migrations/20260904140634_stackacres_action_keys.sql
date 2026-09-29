-- Idempotency keys for the StackAcres action route.
--
-- Most of that route is already replay-safe and always has been: collect,
-- feed, water, clear and retire all mutate an existing unit under its own
-- `version`, and a lost race returns null and pays nothing. A double-tapped
-- harvest has never been able to credit twice.
--
-- The ones that CREATE something have no such guard, because there is no row
-- yet to guard. `stock` and `buy-stock` insert a unit and debit for it,
-- `buy-feed` adds servings and debits, `expand-capacity` buys a slot and
-- `clear-sector` buys land, both debiting Gold. A duplicate delivery of any of
-- those is a plain double spend that nothing in the schema can see. `sell` and
-- `exchange` are bounded (by the barn, by the daily ceiling) but still move
-- real produce and real Gold twice.
--
-- So this table is the natural key those requests do not otherwise have: the
-- client names its intent, and the primary key makes naming it twice free.
-- See lib/server/stackacres-intent-store.ts for the claim/complete/release
-- lifecycle this backs.

create table public.homestead_action_keys (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- The client's own name for one intent. Opaque here, and never trusted as
  -- identity: every read and write is scoped by profile_id as well, so one
  -- player's key says nothing about anyone else's.
  key text not null check (char_length(key) between 1 and 100),
  action text not null check (char_length(action) between 1 and 40),
  -- False between claim and completion. A duplicate arriving in that window is
  -- answered with the current farm, never with a refusal.
  done boolean not null default false,
  -- Only the small delta a duplicate has to be told a second time (`collected`,
  -- `exchanged`). The farm view is deliberately NOT stored: a replay is
  -- answered with a freshly read view, so it can never hand back numbers
  -- staler than the original did.
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (profile_id, key)
);

comment on table public.homestead_action_keys is
  'One claimed StackAcres action intent. Written only by the service role, via lib/server/stackacres-intent-store.ts. A row exists from the moment a request claims its key until it either completes (done = true, with its delta) or refuses (the row is deleted, so the retry is a real attempt). Rows older than the store''s TTL are ignored on read and swept opportunistically by the store, which rides ordinary traffic rather than a schedule.';

-- For the sweep, and the only index that is not the primary key. Reads are all
-- point lookups on (profile_id, key), which the primary key already serves.
create index homestead_action_keys_created_idx
  on public.homestead_action_keys(created_at);

alter table public.homestead_action_keys enable row level security;
-- `public` as well as anon/authenticated: omitting it leaves a grant that
-- makes the table reachable anonymously. See
-- lib/server/stackacres-intent-store.ts and this repo's own history of that
-- exact omission.
revoke all on public.homestead_action_keys from public, anon, authenticated;

-- No policies: service-role only, same posture as homestead_units.
