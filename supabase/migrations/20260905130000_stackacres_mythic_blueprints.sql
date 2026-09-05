-- Ray's Mythic Blueprints: multi-stage structures filled with processing-
-- track materials (lib/stackacres/machine-items.ts) across several separate
-- donation sessions.
--
-- FOUR TABLES, deliberately, mirroring the split ./contracts.ts's own
-- migrations already use between static content and player state:
--
--   * `stackacres_blueprint_requirements_def` is READ-ONLY CONTENT: the
--     material ladder for every stage of every structure. It duplicates
--     lib/stackacres/blueprints.ts's `MYTHIC_BLUEPRINTS` table on purpose --
--     a PL/pgSQL function cannot import a TypeScript module, the same reason
--     `homestead_plots_enforce_stock_shape`'s yield_ceiling is a duplicated
--     CASE rather than a lookup into application code. Here the duplication
--     is ROWS instead of a CASE (multiple items per stage reads far better
--     as a table than as nested CASE arms), kept in sync by
--     blueprints.test.ts's own parity test -- see that file before changing
--     a quantity in either place.
--   * `stackacres_blueprints` is the per-player HEADER: which stage a player
--     is on and whether the structure is finished.
--   * `stackacres_blueprint_progress` is the per-player, per-stage, per-item
--     COUNTER: how much of each required material has landed at the
--     player's current stage. Cleared implicitly by moving on -- a finished
--     stage's rows are simply never read again, not deleted (append-only
--     posture, same as everywhere else in this feature).
--   * `stackacres_blueprint_contributions` is an APPEND-ONLY LEDGER: one row
--     per accepted contribution, kept even after its stage is long past, so
--     a player's full history is always reconstructable from the database
--     alone -- the same audit trail `homestead_harvests` already gives a
--     harvest.
--
-- A BLUEPRINT NEVER PAYS GOLD. Unlike a Town Contract (./contracts.ts), the
-- only thing a completed stage or a finished structure grants is the next
-- stage's requirements becoming visible and, at the end, a cosmetic
-- completed structure -- so this feature carries none of the flat daily
-- Gold ceiling's risk and needs no reservation step. If a future stage ever
-- wants to pay Gold or Town Influence on completion, route it through
-- `reserveStackAcresExchange` exactly the way `fulfillStackAcresTownContract`
-- does -- do not add a second unguarded Gold payer to this feature.

/* -------------------------------------------------------------------- */
/* 1. Static content: the requirement ladder                            */
/* -------------------------------------------------------------------- */

create table public.stackacres_blueprint_requirements_def (
  structure_id text not null,
  stage_index integer not null check (stage_index >= 0),
  item text not null check (item in ('wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth')),
  quantity integer not null check (quantity > 0),
  primary key (structure_id, stage_index, item)
);

comment on table public.stackacres_blueprint_requirements_def is
  'Static per-stage material ladder for every Mythic Blueprint. Content, not player state -- duplicates MYTHIC_BLUEPRINTS in lib/stackacres/blueprints.ts by necessity (a PL/pgSQL function cannot import a TypeScript module); kept in sync by blueprints.test.ts''s parity test. Service-role only, same as every other table in this file -- the client already has this ladder from the TS catalogue and never needs to query it directly.';

alter table public.stackacres_blueprint_requirements_def enable row level security;
revoke all on public.stackacres_blueprint_requirements_def from anon, authenticated;

-- Seed: mythic-ember-spire, three stages. MUST match
-- lib/stackacres/blueprints.ts's MYTHIC_BLUEPRINTS exactly -- see this
-- table's own comment above.
insert into public.stackacres_blueprint_requirements_def (structure_id, stage_index, item, quantity) values
  ('mythic-ember-spire', 0, 'wheat', 20),
  ('mythic-ember-spire', 0, 'flour', 10),
  ('mythic-ember-spire', 1, 'flour', 15),
  ('mythic-ember-spire', 1, 'cheese', 8),
  ('mythic-ember-spire', 2, 'cheese', 6),
  ('mythic-ember-spire', 2, 'cloth', 10);

/* -------------------------------------------------------------------- */
/* 2. Player state: header + per-stage progress                         */
/* -------------------------------------------------------------------- */

create table public.stackacres_blueprints (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  structure_id text not null,
  current_stage integer not null default 0 check (current_stage >= 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (profile_id, structure_id),
  constraint stackacres_blueprints_completed_matches_status check (
    (status = 'completed') = (completed_at is not null)
  )
);

comment on table public.stackacres_blueprints is
  'One row per structure a player has started. No row means never started -- there is deliberately no "not_started" status value, the same way a missing homestead_tool row means the starting Trowel. Service-role only.';

alter table public.stackacres_blueprints enable row level security;
revoke all on public.stackacres_blueprints from anon, authenticated;

create table public.stackacres_blueprint_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  structure_id text not null,
  stage_index integer not null check (stage_index >= 0),
  item text not null check (item in ('wheat', 'flour', 'milk', 'wool', 'cheese', 'cloth')),
  contributed integer not null default 0 check (contributed >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, structure_id, stage_index, item),
  foreign key (profile_id, structure_id)
    references public.stackacres_blueprints(profile_id, structure_id)
    on delete cascade
);

comment on table public.stackacres_blueprint_progress is
  'How much of one required item has landed at one stage of one player''s blueprint. A missing row means 0, same "missing means zero" convention StackAcresInventory follows. A row is never deleted when its stage is left behind -- it is simply not read again, the same append-only posture homestead_harvests keeps. Service-role only.';

alter table public.stackacres_blueprint_progress enable row level security;
revoke all on public.stackacres_blueprint_progress from anon, authenticated;

create index stackacres_blueprint_progress_lookup_idx
  on public.stackacres_blueprint_progress(profile_id, structure_id, stage_index);

/* -------------------------------------------------------------------- */
/* 3. Append-only ledger                                                 */
/* -------------------------------------------------------------------- */

create table public.stackacres_blueprint_contributions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  structure_id text not null,
  stage_index integer not null,
  item text not null,
  amount_requested integer not null check (amount_requested > 0),
  amount_accepted integer not null check (amount_accepted >= 0),
  created_at timestamptz not null default now()
);

comment on table public.stackacres_blueprint_contributions is
  'Append-only audit trail: one row per ACCEPTED call to contribute_to_stackacres_blueprint, recording both what was requested and what was actually taken (they differ whenever a contribution overshoots what a stage still needs -- see that function''s own comment). Never read by the service today; exists so a state delta is always reconstructable, the same reason ante_up_attempts keeps a settled row rather than deleting it. Service-role only.';

alter table public.stackacres_blueprint_contributions enable row level security;
revoke all on public.stackacres_blueprint_contributions from anon, authenticated;

create index stackacres_blueprint_contributions_profile_idx
  on public.stackacres_blueprint_contributions(profile_id, structure_id, created_at desc);

/* -------------------------------------------------------------------- */
/* 4. Starting a blueprint                                               */
/* -------------------------------------------------------------------- */

-- Idempotent by primary key, the same shape grant_homestead_starting_bushels
-- already uses: ON CONFLICT DO NOTHING plus FOUND is the whole "started
-- exactly once" guard, so two racing "start" taps from two tabs cannot both
-- report success and neither can silently reset an already-in-progress
-- structure back to stage 0.
create or replace function public.start_stackacres_blueprint(
  p_profile_id uuid,
  p_structure_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  is_started boolean;
begin
  if not exists (
    select 1 from public.stackacres_blueprint_requirements_def
     where structure_id = p_structure_id
  ) then
    raise exception 'Unknown StackAcres blueprint: %', p_structure_id
      using errcode = '22023';
  end if;

  insert into public.stackacres_blueprints (profile_id, structure_id)
  values (p_profile_id, p_structure_id)
  on conflict (profile_id, structure_id) do nothing;

  is_started := found;
  return is_started;
end;
$$;

comment on function public.start_stackacres_blueprint(uuid, text) is
  'Begins one player''s copy of one Mythic Blueprint at stage 0. Returns true only on the insert that actually created the row -- false means it was already started (or already finished), never an error. Raises 22023 for a structure_id with no requirement rows at all.';

-- `public` is load-bearing and not redundant -- anon and authenticated
-- inherit Postgres's default PUBLIC execute grant, so revoking from the two
-- roles alone leaves this callable on /rest/v1/rpc. This exact three-name
-- mistake has shipped twice on this feature already (see
-- 20260901130000_revoke_homestead_function_execute_from_public and
-- 20260813170000); verify with proacl after applying, not by re-reading this
-- file.
revoke all on function public.start_stackacres_blueprint(uuid, text) from public, anon, authenticated;

/* -------------------------------------------------------------------- */
/* 5. Contributing a material                                           */
/* -------------------------------------------------------------------- */

-- Runs SEQUENTIAL VALIDATION, in this exact order, all inside one
-- transaction so any early exit leaves NOTHING written:
--
--   1. p_amount must be positive.
--   2. A blueprint must exist for this player+structure and not already be
--      completed (FOR UPDATE on the header row -- every branch below reads
--      it before deciding whether to advance it, which a single UPDATE's
--      WHERE clause cannot express, unlike step 5's debit).
--   3. p_item must be one this structure's CURRENT stage actually asks for
--      (looked up from the requirement ladder, not the player's own
--      progress, so a wrong material is rejected before any of the
--      player's own rows are even locked).
--   4. That requirement must not already be fully met (FOR UPDATE on the
--      progress counter -- the accepted amount below is clamped against
--      what is already banked, which needs a read before the write can be
--      sized).
--   5. The player must actually hold enough of the item. This is the one
--      step that is a plain guarded UPDATE rather than a separate FOR
--      UPDATE select-then-check: `where quantity >= accepted` takes the row
--      lock and tests the balance in the same statement, the identical
--      idiom process_homestead_recipe (20260904170000) uses and for the
--      same reason -- two contributions racing on the same inventory row
--      cannot both read "enough" and both spend.
--
-- Returns ZERO ROWS (this is a set-returning function) on any refusal at
-- steps 2-5 -- the caller treats an empty result exactly like every other
-- write in this feature treats a null: a refusal or a lost race, never a
-- partial success. Returns exactly one row describing what was actually
-- accepted, whether that finished the current stage, and whether it
-- finished the whole structure.
create or replace function public.contribute_to_stackacres_blueprint(
  p_profile_id uuid,
  p_structure_id text,
  p_item text,
  p_amount integer
)
returns table (
  stage_index integer,
  item text,
  accepted integer,
  contributed integer,
  required integer,
  stage_complete boolean,
  new_stage integer,
  blueprint_complete boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
-- This function's own RETURNS TABLE names four OUT parameters after real
-- column names on the tables it touches (`stage_index`, `item`,
-- `contributed`, `required`), which makes every one of them a PL/pgSQL
-- variable in scope for the whole body -- silently, since RETURNS TABLE
-- columns need no `declare`. Left at plpgsql's own default
-- (`variable_conflict = error`), an UN-QUALIFIED reference to any of those
-- four names anywhere in this body raises "column reference is ambiguous"
-- at CALL time, not at CREATE FUNCTION time -- this shipped broken twice
-- while this migration was being written: once on the debit's own `item =
-- p_item`, once on an `ON CONFLICT (..., stage_index, item)` target list,
-- which cannot be table-qualified at all (that syntax position takes bare
-- column names only, by SQL grammar). `use_column` is the documented fix
-- for exactly this shape -- a function whose own output columns share a
-- name with the tables it reads -- and is safe here specifically because
-- this function never actually NEEDS to read one of those four OUT
-- parameters back as a variable anywhere in its own body (every value that
-- becomes a return column is produced by a distinctly-named local instead:
-- req_qty, new_contributed, accepted_amount, stage_now_complete,
-- advanced_stage, done -- see the final `return query select` below, which
-- is what actually populates the four shadowed names, positionally, on the
-- way out).
declare
  bp record;
  req_qty integer;
  prog_contributed integer;
  accepted_amount integer;
  new_contributed integer;
  remaining_in_stage integer;
  stage_now_complete boolean := false;
  advanced_stage integer;
  next_stage_exists boolean;
  done boolean := false;
begin
  -- Step 1.
  if p_amount <= 0 then
    raise exception 'contribute_to_stackacres_blueprint needs a positive amount'
      using errcode = '22023';
  end if;

  -- Step 2.
  select b.profile_id, b.structure_id, b.current_stage, b.status
    into bp
    from public.stackacres_blueprints b
   where b.profile_id = p_profile_id
     and b.structure_id = p_structure_id
   for update;

  if bp is null then
    -- Never started. Same "not applicable, not zero progress" contract a
    -- missing homestead_processing_inventory row carries for an item nobody
    -- has ever held.
    return;
  end if;

  if bp.status = 'completed' then
    -- Terminal. There is no next stage to route this contribution into.
    return;
  end if;

  -- Step 3.
  select d.quantity into req_qty
    from public.stackacres_blueprint_requirements_def d
   where d.structure_id = p_structure_id
     and d.stage_index = bp.current_stage
     and d.item = p_item;

  if req_qty is null then
    -- Wrong material for the CURRENT stage (or p_item is not a real item at
    -- all -- the check constraint on stackacres_blueprint_progress would
    -- catch that below too, but rejecting here is cheaper and clearer).
    return;
  end if;

  -- Step 4.
  select p.contributed into prog_contributed
    from public.stackacres_blueprint_progress p
   where p.profile_id = p_profile_id
     and p.structure_id = p_structure_id
     and p.stage_index = bp.current_stage
     and p.item = p_item
     for update;

  prog_contributed := coalesce(prog_contributed, 0);
  remaining_in_stage := req_qty - prog_contributed;

  if remaining_in_stage <= 0 then
    -- Already fully supplied. Refusing rather than silently accepting and
    -- discarding the surplus means the caller can never mistake this for a
    -- successful (if wasted) contribution.
    return;
  end if;

  accepted_amount := least(p_amount, remaining_in_stage);

  -- Step 5. The atomic debit: lock and sufficiency-check in one statement.
  -- Table-qualified on `inv.item` deliberately -- this function's own
  -- RETURNS TABLE declares an OUT parameter also named `item`, which shadows
  -- a bare column reference of the same name for the rest of the function
  -- body (PL/pgSQL's default `variable_conflict = error` catches this at
  -- CALL time, not at CREATE FUNCTION time, so an unqualified reference
  -- passes review looking correct and only fails the first time this
  -- exact branch actually runs). Same reason the two SELECTs above alias
  -- `d.item`/`p.item` rather than leaving them bare.
  update public.homestead_processing_inventory as inv
     set quantity = inv.quantity - accepted_amount,
         updated_at = now()
   where inv.profile_id = p_profile_id
     and inv.item = p_item
     and inv.quantity >= accepted_amount;

  if not found then
    -- Not enough material on hand. Nothing else has been written yet -- the
    -- progress row above was only locked, never updated.
    return;
  end if;

  -- The debit is durable within this transaction; credit the stage counter.
  insert into public.stackacres_blueprint_progress as prog
    (profile_id, structure_id, stage_index, item, contributed)
  values (p_profile_id, p_structure_id, bp.current_stage, p_item, accepted_amount)
  on conflict (profile_id, structure_id, stage_index, item) do update
    set contributed = prog.contributed + accepted_amount,
        updated_at = now()
  returning prog.contributed into new_contributed;

  -- Append-only ledger, so a state delta is always reconstructable even
  -- though `stackacres_blueprint_progress` only ever keeps a running total.
  insert into public.stackacres_blueprint_contributions
    (profile_id, structure_id, stage_index, item, amount_requested, amount_accepted)
  values (p_profile_id, p_structure_id, bp.current_stage, p_item, p_amount, accepted_amount);

  -- Did THIS contribution finish every requirement at the current stage,
  -- not just this one item? A stage with several required items only ever
  -- completes on the contribution that satisfies the last of them.
  select not exists (
    select 1
      from public.stackacres_blueprint_requirements_def def
      left join public.stackacres_blueprint_progress p
        on p.profile_id = p_profile_id
       and p.structure_id = p_structure_id
       and p.stage_index = def.stage_index
       and p.item = def.item
     where def.structure_id = p_structure_id
       and def.stage_index = bp.current_stage
       and coalesce(p.contributed, 0) < def.quantity
  ) into stage_now_complete;

  advanced_stage := bp.current_stage;

  if stage_now_complete then
    -- Same shadowing hazard as step 5's debit above -- `stage_index` is also
    -- one of this function's RETURNS TABLE columns, so it is qualified here
    -- too rather than left bare.
    select exists (
      select 1 from public.stackacres_blueprint_requirements_def def
       where def.structure_id = p_structure_id
         and def.stage_index = bp.current_stage + 1
    ) into next_stage_exists;

    if next_stage_exists then
      advanced_stage := bp.current_stage + 1;
      update public.stackacres_blueprints
         set current_stage = advanced_stage,
             updated_at = now()
       where profile_id = p_profile_id
         and structure_id = p_structure_id;
    else
      done := true;
      update public.stackacres_blueprints
         set status = 'completed',
             completed_at = now(),
             updated_at = now()
       where profile_id = p_profile_id
         and structure_id = p_structure_id;
    end if;
  end if;

  return query select
    bp.current_stage,
    p_item,
    accepted_amount,
    new_contributed,
    req_qty,
    stage_now_complete,
    advanced_stage,
    done;
end;
$$;

comment on function public.contribute_to_stackacres_blueprint(uuid, text, text, integer) is
  'Spends up to p_amount of p_item from the player''s processing inventory toward the CURRENT stage of one blueprint, clamped to what that stage still needs. Returns zero rows on any refusal (not started, already completed, wrong material, already met, or not enough on hand) -- an empty result must never be treated as a successful contribution. See contributeToBlueprint in lib/server/stackacres-blueprint-service.ts.';

-- `public` is load-bearing -- see start_stackacres_blueprint''s comment above.
revoke all on function public.contribute_to_stackacres_blueprint(uuid, text, text, integer)
  from public, anon, authenticated;
