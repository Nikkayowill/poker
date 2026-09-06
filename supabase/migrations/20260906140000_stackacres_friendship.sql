-- NPC friendship: gifting a processing-track item earns points toward a
-- permanent per-NPC ladder of one-time keepsake rewards (never Gold -- see
-- lib/stackacres/friendship.ts's own header for why). A separate mechanic
-- from homestead_devotion (20260906130000) -- see that same header for why
-- the two stay apart despite the similar day-gate/claimed-rung shape.
--
-- NAME CHECKED AGAINST THE LIVE SCHEMA, not just this repo's migrations:
-- confirmed via information_schema that homestead_friendship and
-- give_homestead_gift are both free.
--
-- give_homestead_gift DOES TWO THINGS IN ONE TRANSACTION, the same reason
-- process_homestead_recipe (20260904170000) is one function and not two
-- calls: debiting the gift item and advancing the friendship row must
-- commit together or not at all, or a hiccup between them could spend a
-- player's Cheese for a gift that was never recorded. Order matters within
-- that transaction too -- the day-gate is checked FIRST, before the
-- inventory debit, so an already-gifted-today attempt is refused without
-- ever touching the player's stores (see the function body).
--
-- CHECK, not a BEFORE INSERT trigger, on points >= 0: like
-- homestead_devotion's streak, points only ever move to a literal
-- 0-plus-one-gift's-worth or to (stored value + one gift's worth), never
-- through a transient negative, so there is no in-flight row a CHECK could
-- strand.

create table public.homestead_friendship (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  npc text not null check (npc in ('ray')),
  points integer not null default 0 check (points >= 0),
  last_gifted_day date,
  claimed_rungs integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (profile_id, npc)
);

comment on table public.homestead_friendship is
  'NPC friendship: per-player, per-NPC gift points and claimed reward-ladder rungs. Service-role only.';

alter table public.homestead_friendship enable row level security;
revoke all on public.homestead_friendship from anon, authenticated;

-- Row-locking read-then-write, never a plain read-then-write from the
-- application: two tabs gifting at the same moment must not both see the
-- pre-advance point total, both claim the same rung, or both spend the
-- same unit of inventory. p_points is lib/stackacres/friendship.ts's own
-- giftPoints(npc, item) and p_rung_thresholds is FRIENDSHIP_RUNG_THRESHOLDS
-- -- service-owned data this function has no other way to know, same
-- pattern pray_at_homestead_shrine's own p_rung_thresholds already sets.
create or replace function public.give_homestead_gift(
  p_profile_id uuid,
  p_npc text,
  p_item text,
  p_points integer,
  p_today date,
  p_rung_thresholds integer[]
)
returns table (points integer, outcome text, granted_rung integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_points integer;
  cur_last_gifted_day date;
  cur_claimed_rungs integer[];
  new_points integer;
  claimed integer[];
  i integer;
  rung_count integer;
  g integer := null;
  remaining integer;
begin
  select f.points, f.last_gifted_day, f.claimed_rungs
    into cur_points, cur_last_gifted_day, cur_claimed_rungs
  from public.homestead_friendship f
  where f.profile_id = p_profile_id
    and f.npc = p_npc
  for update;

  -- THE DAY GATE FIRST, before the inventory touches anything -- an
  -- already-gifted-today attempt is a complete no-op, same as
  -- pray_at_homestead_shrine's own same-day branch, and it must never cost
  -- the player the item they tried to give.
  if cur_last_gifted_day = p_today then
    return query select coalesce(cur_points, 0), 'already-gifted-today'::text, null::integer;
    return;
  end if;

  -- THE DEBIT SECOND, inside the same transaction the friendship write
  -- lands in -- see process_homestead_recipe's own comment on why the
  -- sufficiency check rides inside the UPDATE's WHERE clause rather than a
  -- SELECT before it: the row lock and the balance test happen atomically,
  -- so two taps arriving together cannot both read "enough" and both spend.
  update public.homestead_processing_inventory
     set quantity = quantity - 1,
         updated_at = now()
   where profile_id = p_profile_id
     and item = p_item
     and quantity >= 1
  returning quantity into remaining;

  if remaining is null then
    return query select coalesce(cur_points, 0), 'insufficient-item'::text, null::integer;
    return;
  end if;

  new_points := coalesce(cur_points, 0) + p_points;
  claimed := coalesce(cur_claimed_rungs, '{}');

  -- The first unclaimed rung whose threshold the new total now meets, if
  -- any -- rung index is 0-based (array position - 1), matching
  -- FRIENDSHIP_LADDER's own indexing in lib/stackacres/friendship.ts.
  rung_count := coalesce(array_length(p_rung_thresholds, 1), 0);
  for i in 1 .. rung_count loop
    if new_points >= p_rung_thresholds[i] and not ((i - 1) = any(claimed)) then
      g := i - 1;
      claimed := array_append(claimed, g);
      exit;
    end if;
  end loop;

  insert into public.homestead_friendship as f (profile_id, npc, points, last_gifted_day, claimed_rungs, updated_at)
  values (p_profile_id, p_npc, new_points, p_today, claimed, now())
  on conflict (profile_id, npc) do update
    set points = excluded.points,
        last_gifted_day = excluded.last_gifted_day,
        claimed_rungs = excluded.claimed_rungs,
        updated_at = now();

  return query select new_points, 'gifted'::text, g;
end;
$$;

comment on function public.give_homestead_gift(uuid, text, text, integer, date, integer[]) is
  'Debits one unit of p_item and advances the caller''s friendship with p_npc, atomically. Refuses (outcome insufficient-item or already-gifted-today) without touching either table when the gift cannot be counted.';

-- `public` is load-bearing here, not redundant with anon/authenticated: see
-- reference_stackchips_revoke_execute_from_public -- omitting it has shipped
-- a SECURITY DEFINER function anonymously callable on /rest/v1/rpc twice
-- already. Verify with proacl after applying, not by re-reading this file.
revoke all on function public.give_homestead_gift(uuid, text, text, integer, date, integer[]) from public, anon, authenticated;
