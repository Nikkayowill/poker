/**
 * Artwork paths that 404'd this session, shared by every component that draws
 * an avatar. One set, not one per component: six seats can wear the same
 * avatar, and a miss remembered in only one place still fires a failed request
 * per seat, per render, from the others.
 */
export const missingArtwork = new Set<string>();
