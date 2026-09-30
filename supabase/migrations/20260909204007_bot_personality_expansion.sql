-- lib/game/engine.ts's pickBotPersonality() has generated LAG, NIT, and TAG
-- bots for a while now, but the game_seats check constraint from
-- 20260726121703_multiplayer_rooms.sql never grew to match, so seating any
-- bot with one of those personalities fails the insert.

alter table public.game_seats
  drop constraint game_seats_personality_check;

alter table public.game_seats
  add constraint game_seats_personality_check
    check (personality is null or personality in
      ('MANIAC', 'ROCK', 'CALLING_STATION', 'LAG', 'NIT', 'TAG'));
