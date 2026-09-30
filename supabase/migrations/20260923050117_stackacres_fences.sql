/* -------------------------------------------------------------------- */
/* Fences the player builds: one row per piece, paid for in Wood         */
/* -------------------------------------------------------------------- */

-- One row per (profile, map square). tx/ty are Homestead map tiles, the
-- squares the farmer walks (lib/stackacres/fences.ts). Where a piece may go
-- is application code's call (open grass, no bed); this table only keeps
-- what was built.
create table public.homestead_fences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tx integer not null check (tx >= 0),
  ty integer not null check (ty >= 0),
  created_at timestamptz not null default now(),
  primary key (profile_id, tx, ty)
);

comment on table public.homestead_fences is
  'One fence piece per row on a profile''s Homestead, by map square. Written only by place_homestead_fence and remove_homestead_fence, which move the piece''s Wood in the same transaction. Service-role only.';

alter table public.homestead_fences enable row level security;
revoke all on public.homestead_fences from anon, authenticated;

-- Puts one piece up and takes its Wood, in one transaction, so a piece is
-- never standing without having been paid for and Wood never leaves for a
-- piece that did not go up. One farm's placements are serialised so the cap
-- holds under two taps at once.
--
-- Returns 'placed', or why not: 'taken' (a piece is already there), 'full'
-- (at the cap), 'short' (not enough Wood).
create or replace function public.place_homestead_fence(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer,
  p_wood integer,
  p_cap integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform pg_advisory_xact_lock(hashtext('homestead_fences:' || p_profile_id::text));

  if exists (
    select 1 from public.homestead_fences
     where profile_id = p_profile_id and tx = p_tx and ty = p_ty
  ) then
    return 'taken';
  end if;

  if (select count(*) from public.homestead_fences where profile_id = p_profile_id) >= p_cap then
    return 'full';
  end if;

  update public.homestead_processing_inventory
     set quantity = quantity - p_wood,
         updated_at = now()
   where profile_id = p_profile_id
     and item = 'wood'
     and quantity >= p_wood;
  if not found then
    return 'short';
  end if;

  insert into public.homestead_fences (profile_id, tx, ty) values (p_profile_id, p_tx, p_ty);
  return 'placed';
end;
$$;

-- Pulls one piece up and gives its Wood back, in one transaction. The delete
-- returns the row at most once, so two taps cannot both be paid.
create or replace function public.remove_homestead_fence(
  p_profile_id uuid,
  p_tx integer,
  p_ty integer,
  p_wood integer
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.homestead_fences
   where profile_id = p_profile_id and tx = p_tx and ty = p_ty;
  if not found then
    return false;
  end if;

  insert into public.homestead_processing_inventory as inv (profile_id, item, quantity)
  values (p_profile_id, 'wood', p_wood)
  on conflict (profile_id, item) do update
    set quantity = inv.quantity + p_wood,
        updated_at = now();
  return true;
end;
$$;

revoke execute on function public.place_homestead_fence(uuid, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.remove_homestead_fence(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.place_homestead_fence(uuid, integer, integer, integer, integer) to service_role;
grant execute on function public.remove_homestead_fence(uuid, integer, integer, integer) to service_role;
