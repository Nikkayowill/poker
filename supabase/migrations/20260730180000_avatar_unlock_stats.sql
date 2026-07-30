-- Cumulative Gold won across every hand a player has ever won, distinct from
-- net_profit (which nets out losses and can sit near zero for a player who
-- plays a lot but runs breakeven) and biggest_pot_won (a single-hand peak).
-- Avatar unlock progress needs a number that only ever goes up, or "hands
-- won" and "chips won" thresholds would regress on a losing streak.

alter table public.player_stats
  add column if not exists total_chips_won bigint not null default 0;

create or replace function public.record_hand_result(
  p_game_id uuid,
  p_hand_number integer,
  p_profile_id uuid,
  p_won boolean,
  p_amount_won integer,
  p_net_profit integer,
  p_vpip boolean
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_active_season uuid;
begin
  insert into public.hand_results (
    game_id, hand_number, profile_id, won, amount_won, net_profit, vpip
  ) values (
    p_game_id, p_hand_number, p_profile_id, p_won, p_amount_won, p_net_profit, p_vpip
  )
  on conflict (game_id, hand_number, profile_id) do nothing;

  if not found then
    return false;
  end if;

  insert into public.player_stats (
    profile_id, hands_played, hands_won, vpip_hands, net_profit, biggest_pot_won,
    total_chips_won, updated_at
  ) values (
    p_profile_id, 1, case when p_won then 1 else 0 end, case when p_vpip then 1 else 0 end,
    p_net_profit, p_amount_won, p_amount_won, now()
  )
  on conflict (profile_id) do update set
    hands_played = public.player_stats.hands_played + 1,
    hands_won = public.player_stats.hands_won + case when p_won then 1 else 0 end,
    vpip_hands = public.player_stats.vpip_hands + case when p_vpip then 1 else 0 end,
    net_profit = public.player_stats.net_profit + p_net_profit,
    biggest_pot_won = greatest(public.player_stats.biggest_pot_won, p_amount_won),
    total_chips_won = public.player_stats.total_chips_won + p_amount_won,
    updated_at = now();

  select id into v_active_season
  from public.seasons
  where status = 'active' and now() between starts_at and ends_at
  limit 1;

  if v_active_season is not null then
    insert into public.season_stats (
      season_id, profile_id, hands_played, hands_won, net_profit, biggest_pot_won, updated_at
    ) values (
      v_active_season, p_profile_id, 1, case when p_won then 1 else 0 end,
      p_net_profit, p_amount_won, now()
    )
    on conflict (season_id, profile_id) do update set
      hands_played = public.season_stats.hands_played + 1,
      hands_won = public.season_stats.hands_won + case when p_won then 1 else 0 end,
      net_profit = public.season_stats.net_profit + p_net_profit,
      biggest_pot_won = greatest(public.season_stats.biggest_pot_won, p_amount_won),
      updated_at = now();
  end if;

  return true;
end;
$$;
