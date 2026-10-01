/* -------------------------------------------------------------------- */
/* Visitor Mode: who may look at a farm, and the compliments they left  */
/* -------------------------------------------------------------------- */

-- One row per farm that has ever changed the setting. No row means private,
-- which is what every farm that exists today loads as: this ships with
-- nobody's farm newly visible to anybody.
--
-- 'friends' is as far as the check goes on purpose. A 'public' rung is the
-- next one and it is a constraint change plus one branch in
-- lib/stackacres/showcase.ts's `mayVisit`; leaving it out of the constraint
-- now means a client that hand-rolls the value gets a database refusal
-- rather than a farm on the open internet.
create table public.homestead_farm_showcase (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'friends')),
  updated_at timestamptz not null default now()
);

comment on table public.homestead_farm_showcase is
  'Who may open a profile''s farm in read-only Visitor Mode. No row means private. Service-role only; see lib/server/stackacres-showcase-store.ts.';

alter table public.homestead_farm_showcase enable row level security;
revoke all on public.homestead_farm_showcase from anon, authenticated;

-- One row per (farm, visitor, reaction): the unique primary key is what makes
-- a reaction land exactly once however many times the button is pressed, so
-- no application-side check has to be right about it. Counting rows is what
-- the tallies on the farm's own header are.
--
-- No text and no downvote -- the vocabulary is the three ids in
-- lib/stackacres/showcase.ts's SHOWCASE_REACTIONS, restated here because a
-- misspelled id inserted by anything is worth refusing at the table.
--
-- Deliberately NOT a notification and NOT a payout: reacting moves no Gold
-- and pings nobody. It is a tally the owner sees next time they look.
create table public.homestead_farm_reactions (
  farm_profile_id uuid not null references public.profiles(id) on delete cascade,
  viewer_profile_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('nice_layout', 'great_farm', 'impressive_production')),
  created_at timestamptz not null default now(),
  primary key (farm_profile_id, viewer_profile_id, reaction),
  -- Nobody compliments their own farm. Checked here as well as in the
  -- service, because this one is cheap and absolute.
  constraint homestead_farm_reactions_not_own check (farm_profile_id <> viewer_profile_id)
);

comment on table public.homestead_farm_reactions is
  'One compliment per visitor per farm per kind, in Visitor Mode. The primary key is the once-only rule. Service-role only.';

-- The tallies are read by farm, for the farm's own header.
create index homestead_farm_reactions_farm_idx
  on public.homestead_farm_reactions (farm_profile_id);

alter table public.homestead_farm_reactions enable row level security;
revoke all on public.homestead_farm_reactions from anon, authenticated;
