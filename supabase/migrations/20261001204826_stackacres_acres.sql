/* -------------------------------------------------------------------- */
/* Land by the acre: the wild land round the yard is bought one acre at a */
/* time (lib/stackacres/acres.ts)                                         */
/* -------------------------------------------------------------------- */

-- One row per (profile, acre). acre_id is an id from ACRES in
-- lib/stackacres/acres.ts; which ids exist is the application's call, so this
-- table only keeps the shape of one. 'bought' rows were paid for through
-- buyStackAcresAcre and are billed the flat daily fee. 'grandfathered' rows
-- were written by the backfill below for ground a farm already used, and are
-- not billed: the Crop Fields were already charged as plots.
create table public.homestead_acres (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  acre_id text not null check (acre_id ~ '^[A-Z][0-9]{1,2}$'),
  source text not null default 'bought' check (source in ('bought', 'grandfathered')),
  created_at timestamptz not null default now(),
  primary key (profile_id, acre_id)
);

comment on table public.homestead_acres is
  'One owned acre of the wild land per row, by acre id (lib/stackacres/acres.ts). Written by the service when an acre is bought, and once by the migration for ground a farm already used. Service-role only.';

alter table public.homestead_acres enable row level security;
revoke all on public.homestead_acres from anon, authenticated;

-- Existing farms keep any ground they already use: every acre that already
-- holds one of a farm's beds or fences becomes theirs. A bed is a soil tile,
-- which sits on Homestead map tile (tx + 32, ty + 22) (SOIL_TO_MAP in
-- lib/stackacres/hoeable.ts); a fence is already a map tile. Only WILD tiles
-- count: an acre's rectangle can reach over yard grass, and a bed there is not
-- a use of the acre. The wild rows and the acre rectangles below are copies of
-- HOMESTEAD_WILD_ROWS and ACRES, and acres.test.ts fails when they drift.
-- Safe to run again: it only ever adds missing rows.
with
wild_rows(y, bits) as (
  values
  (2, '0001000000000000000000000000000000000000000000000000000000000000'),
  (3, '0000110000000000000000000000000000000000000000000000000000000000'),
  (4, '0000110000000000000000000000000000000000000000000000000000000000'),
  (5, '0001111000000000000000000000000000000000000000000010000000000000'),
  (6, '0001111100000000000000000000000000000000000000000110000000000000'),
  (7, '0001111110000000000000000000000000000000000000001110000000000000'),
  (8, '0001111111100000000000000000000000001000000000001110000000000000'),
  (9, '0000111111111000000000000000000000000000000000000110000000000000'),
  (10, '0001111111111100000000000000000000000000000000000110000000000000'),
  (11, '0001111111111110000000000000000000000000000000000111111111111000'),
  (12, '0001111111111110000000000000000000000000000000000111111111111000'),
  (13, '0001111111111110000000000000000000000000000000000111111111111000'),
  (14, '0001111111111110000000000000000000000000000000000111111111111000'),
  (15, '0001111111111110000000000000000000000000000000000111111111111000'),
  (16, '0001111111111110000000000000000000000000000000000111111111110000'),
  (17, '0001111111111110000000000000000000000000000000000111111111110000'),
  (18, '0001111111111110000000000000000000000000000000000111111111111000'),
  (19, '0001111111111110000000000000000000000000000000000111111111111000'),
  (20, '0001111111111110000000000000000000000000000000000111111111111000'),
  (21, '0001111111111110000000000000000000000000000000000111111111111000'),
  (22, '0001111111111110000000000000000000000000000000000111111111111000'),
  (23, '0001111111111110000000000000000000000000000000000111111111111000'),
  (24, '0001111111111110000000000000000000000000000000000111111111111000'),
  (25, '0000000000001110000000000000000000000000000000000111111111111000'),
  (26, '0000000000001110000000000000000000000000000000000111111111111000'),
  (27, '0000000000001110000000000000000000000000000000000111111111111000'),
  (28, '0000000000001110000000000000000000000000000000000010000000000000'),
  (29, '0000000000001110000000000000000000000000000000000010000000000000'),
  (37, '0000111111111111111111111111111111111111111111111111111111111000'),
  (38, '0000111111111111111111111111111111111111111111111111111111111000'),
  (39, '0001111111111111111111111111111111111111111111111111111111111000'),
  (40, '0001111111111111111111111111111111111111111111111111111111111000'),
  (41, '0001111111111111111111111111111111111111111111111111111111111000'),
  (42, '0001111111111111111111111111111111111111111111111111111111111000'),
  (43, '0001111111111111111111111111111111111111111111111111111111111000'),
  (44, '0001111111111111111111111111111111111111111111111111111111111000'),
  (45, '0001111111111111111111111111111111111111111111111111111111111000'),
  (46, '0000111111111111111111111111111111111111111111111111111111111000'),
  (47, '0000111111111111111111111111111111111111111111111111111111111000'),
  (48, '0000111111111111111110111111111111111111111111111111001111110000')
),
acre_rects(id, x, y, w, h) as (
  values
  ('W1', 3, 2, 6, 9),
  ('W2', 9, 2, 6, 16),
  ('W3', 3, 11, 6, 7),
  ('W4', 3, 18, 6, 7),
  ('W5', 9, 18, 6, 12),
  ('E1', 48, 5, 7, 12),
  ('E2', 55, 11, 6, 6),
  ('E3', 49, 17, 6, 6),
  ('E4', 55, 17, 6, 6),
  ('E5', 49, 23, 6, 7),
  ('E6', 55, 23, 6, 5),
  ('S01', 3, 37, 6, 6),
  ('S02', 9, 37, 6, 6),
  ('S03', 15, 37, 6, 6),
  ('S04', 21, 37, 6, 6),
  ('S05', 27, 37, 6, 6),
  ('S06', 33, 37, 6, 6),
  ('S07', 39, 37, 6, 6),
  ('S08', 45, 37, 6, 6),
  ('S09', 51, 37, 6, 6),
  ('S10', 57, 37, 4, 6),
  ('S11', 3, 43, 6, 6),
  ('S12', 9, 43, 6, 6),
  ('S13', 15, 43, 6, 6),
  ('S14', 21, 43, 6, 6),
  ('S15', 27, 43, 6, 6),
  ('S16', 33, 43, 6, 6),
  ('S17', 39, 43, 6, 6),
  ('S18', 45, 43, 6, 6),
  ('S19', 51, 43, 6, 6),
  ('S20', 57, 43, 4, 6)
),
used(profile_id, mx, my) as (
  select profile_id, tx + 32, ty + 22 from public.homestead_soil_tiles
  union
  select profile_id, tx, ty from public.homestead_fences
)
insert into public.homestead_acres (profile_id, acre_id, source)
select distinct u.profile_id, r.id, 'grandfathered'
  from used u
  join wild_rows w on w.y = u.my and substr(w.bits, u.mx + 1, 1) = '1'
  join acre_rects r on u.mx >= r.x and u.mx < r.x + r.w and u.my >= r.y and u.my < r.y + r.h
on conflict (profile_id, acre_id) do nothing;

-- ---------------------------------------------------------------------------
-- stackacres_read_batch, plus the farm's acres.
--
-- Below is the body 20261001180411_stackacres_farm_board.sql installed, with
-- 'guard_dogs' (from 20261001195736_stackacres_guard_dogs.sql, which must be
-- applied first) and 'acres' added. It rides in the batch so a live-Supabase farm reads its acres
-- in the same round trip as everything else
-- (lib/server/stackacres-read-budget.test.ts holds that line).
-- ---------------------------------------------------------------------------

create or replace function public.stackacres_read_batch(p_profile_id uuid, p_day date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'units', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_units t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'feed', (select to_jsonb(t) from public.homestead_feed t where t.profile_id = p_profile_id),
    'water', (select to_jsonb(t) from public.homestead_water t where t.profile_id = p_profile_id),
    'capacity', coalesce(
      (select jsonb_agg(t) from public.homestead_capacity t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'sectors', coalesce(
      (select jsonb_agg(t) from public.homestead_sectors t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'upkeep', (
      select to_jsonb(t) from public.homestead_upkeep t
      where t.profile_id = p_profile_id and t.day = p_day
    ),
    'museum', coalesce(
      (select jsonb_agg(t) from public.homestead_museum_donations t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'tool', (select to_jsonb(t) from public.homestead_tool t where t.profile_id = p_profile_id),
    'wheat_plots', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_wheat_plots t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'machines', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_machines t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'inventory', coalesce(
      (select jsonb_agg(t) from public.homestead_processing_inventory t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'contract', (
      select to_jsonb(t) from public.homestead_contracts t
      where t.profile_id = p_profile_id and t.status = 'open'
    ),
    'influence', (select to_jsonb(t) from public.homestead_town_influence t where t.profile_id = p_profile_id),
    'secret_ledger', coalesce(
      (select jsonb_agg(t) from public.homestead_secret_ledger t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'greenhouse', (select to_jsonb(t) from public.homestead_greenhouse t where t.profile_id = p_profile_id),
    'crop_fields', (select to_jsonb(t) from public.homestead_crop_fields t where t.profile_id = p_profile_id),
    'perk_unlocks', coalesce(
      (select jsonb_agg(t) from public.stackacres_perk_unlocks t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'blueprints', coalesce(
      (select jsonb_agg(t) from public.stackacres_blueprints t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'blueprint_progress', coalesce(
      (select jsonb_agg(t) from public.stackacres_blueprint_progress t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'prestige', (select to_jsonb(t) from public.homestead_prestige_state t where t.profile_id = p_profile_id),
    'tool_enchantments', coalesce(
      (select jsonb_agg(t) from public.stackacres_tool_enchantments t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'crossbreed_plots', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.stackacres_crossbreed_plots t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'crossbreed_inventory', coalesce(
      (select jsonb_agg(t) from public.stackacres_crossbreed_inventory t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'pipes', coalesce(
      (select jsonb_agg(t) from public.homestead_pipes t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'soil_tiles', coalesce(
      (select jsonb_agg(t) from public.homestead_soil_tiles t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'soil_stock', coalesce(
      (select jsonb_agg(t) from public.homestead_soil_stock t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'seed_stock', coalesce(
      (select jsonb_agg(t) from public.homestead_seed_stock t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'devotion', (select to_jsonb(t) from public.homestead_devotion t where t.profile_id = p_profile_id),
    'friendship', coalesce(
      (select jsonb_agg(t) from public.homestead_friendship t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    -- Only the Vat's own seal. Kept for code deployed before Chapter 5; new
    -- code reads aging_manifests.
    'vat_manifest', (
      select to_jsonb(t) from public.homestead_vat_manifests t
      join public.homestead_machines m on m.id = t.machine_id
      where t.profile_id = p_profile_id and m.kind = 'vat'
    ),
    'cutters', coalesce(
      (select jsonb_agg(t) from public.homestead_cutter t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'story', (select to_jsonb(t) from public.homestead_story t where t.profile_id = p_profile_id),
    'energy', (select to_jsonb(t) from public.homestead_energy t where t.profile_id = p_profile_id),
    'clock', (select to_jsonb(t) from public.homestead_clock t where t.profile_id = p_profile_id),
    'aging_manifests', coalesce(
      (select jsonb_agg(t) from public.homestead_vat_manifests t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'wood_nodes', coalesce(
      (select jsonb_agg(t) from public.homestead_wood_nodes t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'land_obstacles', coalesce(
      (select jsonb_agg(t) from public.homestead_land_obstacles t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'forage_nodes', coalesce(
      (select jsonb_agg(t) from public.homestead_forage_nodes t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    'axe', (select to_jsonb(t) from public.homestead_axe t where t.profile_id = p_profile_id),
    'fences', coalesce(
      (select jsonb_agg(t) from public.homestead_fences t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    -- The guard dogs on this player's Homestead (lib/stackacres/guard-dog.ts).
    -- Carried forward from 20261001195736_stackacres_guard_dogs.sql, which
    -- added this key; this body replaces that one, so it has to keep it.
    'guard_dogs', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.homestead_guard_dogs t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    -- The buildings this player owns on the Far Field.
    'empire_buildings', coalesce(
      (select jsonb_agg(t order by t.created_at) from public.empire_buildings t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    -- The city grocery, one row, where owning it is open. Always read here regardless
    -- of the groceryOwnershipEnabled() app flag -- one small per-profile row costs
    -- nothing extra riding along with everything else, and the app decides whether to
    -- look at it.
    'grocery', (select to_jsonb(t) from public.empire_grocery t where t.profile_id = p_profile_id),
    -- The wild acres this player owns (lib/stackacres/acres.ts).
    'acres', coalesce(
      (select jsonb_agg(t order by t.acre_id) from public.homestead_acres t where t.profile_id = p_profile_id),
      '[]'::jsonb
    ),
    -- Today's Farm Board, and this week's. Absent until the player's first
    -- read of that period draws one; view() treats a missing row as "not
    -- drawn yet" and claims it.
    'farm_board_daily', (
      select to_jsonb(t) from public.homestead_farm_board t
      where t.profile_id = p_profile_id and t.period_kind = 'daily' and t.period_start = p_day
    ),
    'farm_board_weekly', (
      select to_jsonb(t) from public.homestead_farm_board t
      where t.profile_id = p_profile_id
        and t.period_kind = 'weekly'
        and t.period_start = p_day - (extract(isodow from p_day)::integer - 1)
    )
  );
$$;

comment on function public.stackacres_read_batch(uuid, date) is
  'Batched per-profile farm read for view() in stackacres-service.ts. Read-only. Service-role only.';

revoke all on function public.stackacres_read_batch(uuid, date) from public, anon, authenticated;
