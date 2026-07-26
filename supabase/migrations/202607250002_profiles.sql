-- Persistent player profiles and user-supplied avatars.

create type public.avatar_preset as enum (
  'ace', 'crown', 'diamond', 'lucky', 'bolt', 'river'
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  session_token uuid not null unique
    references public.player_sessions(token) on delete cascade,
  display_name varchar(18) not null
    check (char_length(trim(display_name)) between 1 and 18),
  initials varchar(2) not null
    check (char_length(initials) between 1 and 2),
  avatar_preset public.avatar_preset not null default 'ace',
  avatar_url text,
  avatar_path text,
  accent varchar(7) not null default '#e7c66a'
    check (accent ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (avatar_url is null and avatar_path is null)
    or (avatar_url is not null and avatar_path is not null)
  )
);

create index profiles_updated_at_idx on public.profiles(updated_at desc);

alter table public.profiles enable row level security;

-- Profiles are read and changed only by the server after validating the
-- HttpOnly session cookie. There are intentionally no browser-facing policies.

alter table public.game_seats
  add column profile_id uuid references public.profiles(id) on delete set null,
  add column initials varchar(2) not null default 'P'
    check (char_length(initials) between 1 and 2),
  add column avatar_preset public.avatar_preset not null default 'ace',
  add column avatar_url text,
  add column accent varchar(7) not null default '#e7c66a'
    check (accent ~ '^#[0-9a-fA-F]{6}$');

create index game_seats_profile_id_idx
  on public.game_seats(profile_id)
  where profile_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.profiles is
  'Server-managed player identity and visual customization; session tokens never reach JavaScript.';
comment on column public.profiles.avatar_path is
  'Internal Storage object path used for safe replacement and cleanup.';
