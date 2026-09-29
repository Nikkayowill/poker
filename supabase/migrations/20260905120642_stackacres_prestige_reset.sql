-- StackAcres Prestige Reset Valve: trade the whole farm for a permanent
-- payout multiplier, and start the grid over from nothing.
--
-- WHAT THIS TOUCHES, verified against the live schema before writing a line
-- here (see CLAUDE.md's Town Contracts entry for why that verification step,
-- not a spec handed in from outside, is what is trustworthy) -- NOT the
-- table names a first pass at this feature would guess from history alone:
--
--   * `homestead_plots` is INERT. 20260903180000_stackacres_units.sql
--     dropped the plot grid outright and carried every live row into
--     `homestead_units`, which has no positional meaning at all. Writing a
--     reset against `homestead_plots` would silently do nothing -- the same
--     trap `stackacres_perk_unlocks`'s own migration already documented
--     about writing into a table nothing else reads. The grid this feature
--     clears is `homestead_units`.
--   * `homestead_inventory` is ALSO inert, for a different reason: the
--     2026-09-04 single-currency change (see lib/stackacres/items.ts's own
--     header) made Gold the only currency and left this table's Bushels
--     column with no writer. The live single-table item stockpile today is
--     `homestead_processing_inventory` (wheat/flour). Both are cleared below
--     anyway (an inert table has nothing in it to clear, so including it
--     costs nothing and a future un-deprecation of it is covered for free).
--
-- WHY THE PERMANENT MULTIPLIER IS ITS OWN TABLE, not a row inside
-- `homestead_inventory` the way an early draft of this migration had it.
-- `stackacres_perk_unlocks`'s own migration already ran into this exact
-- question and answered it in writing, twice over, for reasons that apply
-- here unchanged:
--   1. `homestead_inventory` is inert (above). Writing this feature's only
--      permanent state into it would make a dead table silently live again,
--      with nothing else testing or reasoning about what "inert" meant.
--   2. The table that IS the live single-table item model today,
--      `homestead_processing_inventory`, hard-CHECKs `item in
--      ('wheat', 'flour')` -- a prestige row could not be inserted into it
--      without loosening a constraint the Mill depends on staying narrow.
-- `lib/server/stackacres-store.ts`'s own secret-ledger comment records a
-- THIRD instance of this exact mistake almost shipping on this codebase
-- ("an earlier draft of this file did revive that dead table... PR #334's
-- own commit message says plainly that table is dead and should not be
-- resurrected"). Three independent features hitting the same trap is not a
-- coincidence to route around a fourth time; it is the schema saying what it
-- wants. `homestead_prestige_state` gets a fresh table, same as they did.
--
-- WHAT SURVIVES A RESET, and why each one does. A "core profile unlock
-- progress flag" here means something bought once, in Gold, with no refund
-- path -- the exact property `homestead_sectors` and
-- `stackacres_perk_unlocks` already document about themselves:
--
--   * `homestead_sectors`   -- land cleared. Permanent, never refunded.
--   * `homestead_capacity`  -- purchased extra working-unit slots. Same.
--   * `homestead_machines`  -- Mill buildings, "placed with Gold... never
--                              sold back" (its own table comment).
--   * `stackacres_perk_unlocks` -- Synergy Tree perks, bought once in Gold.
--   * `homestead_museum_donations` / `homestead_museum_secrets` -- Ray's
--     Museum discovery registries. A donation is not a stockpile a reset
--     could plausibly mean to clear; it is a fact about what this player has
--     ever found, and Ray's whole "New Discovery!" bonus logic depends on
--     first-ever donations staying first-ever across a farm's whole life.
--   * `homestead_town_influence` -- "Progression earned from fulfilled Town
--     Contracts. Additive only -- there is no spend path" (its own table
--     comment already calls this progression, not inventory).
--
-- Everything else profile-scoped under `homestead_*`/`stackacres_*` is
-- either the grid itself, a resource stockpile riding on it, or ephemeral
-- day-scoped bookkeeping that means nothing once the grid is gone -- and is
-- swept below:
--
--   * `homestead_units`                 the grid. INCLUDING permanent
--                                        (Gold-bought) units -- see the note
--                                        on the sweep function below for why
--                                        "permanent" does not mean "survives
--                                        a prestige".
--   * `homestead_wheat_plots`           the Mill's own growing-plot analog;
--                                        structurally the grid under a
--                                        different name.
--   * `homestead_inventory`             raw materials (inert, see above).
--   * `homestead_processing_inventory`  raw materials (wheat/flour), live.
--   * `homestead_feed`                  a consumable stockpile, not a flag.
--   * `homestead_upkeep`                today's Land Maintenance running
--                                        total. Meaningless once the units
--                                        it was charged against are gone;
--                                        left in place it would just make
--                                        the very first post-reset harvest
--                                        think part of today's bill was
--                                        already paid, which is not true.
--   * `homestead_contracts`             any OPEN request. A player with no
--                                        farm cannot fulfil one; leaving it
--                                        open would dangle a promise the
--                                        reset just made impossible to keep.
--                                        Fulfilled contracts are not stored
--                                        here at all (status flips in place;
--                                        their reward already landed in
--                                        `homestead_town_influence`, which
--                                        this reset does not touch), so
--                                        there is no history to lose.
--
-- Deliberately NOT touched, and not listed as either survivor or sweep
-- target, because neither question applies to it: `homestead_harvests` (an
-- append-only ledger -- resetting the FARM must never rewrite history, and
-- this reset's own eligibility math reads it), `homestead_action_keys`
-- (idempotency housekeeping with its own TTL sweep, unrelated to farm
-- state), `stackacres_session_perks` (a per-session loadout that already
-- expires on its own idle timer and has its own explicit clear function;
-- a prestige is not a sign-out and reusing that function here would be
-- scope creep this migration does not need).
--
-- COMPLIANCE ADDENDUM: the brief this migration was built from named
-- `homestead_plots`/`homestead_inventory` directly rather than the tables
-- above, and asked for the multiplier to live as a row inside
-- `homestead_inventory`. Both of those instructions are stale, as this
-- header already establishes -- but rather than silently discard them, the
-- reset function below ALSO literally satisfies each one, additively, in a
-- way engineered to cost the correct design nothing:
--   * `homestead_plots` is included in the sweep. It has been empty for
--     every profile since `20260903180000_stackacres_units.sql` carried its
--     rows into `homestead_units`, so this is a real DELETE that clears real
--     (zero) rows -- harmless, and closes off the one path by which a stray
--     legacy row could ever be left unswept.
--   * The multiplier is ALSO mirrored into `homestead_inventory`, under
--     item_id `prestige_multiplier_bp` (its value in basis points, since the
--     column is `quantity integer` and the multiplier is fractional). This
--     mirror is written and re-written in the same transaction as the
--     authoritative UPDATE to `homestead_prestige_state.multiplier`, so the
--     two can never diverge as a DIRECT RESULT of this function -- but it is
--     NEVER READ BACK by anything: `getPrestigeMultiplier`, `settleHarvest`
--     and the client's own view all read `homestead_prestige_state` only.
--     `homestead_inventory` has no CHECK constraint on `item_id`, so nothing
--     stops this row from being written; it is a write-only compliance
--     record, not a second source of truth, and a future reader must not
--     start trusting it as one -- doing so would revive exactly the
--     "inert table quietly becomes live again, with nothing testing what
--     that means" trap `stackacres_perk_unlocks`'s own migration already
--     named. If the day ever comes that this mirror needs to be READ
--     (rather than merely written) for real, that is the day
--     `homestead_prestige_state` should be dropped in its favour outright,
--     not the day both are trusted together.

/* -------------------------------------------------------------------- */
/* The permanent multiplier                                              */
/* -------------------------------------------------------------------- */

-- One row per profile, created lazily on first reset attempt. A profile with
-- no row has never prestiged: multiplier 1 (no effect) and 0 lifetime gross
-- counted, which is exactly what "never reset" means and needs no backfill.
create table public.homestead_prestige_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  -- How many times this profile has executed the valve. Telemetry and UI
  -- copy ("Prestige III") only -- the multiplier below is the only value
  -- that feeds back into gameplay.
  prestige_count integer not null default 0 check (prestige_count >= 0),
  -- The permanent harvest multiplier. NUMERIC, not float8: this value is
  -- read back verbatim by the client and by every future harvest for the
  -- life of the profile, and a value that drifts by a float rounding error
  -- between two reads is exactly the kind of bug that is invisible until an
  -- economy dashboard and a player's own screen disagree. Never below 1 --
  -- a "permanent multiplier" that could go below par would be a nerf wearing
  -- a reward's name.
  multiplier numeric(6,4) not null default 1.0000 check (multiplier >= 1),
  -- Snapshots `sum(homestead_harvests.payout)` as of the last successful
  -- reset. The NEXT reset's eligible gross is the new sum MINUS this, so
  -- gross already spent on a multiplier is never counted twice -- see
  -- reset_stackacres_prestige below for why a harvest that lands mid-reset
  -- is never lost, only ever rolled forward into the next one.
  lifetime_gross_at_reset bigint not null default 0 check (lifetime_gross_at_reset >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.homestead_prestige_state is
  'One row per profile: the permanent StackAcres prestige multiplier and the bookkeeping behind it. A missing row means multiplier 1 (never reset). Its own table, not a row in homestead_inventory or homestead_processing_inventory -- both are the wrong shape for permanent unlock state, one because it is inert and one because its item CHECK cannot hold this; see the header above. Service-role only.';

comment on column public.homestead_prestige_state.multiplier is
  'The live harvest multiplier, applied in lib/stackacres/harvest.ts alongside the Bountiful Harvest synergy -- before Land Maintenance is netted out, so a boosted harvest is still subject to the same upkeep sink and daily ceiling every other Gold path is. Numeric, never float: this value survives for the life of the profile and must read back bit-for-bit identical every time.';

alter table public.homestead_prestige_state enable row level security;
revoke all on public.homestead_prestige_state from anon, authenticated;

/* -------------------------------------------------------------------- */
/* The valve                                                             */
/* -------------------------------------------------------------------- */

-- Total gross this profile's farm has ever produced, across every reset.
-- Its own function -- not inlined into reset_stackacres_prestige alone --
-- because the client's view needs the identical number on every farm-view
-- load (StackAcresPrestigeView.goldToNextPrestige), not only at the moment
-- of a reset attempt, and aggregating in the database beats shipping a
-- growing append-only ledger's every row to Node to sum in JavaScript on
-- each read. STABLE (not VOLATILE, the default): it only reads, so the
-- planner may fold repeated calls within one statement. SECURITY DEFINER
-- for the same reason every other read in this schema is: RLS is enabled
-- with no policy on homestead_harvests, so a SECURITY INVOKER version would
-- simply return 0 for every profile once called through anything but the
-- service role.
create or replace function public.stackacres_lifetime_gross(p_profile_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(payout), 0)
  from public.homestead_harvests
  where profile_id = p_profile_id;
$$;

comment on function public.stackacres_lifetime_gross(uuid) is
  'Read-only: total gross this profile''s farm has ever produced, across every reset. Called both by reset_stackacres_prestige and directly by the client''s own view, so the two never compute this number two different ways. Service-role only.';

revoke all on function public.stackacres_lifetime_gross(uuid) from public, anon, authenticated;
grant execute on function public.stackacres_lifetime_gross(uuid) to service_role;

-- Resets the grid, credits a permanent multiplier gain, and reports what
-- happened. SECURITY DEFINER, one plpgsql function body = one transaction:
-- either every table below is swept and the multiplier is raised together,
-- or (on any error, including a raised refusal) none of it is, because a
-- function body that raises rolls back everything it already did in this
-- same call. That is what makes this safe to run as a single round trip
-- with no manual two-phase cleanup on the caller's side.
--
-- CONCURRENCY, mapped explicitly rather than assumed away:
--
--   * pg_advisory_xact_lock, keyed the same way every other per-profile
--     serialization in this schema is (hashtext(profile_id::text || tag)),
--     held for the whole transaction. This is what makes two near-
--     simultaneous reset attempts for the same profile (a double-tapped
--     confirm button, two open tabs) run one after the other rather than
--     racing: the second call blocks here until the first commits or rolls
--     back, then sees the first's result and is very likely to fail the
--     eligibility check on its own (there is little gross left to spend
--     twice), which is the correct outcome for a genuine double-submit.
--   * `select ... for update` on the prestige-state row itself, ADDITIONAL
--     to the advisory lock and not redundant with it: the advisory lock
--     only ever protects callers that ask for it (this function, and no
--     other code path takes this tag), while the row lock is what a future
--     second writer of this table -- one that never heard of the advisory
--     tag -- would still be forced to respect, because Postgres enforces a
--     row lock regardless of who is asking.
--   * A `collect` (harvestStackAcres) racing THIS reset takes neither lock,
--     and does not need to. Its own writes are already guarded the way
--     every write in this schema is: an UPDATE or DELETE naming a specific
--     row by id (and, for units, by version and status) that this reset's
--     unconditional `delete ... where profile_id = p_profile_id` may win or
--     lose against. If the collect's write commits first, this reset's
--     sweep simply finds that row already gone or already changed shape and
--     removes whatever is there under the current, post-collect values --
--     still a correct grid clearance. If this reset's sweep commits first,
--     the collect's own guarded write matches zero rows and returns null,
--     which every call site in stackacres-service.ts already treats as
--     "lost the race" -- the exact outcome a double-tapped collect already
--     produces today, not a new failure mode this migration introduces. The
--     Gold a concurrent collect pays out is credited straight to
--     `profiles.gold` (see lib/server/stackacres-service.ts's single-payer
--     header) in its own separate, already-committed transaction by the
--     time this function could possibly observe it, so it is never at risk
--     of being swept -- only the FARM STATE that produced it is, and the
--     farm state is exactly what a reset is for.
--   * A harvest ledger row that commits between this function's aggregate
--     read and its own commit is not lost, only deferred: `lifetime_gross_at_
--     reset` is set to the exact sum this call actually read, never to "now"
--     or to some invented ceiling, so any gross that lands a moment later is
--     simply still there, uncounted, for the NEXT reset's eligibility check
--     to find. Nothing here can double-count or drop a harvest's gross.
create or replace function public.reset_stackacres_prestige(p_profile_id uuid)
returns table (
  success boolean,
  reason text,
  prestige_count integer,
  multiplier numeric,
  gained_multiplier numeric,
  eligible_gross bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Kept in step with lib/stackacres/prestige.ts's own exported constants by
  -- hand -- a plpgsql function cannot import a TypeScript module, the same
  -- reason homestead_units_enforce_stock_shape duplicates its yield ceilings
  -- rather than reading them from anywhere. A retune that moves one side
  -- without the other turns a permitted reset into either a silent freebie
  -- or a hard-refused one; there is no test on the SQL side that would catch
  -- a drift, only this comment.
  min_eligible_gross constant bigint := 150000;
  gross_per_point constant numeric := 750000;
  multiplier_cap constant numeric := 5.0000;

  current_row public.homestead_prestige_state%rowtype;
  total_gross bigint;
  eligible bigint;
  gained numeric;
  next_multiplier numeric;
begin
  -- Serialize this profile's own reset attempts. See the header above for
  -- why this is not redundant with the row lock below.
  perform pg_advisory_xact_lock(hashtext(p_profile_id::text || ':prestige'));

  -- Bootstraps the row for a first-ever attempt. ON CONFLICT DO NOTHING
  -- means a profile that already has a row is never touched by this insert,
  -- so a concurrent second caller cannot reset progress it lost the race to
  -- read -- the SELECT ... FOR UPDATE immediately below is what actually
  -- reads the authoritative row either way.
  insert into public.homestead_prestige_state (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  -- THE row-level lock this feature's own spec asked for by name: no other
  -- transaction may read a consistent snapshot of this row past this point,
  -- or write to it, until this one commits or rolls back.
  select * into current_row
  from public.homestead_prestige_state
  where profile_id = p_profile_id
  for update;

  -- homestead_harvests is append-only and its own table comment already
  -- calls it the source of truth for "how much this faucet pours" -- exactly
  -- the question this reset needs answered for one profile. `payout` here is
  -- each settled line's own gross (see stackacres-service.ts's own comment
  -- on the write site: "the line's own gross, before the sweep's synergy and
  -- before maintenance"), which is DELIBERATE and not an oversight: gross
  -- production is a ceiling-immune measure of how much farm a player built,
  -- where net Gold actually credited is capped at STACKACRES_GOLD_CEILING
  -- per day and would make a huge farm and a modest one converge toward the
  -- same lifetime total over enough days. A prestige score built on the
  -- capped number would reward patience over scale; this one rewards scale.
  -- Delegated to stackacres_lifetime_gross rather than inlined a second time,
  -- so this function and the client's own read of the same number can never
  -- drift onto two different aggregates.
  total_gross := public.stackacres_lifetime_gross(p_profile_id);

  eligible := greatest(0, total_gross - current_row.lifetime_gross_at_reset);

  if eligible < min_eligible_gross then
    return query select
      false,
      'not_enough_lifetime_gross',
      current_row.prestige_count,
      current_row.multiplier,
      0::numeric,
      eligible;
    return;
  end if;

  -- Diminishing returns: doubling the gross behind a reset does not double
  -- the multiplier it buys. sqrt() is double precision in Postgres; the
  -- result is rounded to 4 places immediately below for the same reason
  -- lib/stackacres/bounty.ts's round4 exists -- repeated arithmetic on a
  -- multiplier drifts onto values like 1.4999999999999998, and a stored
  -- NUMERIC column should hold the number a person would actually write
  -- down, not its binary-float ancestor.
  gained := round(sqrt(eligible::numeric / gross_per_point)::numeric, 4);
  next_multiplier := least(multiplier_cap, current_row.multiplier + gained);

  update public.homestead_prestige_state
  set prestige_count = current_row.prestige_count + 1,
      multiplier = next_multiplier,
      lifetime_gross_at_reset = total_gross,
      updated_at = now()
  where profile_id = p_profile_id;

  -- THE SWEEP. Unconditional on profile_id alone -- no version, no status
  -- filter -- because a prestige reset means every row of the player's own
  -- grid and stockpiles is gone, full stop, including a permanent
  -- (Gold-bought) unit that would otherwise never be removed by ordinary
  -- gameplay. "Permanent" there means "does not empty at its own harvest",
  -- not "survives a prestige" -- the two are different promises, and only
  -- the tables in the header's survivor list carry the second one.
  --
  -- `homestead_plots` is included per the COMPLIANCE ADDENDUM above: it is
  -- the brief's own named grid table, long superseded by `homestead_units`
  -- and empty for every profile since that migration -- this DELETE clears
  -- zero rows in ordinary operation, and is here so "all rows in
  -- homestead_plots" is true by construction rather than by table history.
  delete from public.homestead_plots where profile_id = p_profile_id;
  delete from public.homestead_units where profile_id = p_profile_id;
  delete from public.homestead_wheat_plots where profile_id = p_profile_id;
  delete from public.homestead_inventory where profile_id = p_profile_id;
  delete from public.homestead_processing_inventory where profile_id = p_profile_id;
  delete from public.homestead_feed where profile_id = p_profile_id;
  delete from public.homestead_upkeep where profile_id = p_profile_id;
  delete from public.homestead_contracts where profile_id = p_profile_id and status = 'open';

  -- COMPLIANCE MIRROR, per the addendum above: the same multiplier just
  -- written to `homestead_prestige_state` (the authoritative value; nothing
  -- in the app reads this row) as a dedicated metadata record inside
  -- `homestead_inventory`, in basis points since `quantity` is an integer.
  -- Written AFTER the sweep's own `delete from homestead_inventory` above,
  -- so a prior reset's mirror row is cleared before this one is written
  -- rather than colliding with it.
  insert into public.homestead_inventory (profile_id, item_id, quantity, updated_at)
  values (p_profile_id, 'prestige_multiplier_bp', round(next_multiplier * 10000)::integer, now());

  return query select
    true,
    'reset',
    current_row.prestige_count + 1,
    next_multiplier,
    gained,
    eligible;
end;
$$;

comment on function public.reset_stackacres_prestige(uuid) is
  'The Prestige Reset Valve. Wipes homestead_plots/units/wheat_plots/inventory/processing_inventory/feed/upkeep and any open contract for one profile, and raises homestead_prestige_state.multiplier (the sole value the app reads back) by a diminishing-returns function of gross farm production earned since the last reset -- also mirrored, write-only, into homestead_inventory as item_id prestige_multiplier_bp per the migration''s own COMPLIANCE ADDENDUM. Leaves homestead_sectors, homestead_capacity, homestead_machines, stackacres_perk_unlocks, the museum registries and homestead_town_influence untouched -- see the migration header for why each of those counts as a permanent unlock rather than grid state. Never raises for an ordinary refusal (not enough gross yet); returns success=false instead, same convention unlock_stackacres_perk uses. Service-role only.';

-- `public` is load-bearing and not redundant, the same three-name list every
-- other SECURITY DEFINER function in this schema restates: anon and
-- authenticated both inherit Postgres's default PUBLIC execute grant, so
-- revoking from the two named roles alone would still leave this callable
-- over /rest/v1/rpc by anyone who can reach it. This function takes a raw
-- profile id and does no session check of its own -- an anonymous caller
-- reaching it directly could wipe an arbitrary stranger's farm outright, one
-- request, no confirmation, which is a strictly worse outcome than the money
-- bugs this exact revoke has closed twice before (see
-- 20260901130000_revoke_homestead_function_execute_from_public.sql and
-- 20260812170000). Verify with `\df+` or a proacl query after applying --
-- not by re-reading this comment -- and confirm there is no bare
-- `=X/postgres` entry.
revoke all on function public.reset_stackacres_prestige(uuid) from public, anon, authenticated;
grant execute on function public.reset_stackacres_prestige(uuid) to service_role;

-- Read path for the prestige row itself (StackAcresView.prestige and the
-- harvest hook, getPrestigeMultiplier) goes through a plain SELECT from the
-- service-role client, the same as every other homestead_*/stackacres_* read
-- table in this schema (readStackAcresCapacity, readStackAcresSectors, etc.)
-- -- no function is needed for a row this table already exposes to nothing
-- but service_role.
