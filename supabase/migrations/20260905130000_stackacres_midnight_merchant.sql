-- The Midnight Merchant: a temporary, per-profile NPC event on the StackAcres
-- farm. A visit is spawned by the server (a milestone, e.g. a critical
-- harvest -- see lib/domain-events.ts's DomainEvent union -- or a session-idle
-- tick, never a client request naming its own trigger), lasts one bounded
-- window, and sells a short, profile-scoped stock list at a price that
-- climbs 20% with every consecutive item the SAME visit sells that player --
-- see lib/stackacres/midnight-merchant.ts's `priceForNextPurchase`, which
-- this schema exists to make impossible to bypass from the client.
--
-- WHY TWO DISPOSABLE TABLES, UNLOGGED, THE SAME AS stackacres_session_perks
-- (20260904200000_stackacres_synergy_tree.sql): a visit is exactly as
-- long-lived as the Synergy loadout it sits beside -- gone the moment the
-- session that spawned it goes idle -- and losing one to a crash reads to the
-- player exactly like their session going stale on its own. WAL durability
-- buys nothing here and costs every spawn/redeem an extra fsync.
--
-- The one thing in this file that is NOT disposable is
-- `stackacres_midnight_merchant_ledger`: a durable, append-only row per
-- completed sale, for the same reason `game_actions` is durable -- it is the
-- record a support dispute or an economy audit needs, and it is the thing
-- that lets a re-run of `redeem_midnight_merchant_item` under an already-used
-- idempotency key be answered without re-charging Gold (see
-- lib/server/stackacres-intent-store.ts, which this feature reuses wholesale
-- rather than inventing a second dedup path -- the ledger here is evidence,
-- not the dedup mechanism itself).
--
-- LOCK ORDER, fixed everywhere in this file so spawn and redeem can never
-- deadlock against each other: `stackacres_midnight_merchant_state` row
-- first, then `stackacres_midnight_merchant_stock` row, then (only inside
-- `redeem_midnight_merchant_item`, via the nested call) `profiles` row via
-- `spend_gold_by_profile`'s own lock. Every function below acquires locks in
-- exactly this order and releases them all at commit; never take a stock row
-- before its state row.
--
-- SESSION LIVENESS: the one canonical "is this session still alive" signal
-- in the codebase is `player_sessions.last_seen_at`
-- (lib/server/game-store.ts's own `.gt("last_seen_at", cutoffIso)` idiom).
-- `get_active_stackacres_synergies` (20260904200000) reads it by comparing
-- `player_sessions.token` directly against the profile id it was passed --
-- those are two different uuid columns (`profiles.session_token` is the FK
-- to `player_sessions.token`; `profiles.id` is its own primary key), so that
-- comparison only works if the caller happens to pass a session token where
-- the function's own name says "profile id". That function is unwired (no
-- route calls it yet), so the bug has shipped no visible symptom -- but nothing
-- here repeats it: `stackacres_merchant_is_session_live` below joins through
-- `profiles.session_token`, explicitly, the same way every Gold RPC in this
-- file already joins `profiles` by `id`.

create table public.stackacres_midnight_merchant_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  spawned_at timestamptz not null default now(),
  expires_at timestamptz not null,
  trigger text not null check (trigger in ('critical_harvest', 'session_idle_tick', 'admin_grant')),
  purchase_streak integer not null default 0 check (purchase_streak >= 0),
  last_purchase_at timestamptz,
  updated_at timestamptz not null default now()
) with (autovacuum_enabled = true);
alter table public.stackacres_midnight_merchant_state set unlogged;

comment on table public.stackacres_midnight_merchant_state is
  'One disposable row per profile: the currently-active Midnight Merchant visit, if any. UNLOGGED -- see this file''s header.';
comment on column public.stackacres_midnight_merchant_state.purchase_streak is
  'How many items THIS visit has sold this player, consecutively -- resets to 0 only when a new visit spawns, never decremented by anything else. Read under FOR UPDATE by redeem_midnight_merchant_item and is what its 20%-per-item price ladder is computed from.';

create table public.stackacres_midnight_merchant_stock (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  base_price integer not null check (base_price > 0),
  remaining integer not null check (remaining >= 0),
  primary key (profile_id, item_id)
);
alter table public.stackacres_midnight_merchant_stock set unlogged;

comment on table public.stackacres_midnight_merchant_stock is
  'This visit''s stock list, seeded once by spawn_midnight_merchant and only ever decremented. A row surviving past its state row''s expiry is inert leftover, cleared by the next spawn -- see that function''s DELETE.';

create table public.stackacres_midnight_merchant_ledger (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  price_paid integer not null check (price_paid > 0),
  streak_at_purchase integer not null check (streak_at_purchase >= 0),
  spawned_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index stackacres_midnight_merchant_ledger_profile_idx
  on public.stackacres_midnight_merchant_ledger(profile_id, created_at desc);

comment on table public.stackacres_midnight_merchant_ledger is
  'Durable, append-only: one row per completed sale, kept even after the visit that made it expires and its state/stock rows are gone. Not the dedup mechanism (the intent-key store already owns that) -- this is the audit trail a Gold dispute or an economy pass reads.';

alter table public.stackacres_midnight_merchant_state enable row level security;
alter table public.stackacres_midnight_merchant_stock enable row level security;
alter table public.stackacres_midnight_merchant_ledger enable row level security;
-- No client policies on any of the three: every read a browser needs comes
-- back through readStackAcres's own view (service role only), the same
-- posture stackacres_session_perks and homestead_inventory both already take.

/**
 * Whether `p_profile_id`'s own session is still live, by the ONE canonical
 * signal (`player_sessions.last_seen_at`) reached through the correct join
 * (`profiles.session_token`, not the profile id itself -- see header). A
 * profile with no session_token at all (never issued one, or it was cleared)
 * reads as not live: a Merchant visit cannot outlive a session that does not
 * exist.
 */
create or replace function public.stackacres_merchant_is_session_live(
  p_profile_id uuid,
  p_idle_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_seen timestamptz;
begin
  select ps.last_seen_at into v_last_seen
  from public.profiles as p
  join public.player_sessions as ps on ps.token = p.session_token
  where p.id = p_profile_id;

  if v_last_seen is null then
    return false;
  end if;

  return v_last_seen >= now() - make_interval(secs => p_idle_ms / 1000.0);
end;
$$;

revoke all on function public.stackacres_merchant_is_session_live(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.stackacres_merchant_is_session_live(uuid, integer) to service_role;

/**
 * Spawns (or re-spawns) a visit for `p_profile_id`. Server-called only, on a
 * milestone the caller has already verified -- this function trusts
 * `p_trigger` and `p_items` completely, which is why it is service-role-only
 * and takes no request-shaped input.
 *
 * Idempotent per already-active visit: if a live, unexpired visit already
 * exists for this profile, this is a no-op that returns false rather than
 * resetting the streak or restocking under a player mid-purchase. A caller
 * that wants to force a fresh visit (e.g. an admin grant) must let the
 * existing one expire first or explicitly call
 * `expire_midnight_merchant_visit`.
 *
 * `p_items` is a jsonb array of `{ "item_id": text, "base_price": integer,
 * "quantity": integer }` objects -- validated by shape here (never by
 * catalog membership; that is `lib/stackacres/midnight-merchant.ts`'s job,
 * the same split `stackacres-service.ts` keeps between "the server decided
 * what is allowed" and "the database enforces what was decided").
 */
create or replace function public.spawn_midnight_merchant(
  p_profile_id uuid,
  p_trigger text,
  p_window_ms integer,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing record;
  v_expires_at timestamptz := now() + make_interval(secs => p_window_ms / 1000.0);
  v_item jsonb;
begin
  if p_window_ms is null or p_window_ms <= 0 then
    raise exception 'Invalid Midnight Merchant window' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Midnight Merchant needs at least one item' using errcode = '22023';
  end if;

  select * into v_existing
  from public.stackacres_midnight_merchant_state
  where profile_id = p_profile_id
  for update;

  if found and v_existing.expires_at > now() then
    return false;
  end if;

  -- Either no row yet, or the previous visit has expired -- clear its
  -- leftover stock before seeding the new list, same table, same lock order
  -- (state row already held above; stock next).
  delete from public.stackacres_midnight_merchant_stock where profile_id = p_profile_id;

  insert into public.stackacres_midnight_merchant_state
    (profile_id, spawned_at, expires_at, trigger, purchase_streak, last_purchase_at, updated_at)
  values (p_profile_id, now(), v_expires_at, p_trigger, 0, null, now())
  on conflict (profile_id) do update
  set spawned_at = excluded.spawned_at,
      expires_at = excluded.expires_at,
      trigger = excluded.trigger,
      purchase_streak = 0,
      last_purchase_at = null,
      updated_at = now();

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if not (v_item ? 'item_id' and v_item ? 'base_price' and v_item ? 'quantity') then
      raise exception 'Malformed Midnight Merchant item' using errcode = '22023';
    end if;
    insert into public.stackacres_midnight_merchant_stock (profile_id, item_id, base_price, remaining)
    values (
      p_profile_id,
      v_item ->> 'item_id',
      (v_item ->> 'base_price')::integer,
      (v_item ->> 'quantity')::integer
    );
  end loop;

  return true;
end;
$$;

revoke all on function public.spawn_midnight_merchant(uuid, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.spawn_midnight_merchant(uuid, text, integer, jsonb) to service_role;

/**
 * Reads the live visit for `p_profile_id`, sweeping it away first if the
 * session has gone idle -- the exact lazy-sweep contract
 * `get_active_stackacres_synergies` documents for the Synergy loadout,
 * restated here rather than shared, since these are two independently
 * evolving disposable-state tables the same way that migration's own header
 * explains for its cousins.
 *
 * Returns zero rows for "no visit" (expired, swept, or never spawned) --
 * callers branch on FOUND, they do not inspect a null placeholder row.
 */
create or replace function public.get_midnight_merchant_state(
  p_profile_id uuid,
  p_idle_ms integer default 1800000
)
returns table (
  spawned_at timestamptz,
  expires_at timestamptz,
  trigger text,
  purchase_streak integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live boolean;
begin
  v_live := public.stackacres_merchant_is_session_live(p_profile_id, p_idle_ms);

  if not v_live then
    delete from public.stackacres_midnight_merchant_stock where profile_id = p_profile_id;
    delete from public.stackacres_midnight_merchant_state where profile_id = p_profile_id;
    return;
  end if;

  return query
    select s.spawned_at, s.expires_at, s.trigger, s.purchase_streak
    from public.stackacres_midnight_merchant_state as s
    where s.profile_id = p_profile_id and s.expires_at > now();

  if not found then
    -- Expired on the clock even though the session is still live -- same
    -- cleanup, different reason.
    delete from public.stackacres_midnight_merchant_stock where profile_id = p_profile_id;
    delete from public.stackacres_midnight_merchant_state where profile_id = p_profile_id;
  end if;
end;
$$;

revoke all on function public.get_midnight_merchant_state(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_midnight_merchant_state(uuid, integer) to service_role;

/** Reads the live visit's remaining stock, in the same "swept first" shape
 *  as get_midnight_merchant_state -- called right after it by the store, so
 *  a caller that has already confirmed a live visit through that function
 *  never has this one race the sweep out from under it (same transactionless
 *  two-call shape stackacres-store.ts already uses elsewhere; each read is
 *  independently safe because a swept table simply returns no rows). */
create or replace function public.get_midnight_merchant_stock(p_profile_id uuid)
returns table (item_id text, base_price integer, remaining integer)
language sql
security definer
set search_path = public
stable
as $$
  select st.item_id, st.base_price, st.remaining
  from public.stackacres_midnight_merchant_stock as st
  join public.stackacres_midnight_merchant_state as s on s.profile_id = st.profile_id
  where st.profile_id = p_profile_id and s.expires_at > now();
$$;

revoke all on function public.get_midnight_merchant_stock(uuid) from public, anon, authenticated;
grant execute on function public.get_midnight_merchant_stock(uuid) to service_role;

/**
 * Buys one unit of `p_item_id` from `p_profile_id`'s active visit. The one
 * function in this file that moves Gold, so it is the one that matters most:
 *
 *   1. Lock the state row FOR UPDATE (lock order: state, then stock, then --
 *      via the nested call below -- profiles). Refuse if there is no live,
 *      unexpired visit; a lapsed session is swept here exactly like
 *      get_midnight_merchant_state does, so an expired visit can never be
 *      bought from just because nothing has read it since it lapsed.
 *   2. Lock the matching stock row FOR UPDATE. Refuse if it does not exist
 *      or is already at zero.
 *   3. Price this purchase from the streak ALREADY on the locked state row --
 *      ceil(base_price * 1.2 ^ purchase_streak) -- so two concurrent redeem
 *      calls for the same profile can never both read streak N and both
 *      charge the same discounted price; the second one blocks on the FOR
 *      UPDATE above until the first commits its streak+1.
 *   4. Debit Gold through spend_gold_by_profile -- the same row-locked,
 *      unlimited-Gold-aware primitive every other Gold spend in this app
 *      uses (see 20260812120000_gold_by_profile_rpcs.sql). If it refuses
 *      (insufficient Gold), return failure and touch NOTHING else: no stock
 *      decrement, no streak increment, no ledger row.
 *   5. Only once Gold has actually left: decrement stock, increment the
 *      streak, and insert one ledger row. All three happen in the same
 *      transaction as the debit above, so a crash between them is
 *      impossible to observe as a stock decrement with no matching charge,
 *      or a charge with no matching stock decrement.
 *
 * Returns a single row always (never zero), with `success` telling the
 * caller which of the above was reached; a false `success` always means
 * `price_paid`/`remaining`/`gold_balance` are all unchanged from before the
 * call, not partially applied.
 */
create or replace function public.redeem_midnight_merchant_item(
  p_profile_id uuid,
  p_item_id text,
  p_idle_ms integer default 1800000
)
returns table (
  success boolean,
  reason text,
  price_paid integer,
  streak integer,
  remaining integer,
  gold_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state record;
  v_stock record;
  v_price integer;
  v_spend record;
  v_live boolean;
begin
  v_live := public.stackacres_merchant_is_session_live(p_profile_id, p_idle_ms);

  select * into v_state
  from public.stackacres_midnight_merchant_state
  where profile_id = p_profile_id
  for update;

  if not found or not v_live or v_state.expires_at <= now() then
    if found then
      delete from public.stackacres_midnight_merchant_stock where profile_id = p_profile_id;
      delete from public.stackacres_midnight_merchant_state where profile_id = p_profile_id;
    end if;
    return query select false, 'no_merchant', null::integer, null::integer, null::integer, null::integer;
    return;
  end if;

  select * into v_stock
  from public.stackacres_midnight_merchant_stock
  where profile_id = p_profile_id and item_id = p_item_id
  for update;

  if not found or v_stock.remaining <= 0 then
    return query select false, 'sold_out', null::integer, v_state.purchase_streak, coalesce(v_stock.remaining, 0), null::integer;
    return;
  end if;

  v_price := ceil(v_stock.base_price * power(1.2, v_state.purchase_streak))::integer;

  select * into v_spend from public.spend_gold_by_profile(p_profile_id, v_price);

  if not v_spend.success then
    return query select false, 'insufficient_gold', v_price, v_state.purchase_streak, v_stock.remaining, v_spend.gold_balance;
    return;
  end if;

  update public.stackacres_midnight_merchant_stock
  set remaining = remaining - 1
  where profile_id = p_profile_id and item_id = p_item_id;

  update public.stackacres_midnight_merchant_state
  set purchase_streak = purchase_streak + 1,
      last_purchase_at = now(),
      updated_at = now()
  where profile_id = p_profile_id;

  insert into public.stackacres_midnight_merchant_ledger
    (profile_id, item_id, price_paid, streak_at_purchase, spawned_at)
  values (p_profile_id, p_item_id, v_price, v_state.purchase_streak, v_state.spawned_at);

  return query select
    true, null::text, v_price, v_state.purchase_streak + 1, v_stock.remaining - 1, v_spend.gold_balance;
end;
$$;

revoke all on function public.redeem_midnight_merchant_item(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.redeem_midnight_merchant_item(uuid, text, integer) to service_role;

/** Eager clear, the same courtesy clear_stackacres_session_perks gives its
 *  own table: the lazy sweep in get_midnight_merchant_state/
 *  redeem_midnight_merchant_item is what actually guarantees a visit cannot
 *  outlive its session, this just doesn't make a signing-out player wait for
 *  it. */
create or replace function public.expire_midnight_merchant_visit(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.stackacres_midnight_merchant_stock where profile_id = p_profile_id;
  delete from public.stackacres_midnight_merchant_state where profile_id = p_profile_id;
end;
$$;

revoke all on function public.expire_midnight_merchant_visit(uuid) from public, anon, authenticated;
grant execute on function public.expire_midnight_merchant_visit(uuid) to service_role;
