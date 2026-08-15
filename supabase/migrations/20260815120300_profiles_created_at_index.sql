-- listProfiles() (admin dashboard) now drains the whole table via a keyset
-- cursor on (created_at desc, id desc) instead of a flat 1000-row cap.
-- created_at had no dedicated index, so every page of that walk was a full
-- sort over the table; this index matches the exact order-by + cursor filter
-- the drain uses.

create index profiles_created_at_id_idx on public.profiles(created_at desc, id desc);
