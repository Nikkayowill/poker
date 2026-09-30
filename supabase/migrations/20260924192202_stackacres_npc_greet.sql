-- NPC friendship, part two: a plain "say hi" alongside the existing gift
-- loop (20260906140000_stackacres_friendship.sql). Same table, a second
-- day gate column of its own -- greeting and gifting are two different
-- player actions with two different costs (free vs. a processing-track
-- item), so they must never share one day gate: a player who already
-- gifted today can still say hi, and vice versa.
--
-- Widens the npc check to 'pierre' and 'ivy', the two travelers who stay on
-- the farm once their own quest line finishes (lib/stackacres/story/) and
-- so far had no ongoing relationship loop of their own once it did. The
-- Pixel Pilgrim is deliberately NOT added here -- he already has his own
-- devotion/prayer streak (homestead_devotion, 20260906130000) and
-- lib/stackacres/friendship.ts's own header is explicit that the two
-- mechanics stay separate modules on purpose.
--
-- greet_homestead_npc mirrors give_homestead_gift's shape exactly (row
-- lock, day gate checked first, ladder rung check, upsert) but touches no
-- other table -- a greet spends nothing, so there is no debit step and so
-- no way for it to fail once the day gate passes.
--
-- BOTH functions below now insert a fresh row (ON CONFLICT DO NOTHING)
-- before their SELECT ... FOR UPDATE, fixing a lost-update race that
-- predates this migration in give_homestead_gift and would otherwise also
-- exist in greet_homestead_npc: `SELECT ... FOR UPDATE` cannot lock a row
-- that does not exist yet, so a brand-new profile/npc pair's first-ever
-- gift and first-ever greet (or two first-ever gifts from two tabs) could
-- race -- both read "no row" and compute their own new_points from zero,
-- then whichever's INSERT ... ON CONFLICT DO UPDATE lands last silently
-- overwrites the other's points, even though both requests reported
-- success to their own caller. The pre-insert guarantees a row always
-- exists by the time FOR UPDATE runs, so the second writer genuinely
-- blocks on the first's row lock and reads its already-applied points.

alter table public.homestead_friendship
  drop constraint homestead_friendship_npc_check,
  add constraint homestead_friendship_npc_check check (npc in ('ray', 'pierre', 'ivy')),
  add column last_greeted_day date;

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
  insert into public.homestead_friendship (profile_id, npc)
  values (p_profile_id, p_npc)
  on conflict (profile_id, npc) do nothing;

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

  rung_count := coalesce(array_length(p_rung_thresholds, 1), 0);
  for i in 1 .. rung_count loop
    if new_points >= p_rung_thresholds[i] and not ((i - 1) = any(claimed)) then
      g := i - 1;
      claimed := array_append(claimed, g);
      exit;
    end if;
  end loop;

  update public.homestead_friendship
     set points = new_points,
         last_gifted_day = p_today,
         claimed_rungs = claimed,
         updated_at = now()
   where profile_id = p_profile_id
     and npc = p_npc;

  return query select new_points, 'gifted'::text, g;
end;
$$;

comment on function public.give_homestead_gift(uuid, text, text, integer, date, integer[]) is
  'Debits one unit of p_item and advances the caller''s friendship with p_npc, atomically. Refuses (outcome insufficient-item or already-gifted-today) without touching either table when the gift cannot be counted.';

revoke all on function public.give_homestead_gift(uuid, text, text, integer, date, integer[]) from public, anon, authenticated;

create or replace function public.greet_homestead_npc(
  p_profile_id uuid,
  p_npc text,
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
  cur_last_greeted_day date;
  cur_claimed_rungs integer[];
  new_points integer;
  claimed integer[];
  i integer;
  rung_count integer;
  g integer := null;
begin
  insert into public.homestead_friendship (profile_id, npc)
  values (p_profile_id, p_npc)
  on conflict (profile_id, npc) do nothing;

  select f.points, f.last_greeted_day, f.claimed_rungs
    into cur_points, cur_last_greeted_day, cur_claimed_rungs
  from public.homestead_friendship f
  where f.profile_id = p_profile_id
    and f.npc = p_npc
  for update;

  if cur_last_greeted_day = p_today then
    return query select coalesce(cur_points, 0), 'already-greeted-today'::text, null::integer;
    return;
  end if;

  new_points := coalesce(cur_points, 0) + p_points;
  claimed := coalesce(cur_claimed_rungs, '{}');

  rung_count := coalesce(array_length(p_rung_thresholds, 1), 0);
  for i in 1 .. rung_count loop
    if new_points >= p_rung_thresholds[i] and not ((i - 1) = any(claimed)) then
      g := i - 1;
      claimed := array_append(claimed, g);
      exit;
    end if;
  end loop;

  update public.homestead_friendship
     set points = new_points,
         last_greeted_day = p_today,
         claimed_rungs = claimed,
         updated_at = now()
   where profile_id = p_profile_id
     and npc = p_npc;

  return query select new_points, 'greeted'::text, g;
end;
$$;

comment on function public.greet_homestead_npc(uuid, text, integer, date, integer[]) is
  'Says hi to p_npc, advancing friendship for the UTC day at no item cost. Refuses (already-greeted-today) without writing anything when a greet already landed today.';

revoke all on function public.greet_homestead_npc(uuid, text, integer, date, integer[]) from public, anon, authenticated;
