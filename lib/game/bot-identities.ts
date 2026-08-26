/**
 * The bot cast: gamer tags, initials, accent colours, avatar presets.
 *
 * Pulled out of `engine.ts` because it's flavor/content data, not rules --
 * the 2000+ line rules engine shouldn't carry a 30-entry name list. Nothing
 * here depends on the engine and nothing in the engine needs this data
 * inlined; it's imported back in as a plain array.
 *
 * Gamer tags, not first names. A table of tidy single first names reads as
 * a cast of NPCs; a real online table looks like a column of handles
 * somebody typed for themselves, so the pool is written in the shapes
 * people actually pick: a nickname with a word stuck on it, a name with a
 * number, an underscore, a tag carried over from another game. Varied
 * rather than one visible formula repeated, which would give the generated
 * feel straight back. Keep new entries at 14 characters or fewer: a
 * human's own name is capped at 18 (see `joinTable` in engine.ts) and a bot
 * shares the same nameplate, but the small-phone plate crowds well before
 * that.
 *
 * Longer than SEAT_COUNT so a seat that turns over can pick an identity
 * nobody at the table is currently wearing; a player who sits for an hour
 * doesn't watch the same six names cycle back around. The first SEAT_COUNT
 * entries are the original cast and stay in their original order: identity
 * indices are persisted on seats, and every live table backfills its bots
 * from `position`, so reordering these would swap the players at every
 * table in flight. Renaming an entry in place is safe, and so is
 * appending; moving one is not.
 *
 * `initials` is not the tag's first two letters (JX for `jaxdidthat`, RV
 * for `riverrat_rj`). It's shorthand for the nickname inside the tag, which
 * is what the avatar circle shows and what a player already associates
 * with that seat. Deriving it mechanically would turn RV into RI for no
 * reader-facing gain.
 *
 * Identity (name/face) and personality (how it plays) are separate axes;
 * see `pickBotPersonality` in engine.ts for the latter. This pool is only
 * ever the former. Nothing ties a tag to the face a bot wears either
 * (`botAvatarFor` indexes the character roster independently): the
 * catalog's own character names are tags too, but they're the store's
 * labels for a face, not a claim about who's sitting in the chair.
 */
export const botProfiles: Array<{
  name: string;
  initials: string;
  accent: string;
  avatarUrl: null;
  avatarPreset: string;
}> = [
  { name: "jaxdidthat", initials: "JX", accent: "#8fd6a8", avatarUrl: null, avatarPreset: "lucky" },
  { name: "maya_ontilt", initials: "MA", accent: "#c08dff", avatarUrl: null, avatarPreset: "diamond" },
  { name: "theo_wit_it", initials: "TH", accent: "#ff9e78", avatarUrl: null, avatarPreset: "bolt" },
  { name: "riverrat_rj", initials: "RV", accent: "#79c9ff", avatarUrl: null, avatarPreset: "river" },
  { name: "priyapushes", initials: "PR", accent: "#65d6a2", avatarUrl: null, avatarPreset: "ace" },
  { name: "wrenzo_44", initials: "WR", accent: "#f08ca7", avatarUrl: null, avatarPreset: "crown" },
  { name: "cole_cashout", initials: "CO", accent: "#9ad9c0", avatarUrl: null, avatarPreset: "lucky" },
  { name: "nadiaknows", initials: "ND", accent: "#e0a4ff", avatarUrl: null, avatarPreset: "diamond" },
  { name: "marcopolo_9", initials: "MC", accent: "#ffb38c", avatarUrl: null, avatarPreset: "bolt" },
  { name: "dmitridoesit", initials: "DM", accent: "#8ec4f0", avatarUrl: null, avatarPreset: "river" },
  { name: "aisha_allin", initials: "AS", accent: "#7fd8b4", avatarUrl: null, avatarPreset: "ace" },
  { name: "sofiasnapz", initials: "SF", accent: "#f5a0bd", avatarUrl: null, avatarPreset: "crown" },
  { name: "kenjikombo", initials: "KJ", accent: "#a8cf8f", avatarUrl: null, avatarPreset: "lucky" },
  { name: "rosarunsit", initials: "RS", accent: "#cf9bf0", avatarUrl: null, avatarPreset: "diamond" },
  { name: "emeka_ez", initials: "EM", accent: "#ffc79a", avatarUrl: null, avatarPreset: "bolt" },
  { name: "lena_limitless", initials: "LE", accent: "#96bfe8", avatarUrl: null, avatarPreset: "river" },
  { name: "turbotobias", initials: "TB", accent: "#6fcfa8", avatarUrl: null, avatarPreset: "ace" },
  { name: "yara_yolo", initials: "YA", accent: "#eb9db4", avatarUrl: null, avatarPreset: "crown" },
  // Twelve more handles means a seat that turns over is far less likely to
  // hand back a tag the player just watched leave. The whole illusion is a
  // room with people coming and going, not six chairs cycling a short list.
  { name: "bluffcity_dre", initials: "BD", accent: "#8fd6a8", avatarUrl: null, avatarPreset: "lucky" },
  { name: "notyourlucky", initials: "NY", accent: "#c08dff", avatarUrl: null, avatarPreset: "diamond" },
  { name: "smallballsteve", initials: "SB", accent: "#ff9e78", avatarUrl: null, avatarPreset: "bolt" },
  { name: "kingsley_g", initials: "KG", accent: "#79c9ff", avatarUrl: null, avatarPreset: "river" },
  { name: "mimi_muckd", initials: "MI", accent: "#65d6a2", avatarUrl: null, avatarPreset: "ace" },
  { name: "donnie_dubs", initials: "DD", accent: "#f08ca7", avatarUrl: null, avatarPreset: "crown" },
  { name: "htown_hoops", initials: "HT", accent: "#9ad9c0", avatarUrl: null, avatarPreset: "lucky" },
  { name: "okay_kayla", initials: "OK", accent: "#e0a4ff", avatarUrl: null, avatarPreset: "diamond" },
  { name: "benny_bankroll", initials: "BB", accent: "#ffb38c", avatarUrl: null, avatarPreset: "bolt" },
  { name: "slowroll_sam", initials: "SR", accent: "#8ec4f0", avatarUrl: null, avatarPreset: "river" },
  { name: "zaravibes", initials: "ZV", accent: "#7fd8b4", avatarUrl: null, avatarPreset: "ace" },
  { name: "tiny_3bet", initials: "TN", accent: "#f5a0bd", avatarUrl: null, avatarPreset: "crown" },
];

/** The pool's tags alone, so a test can pin the register Kayo asked for
 *  (see the pool's own note) without this table becoming public API. */
export const BOT_TAGS: readonly string[] = botProfiles.map((profile) => profile.name);
