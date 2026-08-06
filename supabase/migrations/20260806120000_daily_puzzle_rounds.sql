-- Daily puzzle attempts: Wordle and Connections.
--
-- A sibling of arcade_rounds (20260805180000), not a replacement for it, and
-- the difference is one index.
--
-- arcade_rounds enforces one live round per (profile, game) with a PARTIAL
-- unique index on `status = 'active'`, so a settled round never blocks a new
-- one. That is exactly right for Hi-Lo, where dealing again is the point, and
-- exactly wrong for a daily puzzle: everyone shares one board per day, so a
-- second attempt would be a replay of a word the player has just been shown,
-- and the emoji grid this whole feature exists to produce would be a claim
-- nobody could trust. The index here is therefore UNCONDITIONAL on
-- (profile_id, game, puzzle_day): one attempt per player per puzzle, whether
-- they finished it or not.
--
-- The other two differences are why the columns are not simply reused: a free
-- puzzle has no `tier` and no `base_stake`, and arcade_rounds constrains the
-- latter to be positive. Two columns lying in every row is worse than a table.
--
-- Same posture as every table since the M15 archives: `state` holds the answer
-- -- the word, or the four groups -- so nothing here is granted to anon or
-- authenticated, and browsers only ever receive a redacted snapshot from
-- app/api/arcade/wordle and .../connections.

create table public.daily_puzzle_rounds (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Free text rather than an enum, matching arcade_rounds.game: adding a
  -- puzzle should be a new engine and a new route, not a migration. The
  -- service role is the only writer and the value is always a literal in
  -- lib/server, never user input.
  game text not null check (length(game) between 1 and 40),
  -- A `date`, not a timestamptz. The puzzle day is an identity -- part of the
  -- unique key and the number printed in the share text -- not the moment
  -- anything happened, and it is UTC by construction (see lib/arcade/puzzles/
  -- daily.ts for why a local rollover would break sharing outright).
  puzzle_day date not null,
  -- Optimistic concurrency, same contract as arcade_rounds.version. Every
  -- mutation is an UPDATE ... where version = <the one the client last saw>,
  -- which makes a replayed or double-fired submit a no-op rather than a second
  -- guess off the same board. No payout rides on it here -- a lost race costs
  -- a guess, not Gold -- but spending two of a player's six on one word
  -- because a request retried is still a bug they would rightly complain about.
  version bigint not null default 1 check (version > 0),
  status text not null default 'active' check (status in ('active', 'complete')),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.daily_puzzle_rounds is
  'One attempt per player per daily puzzle. state holds the answer, so this table is service-role only; browsers receive a redacted snapshot from app/api/arcade/wordle and app/api/arcade/connections.';

comment on column public.daily_puzzle_rounds.puzzle_day is
  'The UTC calendar day the puzzle belongs to. Part of the row identity, not a timestamp -- everyone shares one board per day.';

-- The rule the feature rests on. Unconditional, NOT partial on status: a
-- finished attempt must block a new one just as firmly as a live one does.
-- Enforced here rather than by a check-then-insert in the route, because two
-- concurrent opens both pass a read-first check and the loser would overwrite
-- a board the player had already made guesses on.
create unique index daily_puzzle_rounds_one_per_day
  on public.daily_puzzle_rounds(profile_id, game, puzzle_day);

-- For "how has this player done lately" -- streaks and a puzzle history are
-- the obvious next slice and would otherwise seq-scan.
create index daily_puzzle_rounds_profile_recent_idx
  on public.daily_puzzle_rounds(profile_id, game, puzzle_day desc);

alter table public.daily_puzzle_rounds enable row level security;
revoke all on public.daily_puzzle_rounds from anon, authenticated;
