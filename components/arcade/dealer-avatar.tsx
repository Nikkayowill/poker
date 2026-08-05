import clsx from "clsx";

/**
 * The house dealer, drawn rather than shipped as a file.
 *
 * Same reasoning as components/card-back-art.tsx: the figure is simple enough
 * that an SVG stays crisp at every size and costs a few hundred bytes, and
 * there is exactly one drawing so the felt and any future preview cannot
 * drift apart.
 *
 * Deliberately NOT a ProfileAvatar with some avatar cosmetic id. The avatar
 * catalog is player property -- twenty faces that are bought, or earned by
 * winning hands (lib/server/avatar-unlocks.ts) -- and dressing the house in
 * one would both imply the dealer is a player and quietly devalue an item
 * somebody paid or ground for. The dealer reads as staff: visor, collar,
 * house colours, no accent ring.
 *
 * Framed as a FACE CROP, not a figure. Every player avatar beside it is
 * avatarFace() -- a head filling the disc -- and the first version of this
 * drew a whole croupier standing inside the circle instead. At the 34px it
 * actually renders, that made the head about eleven pixels tall and the visor
 * a green bar across it, which read as a smudge next to a real face. The head
 * now spans the frame the way the photographic crops do, and the visor sits
 * on the brow with the eyes clear beneath it.
 *
 * Renders on the server -- no "use client", no hooks, no state.
 */
export function DealerAvatar({ className }: { className?: string }) {
  return (
    <span className={clsx("dealer-avatar", className)} role="img" aria-label="Vera, the house dealer">
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        {/* Felt disc, so the dealer occupies the same circular footprint a
            player's .profile-avatar does. */}
        <circle cx="32" cy="32" r="32" fill="#123527" />

        {/* Shoulders and collar, clipped by the disc -- just enough to read as
            a body under the chin rather than a floating head. */}
        <path d="M32 47c11.4 0 20.6 6.9 22.6 16.1A32 32 0 0 1 32 64a32 32 0 0 1-22.6-.9C11.4 53.9 20.6 47 32 47Z" fill="#1b2b24" />
        <path d="M27 48.6 32 57l5-8.4a25 25 0 0 1 4.6 1.7L37 64H27l-4.6-13.7a25 25 0 0 1 4.6-1.7Z" fill="#0e1a15" />
        {/* Neck. */}
        <path d="M26.8 40h10.4v9.4c0 2.9-2.3 4.6-5.2 4.6s-5.2-1.7-5.2-4.6Z" fill="#c2916a" />

        {/* Head, filling the frame. */}
        <ellipse cx="32" cy="30" rx="17.4" ry="20.4" fill="#dcae83" />
        {/* Ears. */}
        <ellipse cx="14.8" cy="31.5" rx="2.6" ry="3.6" fill="#d2a179" />
        <ellipse cx="49.2" cy="31.5" rx="2.6" ry="3.6" fill="#d2a179" />

        {/* Hair, pulled back tidy. Drawn as a cap over the crown so the
            forehead stays clear for the visor. */}
        <path d="M32 8.4c10 0 16.6 6.2 16.6 14.6 0 2.2-.3 4-.8 5.6l-2.4-1.2c-.4-4.6-1.6-7.4-3.6-9.2-2.6 2-6.2 2.9-9.8 2.9s-7.2-.9-9.8-2.9c-2 1.8-3.2 4.6-3.6 9.2l-2.4 1.2c-.5-1.6-.8-3.4-.8-5.6C15.4 14.6 22 8.4 32 8.4Z" fill="#2b2320" />

        {/* Brows, eyes, nose, mouth. Five marks -- anything finer turns to
            mush at 34px, which is the whole lesson of the first version. */}
        <path d="M23.4 30.2c1.6-1 3.8-1 5.4-.2" fill="none" stroke="#3b2f28" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M40.6 30.2c-1.6-1-3.8-1-5.4-.2" fill="none" stroke="#3b2f28" strokeWidth="1.4" strokeLinecap="round" />
        <ellipse cx="25.6" cy="34.4" rx="2" ry="2.4" fill="#2b2320" />
        <ellipse cx="38.4" cy="34.4" rx="2" ry="2.4" fill="#2b2320" />
        <circle cx="26.3" cy="33.6" r=".7" fill="#fff" fillOpacity=".85" />
        <circle cx="39.1" cy="33.6" r=".7" fill="#fff" fillOpacity=".85" />
        <path d="M32 36.4v3.4" fill="none" stroke="#b4805a" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M28 43.4c2.4 1.8 5.6 1.8 8 0" fill="none" stroke="#8f5f42" strokeWidth="1.6" strokeLinecap="round" />

        {/* The visor: the whole "dealer" signal, sitting on the brow with the
            eyes clear beneath it. Translucent green over a solid brim, the way
            a real one reads. */}
        <path d="M13.6 24.4c4.6-3.2 11-5 18.4-5s13.8 1.8 18.4 5l.8 3.4c-5.4-2.6-11.8-4-19.2-4s-13.8 1.4-19.2 4Z" fill="#0c5c3f" />
        <path d="M14.4 27.8c5.2-2.4 11.2-3.6 17.6-3.6s12.4 1.2 17.6 3.6c-.6 2.6-2.2 4.2-4.4 4.2-9-2.2-17.4-2.2-26.4 0-2.2 0-3.8-1.6-4.4-4.2Z" fill="#19a771" fillOpacity=".5" />
        <path d="M13.6 24.4c4.6-3.2 11-5 18.4-5s13.8 1.8 18.4 5" fill="none" stroke="#d9b85d" strokeOpacity=".55" strokeWidth="1.4" />
      </svg>
    </span>
  );
}
