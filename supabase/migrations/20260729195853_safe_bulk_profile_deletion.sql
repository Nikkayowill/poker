-- Preserve Stripe's immutable payment ledger when a player asks to be erased
-- or an administrator removes test/duplicate profiles. The payment itself is
-- retained for reconciliation; only its now-deleted profile relationship is
-- detached.
alter table public.stripe_payments
  drop constraint if exists stripe_payments_profile_id_fkey;

alter table public.stripe_payments
  alter column profile_id drop not null;

alter table public.stripe_payments
  add constraint stripe_payments_profile_id_fkey
  foreign key (profile_id)
  references public.profiles(id)
  on delete set null;

comment on column public.stripe_payments.profile_id is
  'Profile credited by this payment. Null only when that profile was later permanently deleted; the payment ledger remains intact.';

-- One atomic database operation for both the single-row and bulk admin paths.
-- The service role invokes it through the server. It is SECURITY INVOKER and
-- unavailable to browser roles, so it adds no public deletion surface.
create or replace function public.delete_profiles(p_profile_ids uuid[])
returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted_ids uuid[];
begin
  if p_profile_ids is null or cardinality(p_profile_ids) = 0 then
    raise exception 'At least one profile id is required' using errcode = '22023';
  end if;
  if cardinality(p_profile_ids) > 1000 then
    raise exception 'A maximum of 1000 profiles may be deleted at once' using errcode = '22023';
  end if;

  with deleted as (
    delete from public.profiles
    where id = any(p_profile_ids)
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_deleted_ids
  from deleted;

  return v_deleted_ids;
end;
$$;

revoke all on function public.delete_profiles(uuid[])
  from public, anon, authenticated;
grant execute on function public.delete_profiles(uuid[])
  to service_role;

comment on function public.delete_profiles(uuid[]) is
  'Server-only atomic profile deletion used by the admin console; dependent audit payments are retained and detached.';
