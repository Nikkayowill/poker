-- Ante Up: Sudoku -- a solo skill wager against the clock.
--
-- Same shape as pvp_matches (lib/server/pvp-match-store.ts's twin): a stored
-- state, a version for optimistic concurrency, service-role only because the
-- state holds the grid's solution. Simpler than pvp_matches in one way -- a
-- single player, not two -- so there is no cross-column "one active attempt"
-- trigger to write; a plain partial unique index covers it.

create table public.ante_up_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Already debited by the time this row exists (rule 1 in
  -- ante-up-service.ts). Zero is a real, valid wager -- free practice, no
  -- payout on a win.
  wager integer not null check (wager >= 0),
  -- Difficulty and the copied-at-start multiplier live inside `state` only --
  -- nothing outside this row ever needs to filter or index on either, so they
  -- are not duplicated as their own columns the way `wager` and `status` are.
  status text not null default 'active'
    check (status in ('active', 'won', 'lost', 'timed-out')),
  -- Optimistic concurrency, same contract as pvp_matches.version: every
  -- mutation is an UPDATE ... where version = <the one the client last saw>,
  -- and this is the settlement idempotency key that makes a win credited
  -- exactly once under a double-click, a retry, or two tabs.
  version bigint not null default 1 check (version > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint ante_up_attempts_settled_at_matches_status check (
    (status = 'active' and settled_at is null)
    or (status <> 'active' and settled_at is not null)
  )
);

comment on table public.ante_up_attempts is
  'A live or finished solo Ante Up: Sudoku attempt. The wager is already debited; a win credits wager*multiplier exactly once, guarded by version. state holds the solution, so this table is service-role only.';

comment on column public.ante_up_attempts.wager is
  'Gold already debited from the player. Stored, not derived, so a payout is computed off exactly what was staked.';

-- One live attempt per player at a time -- the same reasoning
-- pvp_matches_one_active_per_player0/1 gives, minus the cross-column case:
-- there is only one profile_id column here, so a plain partial index is the
-- whole rule.
create unique index ante_up_attempts_one_active_per_player
  on public.ante_up_attempts(profile_id)
  where status = 'active';

-- Today's wagered attempts, for the daily cap (ANTE_UP_DAILY_WAGERED_LIMIT).
-- Partial on wager > 0: free practice attempts do not count against it and
-- must not slow down a count that excludes them anyway.
create index ante_up_attempts_wagered_recent_idx
  on public.ante_up_attempts(profile_id, created_at desc)
  where wager > 0;

alter table public.ante_up_attempts enable row level security;
revoke all on public.ante_up_attempts from anon, authenticated;
