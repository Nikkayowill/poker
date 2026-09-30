-- games_privacy_room_code_check assumed is_private meant "has a shareable
-- room code," which was true when it was written. Heads-up and Sit & Go
-- tables (both added same-day, after this constraint) also set is_private =
-- true, but only to stay off findOpenPublicGame's matchmaking list -- they
-- have no room-code join flow at all, so every real table insert for either
-- format hard-fails this constraint's "private implies room_code is set"
-- direction. The other direction is still a real invariant: a public
-- matchmaking game must never carry a room code.
alter table public.games
  drop constraint games_privacy_room_code_check,
  add constraint games_privacy_room_code_check
  check (is_private = true or room_code is null);

comment on constraint games_privacy_room_code_check on public.games is
  'Public matchmaking games must never expose a room code. Private-format tables (invite-code rooms, heads-up, Sit & Go) may or may not carry one.';
