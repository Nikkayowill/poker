-- Hidden secrets: a generic per-player item-id/quantity ledger for the
-- lucky_poker_dice easter egg (three tap-to-discover map spots, plus the
-- item's own Museum/Tools/Market interlock).
--
-- An earlier draft of this feature revived the barn-era homestead_inventory
-- table/adjust_homestead_inventory RPC for this, on the reasoning that their
-- shape (a free-form item-id/quantity row per player) already fit and cost
-- no new migration. 20260904190000_stackacres_museum_secrets.sql landed on
-- main in the meantime and its own commit message says plainly that table
-- should stay dead, not be resurrected -- so this feature gets its own table
-- instead, same shape, new name. `item_id` is free-form text on purpose, the
-- same reasoning homestead_inventory's own header already gave: a real
-- collectible (lucky_poker_dice) and two marker/flag keys that are not
-- collectibles at all (a crit-boost-armed flag, a per-zone daily attempt
-- marker) all fit one non-negative counter per (profile, item_id).
--
-- NAME CHECKED AGAINST THE LIVE SCHEMA, not just this repo's migrations:
-- confirmed via information_schema that homestead_secret_ledger and
-- adjust_homestead_secret_ledger are both free.

create table public.homestead_secret_ledger (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

comment on table public.homestead_secret_ledger is
  'Hidden secrets'' own item/flag counters: lucky_poker_dice held, a crit-boost-armed flag, and per-zone daily attempt markers. Service-role only.';

alter table public.homestead_secret_ledger enable row level security;
revoke all on public.homestead_secret_ledger from anon, authenticated;

-- Row-locking RPC, never a read-then-write, same reasoning credit_gold and
-- adjust_homestead_inventory both give: two tabs spending the same dice must
-- not both see the pre-spend quantity. The check constraint is what makes an
-- over-spend lose the race rather than go negative -- callers treat the
-- thrown 23514 as a refusal, not an error to surface.
create or replace function public.adjust_homestead_secret_ledger(
  p_profile_id uuid,
  p_item_id text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_quantity integer;
begin
  insert into public.homestead_secret_ledger as l (profile_id, item_id, quantity)
  values (p_profile_id, p_item_id, greatest(p_delta, 0))
  on conflict (profile_id, item_id) do update
    set quantity = l.quantity + p_delta,
        updated_at = now()
  returning l.quantity into next_quantity;

  return next_quantity;
end;
$$;

comment on function public.adjust_homestead_secret_ledger(uuid, text, integer) is
  'Moves one hidden-secrets item/flag counter by p_delta, refusing (via the quantity >= 0 check) to go negative.';

-- `public` is load-bearing here, not redundant with anon/authenticated: see
-- reference_stackchips_revoke_execute_from_public -- omitting it has shipped
-- a SECURITY DEFINER function anonymously callable on /rest/v1/rpc twice
-- already. Verify with \df+ / proacl after applying, not by re-reading this
-- file.
revoke all on function public.adjust_homestead_secret_ledger(uuid, text, integer) from public, anon, authenticated;
