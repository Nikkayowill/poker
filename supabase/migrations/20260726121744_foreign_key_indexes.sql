-- Cover the remaining foreign keys reported by Supabase's performance advisor.
-- These support session cleanup checks and actor-centric audit inspection.

create index games_owner_token_idx
  on public.games(owner_token);

create index game_actions_actor_seat_id_idx
  on public.game_actions(actor_seat_id)
  where actor_seat_id is not null;
