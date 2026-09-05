-- StackAcres Synergy Tree: permanent skill unlocks + a per-session loadout.
--
-- TWO TIERS, deliberately different storage, matching how differently they
-- behave:
--
--   PERMANENT unlocks are bought once, in Gold (StackAcres' only currency
--   since the 2026-09-04 single-currency change -- see
--   lib/stackacres/items.ts's own header; there is no Bushels balance left
--   to spend one from). They live in `stackacres_perk_unlocks`, a new table
--   shaped exactly like the legacy `homestead_inventory` (profile_id,
--   item_id, quantity) rather than IN that table, for two independently
--   sufficient reasons, both verified against the live schema before this
--   migration was written (see CLAUDE.md's Town Contracts entry for why
--   that verification step, not the changelog, is what's trustworthy here):
--     1. `homestead_inventory` is INERT -- the single-currency change
--        deleted its only writers and left it in place the same way it left
--        `homestead_plots` in place. Writing perks into a table nothing
--        else reads or reasons about would make it silently live again with
--        no test or code path guarding what "inert" was supposed to mean.
--     2. The table that IS StackAcres' live single-table item model today,
--        `homestead_processing_inventory` (20260904180249), hard-CHECKs
--        `item in ('wheat', 'flour')` -- a perk_id could never be inserted
--        into it without loosening a constraint three concurrently-active
--        StackAcres branches depend on staying exactly that narrow.
--   A perk is owned/not-owned, never stacked, so quantity only ever reads 0
--   or 1 -- kept as a genuine `integer` column rather than a boolean anyway,
--   matching every sibling `homestead_*`/`ante_up_attempts`-style ledger
--   here, and so a future perk that *can* have ranks (buy again for a
--   stronger rung) never needs a column added, only a bigger number.
--
--   ACTIVE SESSION perks are a LOADOUT, not a second purchase: owning a
--   perk only makes it eligible to slot for the session in front of you,
--   and slotting is what actually turns its buff on. `stackacres_session_perks`
--   is UNLOGGED and keyed off `player_sessions` -- the exact liveness table
--   game-store.ts already reads to decide whether a seated player is still
--   around (see its own comment on why `last_seen_at`, not `updated_at`, is
--   the real signal) -- rather than inventing a second notion of "session."
--   `player_sessions` rows are never deleted (only bumped), so there is
--   nothing to cascade off; staleness is judged directly against
--   `last_seen_at`, lazily, inside `get_active_stackacres_synergies` below.
--
-- WHY UNLOGGED: this table is a fully disposable cache of a choice the
-- player can always re-make, and it sits on the hottest possible read path
-- (a harvest, every farmhand tick, every Mill collect all consult it). An
-- UNLOGGED table skips WAL, which is a real win there, at the cost of being
-- truncated by a crash -- fine, since losing it reads to the player exactly
-- like their session going stale on its own. It is NOT covered by
-- point-in-time recovery or by either physical or logical replication
-- (Realtime's own requirement); nothing here subscribes to this table and
-- nothing in it is worth recovering, so that's a trade worth taking, not an
-- oversight -- don't "fix" it by making the table LOGGED later without
-- re-checking that reasoning still holds.
--
-- WHY THERE'S NO CRON: no unit in StackAcres runs a background job --
-- farmhand.ts's own header states this as the house style -- every clock
-- here is a pure function of `now`, settled by whichever request touches it
-- next. A stale loadout is swept the same way: lazily, on the next read,
-- never on a timer.

/* -------------------------------------------------------------------- */
/* Permanent unlocks                                                     */
/* -------------------------------------------------------------------- */

create table public.stackacres_perk_unlocks (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

comment on table public.stackacres_perk_unlocks is
  'Permanently-owned Synergy Tree perks, one row per profile/perk (item_id e.g. ''perk_sunlight_harvester_v1''), quantity 0 or 1. See lib/stackacres/synergy-perks.ts. Service-role only.';

alter table public.stackacres_perk_unlocks enable row level security;
revoke all on public.stackacres_perk_unlocks from anon, authenticated;

-- Atomic buy: debits Gold through the SAME row-locking RPC every other Gold
-- spend goes through (spend_gold_by_profile, 20260812120000) rather than a
-- second read-then-write, then grants the perk. Both happen in one
-- transaction -- a plpgsql function body runs inside the caller's
-- transaction, so if the insert below raises, the Gold debit it already
-- performed rolls back with it. That is what makes this atomic without a
-- manual refund step: unlike a PvP escrow, there's no second party who
-- might have already observed a partial state.
--
-- Idempotent on an already-owned perk: returns success=false, reason
-- 'already_owned' rather than charging Gold for a no-op re-unlock. A
-- double-submitted click must not be a second sale.
create or replace function public.unlock_stackacres_perk(
  p_profile_id uuid,
  p_item_id text,
  p_cost integer
)
returns table (success boolean, reason text, gold_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned integer;
  v_spend record;
begin
  if p_cost is null or p_cost < 0 then
    raise exception 'Invalid perk cost' using errcode = '22023';
  end if;

  select quantity into v_owned
  from public.stackacres_perk_unlocks
  where profile_id = p_profile_id and item_id = p_item_id;

  if v_owned is not null and v_owned > 0 then
    select p.gold_balance into gold_balance from public.profiles as p where p.id = p_profile_id;
    return query select false, 'already_owned', gold_balance;
    return;
  end if;

  if p_cost > 0 then
    select * into v_spend from public.spend_gold_by_profile(p_profile_id, p_cost);
    if not v_spend.success then
      return query select false, 'insufficient_gold', v_spend.gold_balance;
      return;
    end if;
    gold_balance := v_spend.gold_balance;
  else
    -- A free perk still needs the profile to exist; spend_gold_by_profile
    -- requires a positive amount, so a zero-cost unlock is granted directly
    -- rather than spending nothing through it.
    select p.gold_balance into gold_balance from public.profiles as p where p.id = p_profile_id;
    if gold_balance is null then
      return query select false, 'no_such_profile', 0;
      return;
    end if;
  end if;

  insert into public.stackacres_perk_unlocks as u (profile_id, item_id, quantity)
  values (p_profile_id, p_item_id, 1)
  on conflict (profile_id, item_id) do update set quantity = 1, updated_at = now();

  return query select true, 'unlocked', gold_balance;
end;
$$;

comment on function public.unlock_stackacres_perk(uuid, text, integer) is
  'Debits Gold via spend_gold_by_profile and grants a Synergy Tree perk in the same transaction. Idempotent: already owning the perk is a no-op refusal, never a second charge.';

revoke all on function public.unlock_stackacres_perk(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.unlock_stackacres_perk(uuid, text, integer) to service_role;

/* -------------------------------------------------------------------- */
/* Active session loadout                                                */
/* -------------------------------------------------------------------- */

-- How many perks the session-idle default below is measured against, and
-- how many slots a loadout carries. Kept in step with
-- SYNERGY_MAX_ACTIVE_SLOTS / SYNERGY_SESSION_IDLE_MS in
-- lib/stackacres/synergy-perks.ts by hand, the same duplication the wager
-- ceiling trigger (20260827170508) already carries for the same reason: a
-- trigger and a default parameter cannot import a TypeScript module.
create unlogged table public.stackacres_session_perks (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  perk_id text not null,
  slot smallint not null check (slot >= 0 and slot < 3),
  activated_at timestamptz not null default now(),
  primary key (profile_id, perk_id),
  unique (profile_id, slot)
);

comment on table public.stackacres_session_perks is
  'Which owned perks are slotted for the CURRENT session, up to 3. Deliberately UNLOGGED and never read directly by the app -- go through get_active_stackacres_synergies, which sweeps staleness first. Service-role only.';

alter table public.stackacres_session_perks enable row level security;
revoke all on public.stackacres_session_perks from anon, authenticated;

-- Slotting is gated on ownership here too, not just trusted from the caller
-- (the server route is expected to check first) -- the same "protected by
-- construction rather than by discipline" posture equipment.ts's crit path
-- documents for itself. `on conflict (profile_id, slot)` swaps whatever was
-- in that slot; `on conflict (profile_id, perk_id)` re-slots a perk that was
-- already active elsewhere rather than letting it occupy two slots at once.
create or replace function public.activate_stackacres_session_perk(
  p_profile_id uuid,
  p_perk_id text,
  p_slot smallint
)
returns table (success boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned integer;
begin
  select quantity into v_owned
  from public.stackacres_perk_unlocks
  where profile_id = p_profile_id and item_id = p_perk_id;

  if v_owned is null or v_owned <= 0 then
    return query select false, 'not_owned';
    return;
  end if;

  -- Free the slot first: a straight upsert on (profile_id, perk_id) alone
  -- would leave the perk that used to hold p_slot still primary-keyed to
  -- its old row, so the unique (profile_id, slot) constraint would reject
  -- the swap instead of performing it.
  delete from public.stackacres_session_perks
  where profile_id = p_profile_id and slot = p_slot and perk_id <> p_perk_id;

  insert into public.stackacres_session_perks as s (profile_id, perk_id, slot, activated_at)
  values (p_profile_id, p_perk_id, p_slot, now())
  on conflict (profile_id, perk_id) do update
    set slot = excluded.slot, activated_at = now();

  return query select true, 'activated';
end;
$$;

comment on function public.activate_stackacres_session_perk(uuid, text, smallint) is
  'Slots an OWNED perk into the current session loadout (0..2). Re-checks ownership itself rather than trusting the caller.';

revoke all on function public.activate_stackacres_session_perk(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.activate_stackacres_session_perk(uuid, text, smallint) to service_role;

-- The one read path for a session's active perks, and the only place
-- staleness is decided. `p_idle_ms` defaults to SYNERGY_SESSION_IDLE_MS
-- (30 minutes) -- comfortably longer than the realtime backup polls
-- elsewhere in this app (15s), short enough that a genuinely-ended session
-- clears well within the same sitting a player would notice it in.
create or replace function public.get_active_stackacres_synergies(
  p_profile_id uuid,
  p_idle_ms integer default 1800000
)
returns table (perk_id text, slot smallint, activated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_seen timestamptz;
begin
  select ps.last_seen_at into v_last_seen
  from public.player_sessions as ps
  where ps.token = p_profile_id;

  if v_last_seen is null or v_last_seen < now() - make_interval(secs => p_idle_ms / 1000.0) then
    delete from public.stackacres_session_perks where profile_id = p_profile_id;
    return;
  end if;

  return query
    select s.perk_id, s.slot, s.activated_at
    from public.stackacres_session_perks as s
    where s.profile_id = p_profile_id
    order by s.slot;
end;
$$;

comment on function public.get_active_stackacres_synergies(uuid, integer) is
  'The loadout applySynergyBuffs actually reads. Lazily deletes the whole loadout the first time it is asked for after the session has gone idle past p_idle_ms -- there is no separate sweep job.';

revoke all on function public.get_active_stackacres_synergies(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_active_stackacres_synergies(uuid, integer) to service_role;

-- Explicit clear for a clean sign-out/leave, so a player doesn't have to
-- wait out the idle window to pick a fresh loadout next time. Lazy staleness
-- above is the authority; this is only ever an earlier trigger of the same
-- outcome, never a second source of truth.
create or replace function public.clear_stackacres_session_perks(p_profile_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.stackacres_session_perks where profile_id = p_profile_id;
$$;

comment on function public.clear_stackacres_session_perks(uuid) is
  'Explicit early clear of the session loadout (e.g. on sign-out). The lazy sweep in get_active_stackacres_synergies is what actually guarantees clearing -- this just doesn''t make a player wait for it.';

revoke all on function public.clear_stackacres_session_perks(uuid) from public, anon, authenticated;
grant execute on function public.clear_stackacres_session_perks(uuid) to service_role;
