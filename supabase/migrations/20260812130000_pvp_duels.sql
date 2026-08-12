-- Player-versus-player duels: chess, checkers, trivia, word race.
--
-- Two tables, and the split between them is the whole design. A CHALLENGE is
-- an offer with one player's Gold already escrowed against it; a MATCH is a
-- game in progress with both players' Gold in the pot. They are separate rows
-- because they have different lifetimes, different unique constraints and
-- different failure modes -- an expired challenge refunds one player, an
-- abandoned match has to settle two.
--
-- The economy here is unlike anything else in the app and that is deliberate
-- (owner's call, 2026-08-12): there is no house edge and no rake. Both players
-- ante the same stake, the winner takes both, a draw returns each their own.
-- Gold is therefore CONSERVED across a duel -- the sum of the two balances is
-- identical before and after -- which is what makes these safe to offer at any
-- stake without the arithmetic the casino games needed. lib/server/
-- pvp-match-service.ts states the ordering rules that keep it true.
--
-- Same posture as arcade_rounds and daily_puzzle_rounds: `state` holds the
-- whole game INCLUDING what must not be sent to a client (a trivia question's
-- correct answer, a word race's solution), so nothing here is granted to anon
-- or authenticated. Browsers receive a per-viewer redacted snapshot from
-- app/api/pvp/, never a row.

-- ---------------------------------------------------------------------------
-- Challenges: an offer, with the challenger's stake already escrowed.
-- ---------------------------------------------------------------------------

create table public.pvp_challenges (
  id uuid primary key default gen_random_uuid(),
  -- Free text, matching arcade_rounds.game and daily_puzzle_rounds.game:
  -- adding a duel should be a new engine and a new registry entry, not a
  -- migration. The service role is the only writer and the value is always a
  -- literal from lib/pvp/registry.ts, never user input.
  game text not null check (length(game) between 1 and 40),
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  -- Null means "open to anyone" -- the matchmaking queue. Non-null is a
  -- direct challenge to one friend, which is the case the owner actually
  -- asked for ("play anything I want with my friends at any moment").
  opponent_id uuid references public.profiles(id) on delete cascade,
  tier text not null,
  -- What the challenger has ALREADY been debited. Stored rather than looked up
  -- from the tier so a refund pays back exactly what was taken, even if
  -- TIER_CONFIG's ladder is ever repriced under a live challenge.
  stake integer not null check (stake > 0),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'cancelled', 'expired')),
  -- The match this became, once accepted. Nullable because most challenges
  -- never get there. No FK: pvp_matches is created after this row is settled,
  -- and a circular pair of not-yet-existing references is worse than a
  -- dangling id the service checks.
  match_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  constraint pvp_challenges_not_self check (challenger_id is distinct from opponent_id),
  -- A terminal row records when it became terminal; an open one has not.
  constraint pvp_challenges_responded_at_matches_status check (
    (status = 'open' and responded_at is null)
    or (status <> 'open' and responded_at is not null)
  ),
  -- Only an accepted challenge may point at a match. Deliberately NOT "and
  -- every accepted one does": accepting is two steps and there is a real
  -- moment between them where neither is true yet.
  --
  -- claimChallenge() flips status to 'accepted' on its own, as a guarded
  -- UPDATE, because that single statement is what makes exactly one acceptor
  -- win the race -- and at that instant the match does not exist, so there is
  -- no id to write. attachMatchToChallenge() fills it in once the match is
  -- persisted. The stricter form of this constraint rejected that first
  -- UPDATE outright, which made accepting a challenge impossible: caught by
  -- replaying the store's exact statements against a real Postgres, since the
  -- memory branch enforces no constraints and every test passed.
  --
  -- What it still buys is the thing it was written for: a cancelled or expired
  -- row can never carry a match id, so the refund paths cannot mistake a
  -- challenge that became a game for one that did not.
  constraint pvp_challenges_match_id_matches_status check (
    match_id is null or status = 'accepted'
  )
);

comment on table public.pvp_challenges is
  'An offer to duel, with the challenger stake already escrowed. Cancelling or expiring refunds it; accepting moves it into a pvp_matches pot.';

comment on column public.pvp_challenges.stake is
  'Gold already debited from the challenger. Stored, not derived from tier, so a refund returns exactly what was taken.';

-- One live challenge per player per game.
--
-- Partial on status, like friend_requests_one_pending_per_pair: settled rows
-- are kept as history and must not block the next challenge. The cap is per
-- (challenger, game) rather than global because each open challenge holds real
-- escrowed Gold -- without it a player could open fifty and have their whole
-- balance locked in offers nobody accepted.
create unique index pvp_challenges_one_open_per_challenger
  on public.pvp_challenges(challenger_id, game)
  where status = 'open';

-- The matchmaking read: open challenges for a game, newest first.
create index pvp_challenges_open_idx
  on public.pvp_challenges(game, created_at desc)
  where status = 'open';

-- "What have I been challenged to" -- the notification poll.
create index pvp_challenges_opponent_open_idx
  on public.pvp_challenges(opponent_id, created_at desc)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- Matches: a game in progress, with both stakes in the pot.
-- ---------------------------------------------------------------------------

create table public.pvp_matches (
  id uuid primary key default gen_random_uuid(),
  game text not null check (length(game) between 1 and 40),
  -- Seat 0 and seat 1. Ordered, not canonical: which seat a player holds is
  -- part of the game (white moves first at chess), so this pair must NOT be
  -- sorted the way friendships.profile_a/profile_b are.
  --
  -- `on delete cascade` matches every other table here, and carries a
  -- consequence worth stating rather than discovering: deleting a profile
  -- mid-match destroys the row, and the OPPONENT's ante goes with it -- their
  -- stake was already debited and there is now nothing left to settle. That is
  -- accepted rather than solved: profile deletion is a rare admin action
  -- (deleteProfiles), and a settle-on-delete trigger would have to move Gold
  -- from inside a cascade, which is a far worse thing to get wrong. If bulk
  -- deletion ever becomes routine, settle that player's live matches first.
  player0_id uuid not null references public.profiles(id) on delete cascade,
  player1_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null,
  -- Per player, not the total. The pot is stake * 2; storing the half both
  -- antéd means a draw refund is `stake` with no division, and a division is
  -- how an odd pot would silently lose a Gold.
  stake integer not null check (stake > 0),
  status text not null default 'active' check (status in ('active', 'settled')),
  -- 0, 1, or null. Null on an active row means "still playing"; null on a
  -- settled row means a DRAW, which is a real outcome at chess and checkers.
  -- The two are told apart by `status`, never by this column alone.
  winner_seat smallint check (winner_seat in (0, 1)),
  -- Optimistic concurrency, same contract as arcade_rounds.version: every
  -- mutation is an UPDATE ... where version = <the one the client last saw>.
  -- This is the settlement idempotency key and the only thing that makes a
  -- pot pay out exactly once under a double-click, a retry, two tabs, or both
  -- players' clients resigning the same match at the same instant.
  version bigint not null default 1 check (version > 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint pvp_matches_two_players check (player0_id <> player1_id),
  constraint pvp_matches_settled_at_matches_status check (
    (status = 'active' and settled_at is null and winner_seat is null)
    or (status = 'settled' and settled_at is not null)
  )
);

comment on table public.pvp_matches is
  'A live or finished 1v1 duel. Both stakes are already debited; the pot is stake*2 and is credited to the winner exactly once, guarded by version. state holds hidden information (trivia answers, word solutions) so this table is service-role only.';

comment on column public.pvp_matches.winner_seat is
  'Null on an active row means still playing; null on a settled row means a draw. Read it together with status, never alone.';

-- A player has at most one live match per game. Partial on status so finished
-- matches are kept -- they are the history a rematch and a win record read.
--
-- These two indexes are NOT sufficient on their own, and the gap is not
-- obvious: they catch a player holding the same SEAT in two matches, and miss
-- them holding seat 0 in one and seat 1 in another. That is reachable in one
-- ordinary session -- open a challenge (you become seat 0 when it is taken)
-- and accept somebody else's (you become seat 1) -- and the consequence is
-- worse than a duplicate row: getActivePvpMatch reads with maybeSingle over
-- an either-column filter, so two live matches lock that player out of the
-- game entirely, with their Gold in two pots. The trigger below is what
-- actually enforces the rule; these remain because both are real query paths
-- and a redundant guard on money is not waste.
create unique index pvp_matches_one_active_per_player0
  on public.pvp_matches(player0_id, game)
  where status = 'active';

create unique index pvp_matches_one_active_per_player1
  on public.pvp_matches(player1_id, game)
  where status = 'active';

/*
 * The cross-seat half of "one live match per player per game".
 *
 * A trigger rather than a constraint because the rule spans two columns
 * disjunctively -- "either of these two people, in either of those two
 * columns" -- which no unique index or CHECK can express. An EXCLUDE
 * constraint cannot either, since the pair is unordered here but the columns
 * are ordered by design (seat 0 is white, and must stay seat 0).
 *
 * The FOR UPDATE is the whole concurrency argument and is not decoration.
 * Without it two accepts naming the same player both pass the EXISTS on the
 * same stale snapshot and both insert. Locking the profile rows first makes
 * the second transaction block until the first commits, and under READ
 * COMMITTED its next statement then sees that committed row -- so it raises
 * instead. The rows are locked in a deterministic order (least, then
 * greatest) so two matches sharing both players cannot deadlock by taking
 * them in opposite orders.
 *
 * errcode 23505 is deliberate: it is unique_violation, which is exactly what
 * the two indexes above raise, so lib/server/pvp-match-store.ts's existing
 * `error.code === "23505"` catch maps this to ActivePvpMatchExists with no
 * second branch. A bespoke errcode would need the store to learn a new one,
 * and a store that mishandles it debits an acceptor for a match that did not
 * open.
 */
create or replace function public.pvp_matches_enforce_one_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.profiles
  where id in (
    least(new.player0_id, new.player1_id),
    greatest(new.player0_id, new.player1_id)
  )
  order by id
  for update;

  if exists (
    select 1
    from public.pvp_matches as m
    where m.game = new.game
      and m.status = 'active'
      and m.id <> new.id
      and (
        m.player0_id in (new.player0_id, new.player1_id)
        or m.player1_id in (new.player0_id, new.player1_id)
      )
  ) then
    raise exception 'One of you is already in a % match', new.game
      using errcode = '23505';
  end if;

  return new;
end;
$$;

-- INSERT only. A match never goes settled -> active, so there is no update
-- that could reintroduce a second live one; firing on UPDATE as well would
-- take two profile row locks on every single move.
create trigger pvp_matches_one_active_per_player
  before insert on public.pvp_matches
  for each row execute function public.pvp_matches_enforce_one_active();

-- "What are my recent duels" -- both seats, for a history panel.
create index pvp_matches_player0_recent_idx on public.pvp_matches(player0_id, created_at desc);
create index pvp_matches_player1_recent_idx on public.pvp_matches(player1_id, created_at desc);

alter table public.pvp_challenges enable row level security;
alter table public.pvp_matches enable row level security;
revoke all on public.pvp_challenges from anon, authenticated;
revoke all on public.pvp_matches from anon, authenticated;
