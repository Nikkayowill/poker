-- Every existing Gold RPC (spend_gold, credit_gold, spend_gold_by_profile,
-- credit_gold_by_profile) only mutates profiles.gold_balance -- there is no
-- row anywhere recording WHY a balance changed. That makes an orphaned debit
-- (the caller's process dies between debiting a stake and creating the thing
-- it paid for) indistinguishable after the fact from a legitimate spend: the
-- balance is just lower, with nothing to reconcile against.
--
-- This adds an append-only ledger and a new pair of ledgered, idempotent
-- spend/credit functions keyed by profile id, for staked-game call sites to
-- adopt one at a time. Deliberately NOT a refactor of the four live
-- functions above, same reasoning 20260812120000_gold_by_profile_rpcs.sql
-- already gives for not sharing a body with them: they move real Gold today,
-- and migrations here are append-only.
--
-- p_correlation_id is the caller's idempotency key (e.g.
-- 'blackjack_stake:<round-id>'). A retry with the same key and kind is a
-- no-op that returns the original result rather than moving Gold again --
-- this is what lets a reconciliation sweep safely re-issue a refund without
-- risking a double-credit if the original call actually did land.

-- 'confirmed' is not a Gold movement: it is the caller saying "the thing this
-- debit paid for now exists" (e.g. right after a PvP challenge row is
-- created). Without it, the reconciliation sweep below cannot tell a debit
-- that is still legitimately open -- an unaccepted duel challenge can sit
-- staked for hours -- from one whose process died before creating anything.
-- Only 'debit' and 'credit' rows carry a real amount; 'confirmed' is always 0.
create table public.gold_ledger (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  kind text not null check (kind in ('debit', 'credit', 'confirmed')),
  correlation_id text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint gold_ledger_amount_shape check (
    (kind = 'confirmed' and amount = 0) or (kind <> 'confirmed' and amount <> 0)
  )
);

comment on table public.gold_ledger is
  'Append-only audit trail behind spend_gold_by_profile_ledgered/credit_gold_by_profile_ledgered. correlation_id+kind is the idempotency key a retry or reconciliation sweep checks before moving Gold again. Service-role only.';

-- One debit and one credit per correlation_id, not one row overall: a stake
-- debit and its eventual settlement credit share a correlation_id on
-- purpose, so a reconciliation sweep can find "a debit with no matching
-- credit" by checking not exists (correlation_id, kind = 'credit').
create unique index gold_ledger_correlation_kind_idx
  on public.gold_ledger (correlation_id, kind);

create index gold_ledger_profile_id_idx on public.gold_ledger (profile_id);

alter table public.gold_ledger enable row level security;

create or replace function public.spend_gold_by_profile_ledgered(
  p_profile_id uuid,
  p_amount integer,
  p_correlation_id text,
  p_reason text
)
returns table (success boolean, gold_balance integer, already_applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_unlimited boolean;
  v_existing_amount integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid Gold amount' using errcode = '22023';
  end if;
  if p_correlation_id is null or length(trim(p_correlation_id)) = 0 then
    raise exception 'correlation_id is required' using errcode = '22023';
  end if;

  select l.amount into v_existing_amount
  from public.gold_ledger as l
  where l.correlation_id = p_correlation_id and l.kind = 'debit';

  if found then
    select p.gold_balance into v_balance from public.profiles as p where p.id = p_profile_id;
    if not found then
      return query select false, 0, false;
      return;
    end if;
    return query select true, v_balance, true;
    return;
  end if;

  select p.gold_balance, p.unlimited_gold into v_balance, v_unlimited
  from public.profiles as p
  where p.id = p_profile_id
  for update;

  if not found then
    return query select false, 0, false;
    return;
  end if;

  if not v_unlimited and v_balance < p_amount then
    return query select false, v_balance, false;
    return;
  end if;

  if not v_unlimited then
    update public.profiles
    set gold_balance = public.profiles.gold_balance - p_amount,
        updated_at = now()
    where id = p_profile_id
    returning public.profiles.gold_balance into v_balance;

    insert into public.gold_ledger (profile_id, amount, kind, correlation_id, reason)
    values (p_profile_id, -p_amount, 'debit', p_correlation_id, p_reason);
  end if;

  return query select true, v_balance, false;
end;
$$;

create or replace function public.credit_gold_by_profile_ledgered(
  p_profile_id uuid,
  p_amount integer,
  p_correlation_id text,
  p_reason text
)
returns table (success boolean, gold_balance integer, already_applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_unlimited boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid Gold amount' using errcode = '22023';
  end if;
  if p_correlation_id is null or length(trim(p_correlation_id)) = 0 then
    raise exception 'correlation_id is required' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.gold_ledger as l
    where l.correlation_id = p_correlation_id and l.kind = 'credit'
  ) then
    select p.gold_balance into v_balance from public.profiles as p where p.id = p_profile_id;
    if not found then
      return query select false, 0, false;
      return;
    end if;
    return query select true, v_balance, true;
    return;
  end if;

  select p.gold_balance, p.unlimited_gold into v_balance, v_unlimited
  from public.profiles as p
  where p.id = p_profile_id
  for update;

  if not found then
    return query select false, 0, false;
    return;
  end if;

  if not v_unlimited then
    update public.profiles
    set gold_balance = public.profiles.gold_balance + p_amount,
        updated_at = now()
    where id = p_profile_id
    returning public.profiles.gold_balance into v_balance;

    insert into public.gold_ledger (profile_id, amount, kind, correlation_id, reason)
    values (p_profile_id, p_amount, 'credit', p_correlation_id, p_reason);
  end if;

  return query select true, v_balance, false;
end;
$$;

-- Marks a debit's correlation_id as backed by a real created row, so the
-- reconciliation sweep never touches it again regardless of how long the
-- thing it paid for stays open (an unaccepted duel challenge, an unfinished
-- StackAcres action). Idempotent via the same unique index everything else
-- here relies on -- a duplicate confirm is a silent no-op, not an error.
create or replace function public.confirm_gold_debit_ledgered(p_correlation_id text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.gold_ledger (profile_id, amount, kind, correlation_id, reason)
  select l.profile_id, 0, 'confirmed', p_correlation_id, 'confirms:' || l.reason
  from public.gold_ledger as l
  where l.correlation_id = p_correlation_id and l.kind = 'debit'
  on conflict (correlation_id, kind) do nothing;
$$;

-- Same posture as every other Gold function: service role only.
revoke all on function public.spend_gold_by_profile_ledgered(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.credit_gold_by_profile_ledgered(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.confirm_gold_debit_ledgered(text) from public, anon, authenticated;
grant execute on function public.spend_gold_by_profile_ledgered(uuid, integer, text, text) to service_role;
grant execute on function public.credit_gold_by_profile_ledgered(uuid, integer, text, text) to service_role;
grant execute on function public.confirm_gold_debit_ledgered(text) to service_role;

-- Finds debits with no matching settlement/refund credit AND no 'confirmed'
-- marker, past a grace window. The grace window is a parameter, not
-- hardcoded, so the cron route controls it rather than a migration.
--
-- Unconfirmed is the load-bearing condition, not "no credit yet": a
-- confirmed debit (the row it paid for was created) can legitimately stay
-- uncredited for a long time -- that is just an open stake, not an orphan.
-- Only a debit that is BOTH unconfirmed AND uncredited past the window means
-- the create-or-refund step never ran at all.
create or replace function public.find_orphaned_gold_debits(p_older_than_minutes integer)
returns table (correlation_id text, profile_id uuid, amount integer, reason text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select d.correlation_id, d.profile_id, -d.amount as amount, d.reason, d.created_at
  from public.gold_ledger as d
  where d.kind = 'debit'
    and d.created_at < now() - make_interval(mins => p_older_than_minutes)
    and not exists (
      select 1 from public.gold_ledger as other
      where other.correlation_id = d.correlation_id and other.kind in ('credit', 'confirmed')
    );
$$;

revoke all on function public.find_orphaned_gold_debits(integer) from public, anon, authenticated;
grant execute on function public.find_orphaned_gold_debits(integer) to service_role;
