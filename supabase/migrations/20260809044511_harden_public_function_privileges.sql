-- The public schema is exposed by PostgREST. Supabase's default database
-- privileges let PUBLIC create objects in that schema and execute newly
-- created functions unless explicitly revoked. Application RPCs are all
-- server-only and already grant service_role explicitly, so deny the ambient
-- privileges once here and make the safe default apply to future migrations.

revoke create on schema public from public;

revoke execute on all functions in schema public
  from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
