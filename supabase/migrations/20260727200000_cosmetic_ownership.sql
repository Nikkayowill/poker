-- Cosmetic ownership. The catalog itself lives in TypeScript, so this table
-- deliberately stores only an opaque cosmetic_id: adding an item needs no
-- migration, and a removed item leaves a harmless orphan row rather than a
-- broken foreign key.
create table public.player_cosmetics (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  cosmetic_id text not null,
  acquired_at timestamptz not null default now(),
  -- How it was obtained, so a purchase can be told from an award later.
  source text not null default 'purchase' check (source in ('purchase', 'award')),
  primary key (profile_id, cosmetic_id)
);

comment on table public.player_cosmetics is
  'Which cosmetics a profile owns. The catalog is code; only ownership is data.';

alter table public.player_cosmetics enable row level security;
revoke all privileges on table public.player_cosmetics from public, anon, authenticated;

create index player_cosmetics_profile_idx on public.player_cosmetics(profile_id);

-- Currently equipped item per slot. JSONB for the same reason as
-- avatar_config: a new slot is a catalog change, not a schema change.
alter table public.profiles
  add column equipped jsonb;

comment on column public.profiles.equipped is
  'Equipped cosmetic per slot; null falls back to the room defaults.';

-- Buying has to be atomic: check the balance, take the Gold, and record the
-- item in one locked transaction, or a player could spend once and own twice
-- (or own once and pay twice) under concurrent requests.
--
-- The output columns are named ok/reason/new_balance rather than reusing a
-- profiles column name. A RETURNS TABLE column shadows the real column
-- inside the function body, which is exactly what broke spend_gold earlier
-- with "column reference gold_balance is ambiguous".
create or replace function public.purchase_cosmetic(
  p_token uuid,
  p_cosmetic_id text,
  p_price integer
)
returns table (ok boolean, reason text, new_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_balance integer;
  v_unlimited boolean;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'Invalid price' using errcode = '22023';
  end if;

  select p.id, p.gold_balance, p.unlimited_gold
    into v_profile_id, v_balance, v_unlimited
  from public.profiles as p
  where p.session_token = p_token
  for update;

  if not found then
    return query select false, 'not_found'::text, 0;
    return;
  end if;

  if exists (
    select 1 from public.player_cosmetics as c
    where c.profile_id = v_profile_id and c.cosmetic_id = p_cosmetic_id
  ) then
    return query select false, 'already_owned'::text, v_balance;
    return;
  end if;

  if not v_unlimited and v_balance < p_price then
    return query select false, 'insufficient'::text, v_balance;
    return;
  end if;

  -- An unlimited-Gold profile owns the item without paying, mirroring
  -- spend_gold: it is never charged, so it must never be debited here.
  if not v_unlimited then
    update public.profiles
    set gold_balance = public.profiles.gold_balance - p_price,
        updated_at = now()
    where session_token = p_token
    returning public.profiles.gold_balance into v_balance;
  end if;

  insert into public.player_cosmetics (profile_id, cosmetic_id, source)
  values (v_profile_id, p_cosmetic_id, 'purchase');

  return query select true, 'ok'::text, v_balance;
end;
$$;

revoke all on function public.purchase_cosmetic(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.purchase_cosmetic(uuid, text, integer) to service_role;
