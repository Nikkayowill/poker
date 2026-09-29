-- The one true answer for a shared daily puzzle, independent of any player.
--
-- daily_puzzle_rounds (20260806120000) is a player's *attempt*, keyed on
-- (profile_id, game, puzzle_day). This is the answer that attempt is scored
-- against, keyed on (game, puzzle_day) alone -- it has no player. A second
-- table, not a nullable-profile_id row bolted onto the first, for the same
-- reason that table itself gave for not reusing arcade_rounds: forcing two
-- different identities into one table means either punching a hole in
-- daily_puzzle_rounds_one_per_day's unconditional uniqueness, or a phantom
-- "canon" attempt every future query on that table has to know to filter
-- out by convention rather than by table boundary. A canon row is also
-- written exactly once and never mutated -- no version to guard a race on,
-- no status lifecycle -- so `version`/`status` would sit permanently
-- constant on every row, the same "two columns lying in every row" trap
-- base_stake/tier would have been there.
--
-- Written on whichever request -- today's opener, or the puzzle archive's
-- first visitor to an old day -- is first to ask about that (game, day), and
-- read-only forever after. That is what makes this safe against
-- WORD_STACK_ANSWERS (or CONNECTIONS_PUZZLES) growing over time: pickDaily
-- (lib/arcade/puzzles/daily.ts) is a pure function of the pool's *current*
-- size, so recomputing it for an old day against a since-grown pool can
-- silently pick a different answer than the one actually shown that day --
-- WORD_STACK_ANSWERS itself grew 751->1,119 words on 2026-08-19. This table
-- freezes the first answer ever computed (or backfilled from a real
-- pre-existing daily_puzzle_rounds attempt, when one exists -- see
-- getOrCreateCanonicalAnswer in lib/server/daily-puzzle-store.ts) so every
-- later reader of that day, whether that's today's second player or next
-- month's archive visitor, converges on the same one.
--
-- Same secrecy posture as daily_puzzle_rounds.state: this holds the actual
-- answer (a word, or a Connections puzzle's four groups), so it is never
-- granted to anon or authenticated -- only ever read by the service role.

create table public.daily_puzzle_canon (
  id uuid primary key default gen_random_uuid(),
  -- Free text, matching daily_puzzle_rounds.game: adding a puzzle is a new
  -- engine and a new route, not a migration. Always a literal from
  -- lib/server, never user input.
  game text not null check (length(game) between 1 and 40),
  -- A `date`, matching daily_puzzle_rounds.puzzle_day: an identity, not a
  -- timestamp, and UTC by construction (see lib/arcade/puzzles/daily.ts).
  puzzle_day date not null,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.daily_puzzle_canon is
  'The one true answer for a (game, puzzle_day), written once on first ask and read-only after. Backs the daily puzzle archive; service-role only, same posture as daily_puzzle_rounds.';

-- The whole point of the table: at most one canonical answer per (game,
-- day). getOrCreateCanonicalAnswer relies on this via an upsert with
-- ignoreDuplicates (INSERT ... ON CONFLICT DO NOTHING), so a race between
-- two first-ever readers of the same historical day resolves to one winner
-- -- both then read back the same row -- rather than two different "true"
-- answers for the same day.
create unique index daily_puzzle_canon_one_per_day
  on public.daily_puzzle_canon(game, puzzle_day);

alter table public.daily_puzzle_canon enable row level security;
revoke all on public.daily_puzzle_canon from anon, authenticated;
