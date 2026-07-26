-- Supabase's optional automatic-RLS event trigger function exists in this
-- project outside the application migration history. It never needs to be
-- callable through PostgREST.
revoke execute on function public.rls_auto_enable()
  from public, anon, authenticated;

comment on function public.rls_auto_enable() is
  'Event-trigger helper only; direct API execution is intentionally revoked.';
