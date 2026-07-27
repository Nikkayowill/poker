-- The layered avatar's chosen options: skin tone, hair style and colour,
-- face, facial hair, outfit.
--
-- JSONB rather than columns so a new category (headwear, eyewear, jewellery)
-- is a catalog entry in TypeScript plus a shape in the renderer, with no
-- migration. Nullable so every profile that predates avatars keeps working:
-- normalizeAvatar fills in defaults for anything missing or unrecognised.
--
-- avatar_preset is deliberately left in place as the legacy fallback rather
-- than dropped, so nothing that still reads it breaks.
alter table public.profiles
  add column avatar_config jsonb;

comment on column public.profiles.avatar_config is
  'Layered avatar selection; null means the profile has not customized one yet and renders defaults.';
