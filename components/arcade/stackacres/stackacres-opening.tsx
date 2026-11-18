"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { StackAcresLogo } from "@/components/brand/stackacres-logo";
import { OPENING_CARDS, OPENING_CARD_MS } from "@/lib/stackacres/opening";

export type OpeningPhase = "cards" | "scene";

const RAY_PORTRAIT = "/stackacres-td/portraits/ray-neutral.png";
const RAY_LETTER = "/stackacres-td/ui/opening-letter.png";
/** A letter a beat, quick enough that a line never makes the player wait for it (see `openingLineMs`). */
const TYPE_MS = 26;

/** A line that is written out as it appears. The whole line is laid out from the start, so the box never grows under it. */
function TypedLine({ text }: { text: string }) {
  const [count, setCount] = useState(() => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? text.length : 0));
  useEffect(() => {
    if (count >= text.length) return;
    const id = window.setInterval(() => setCount((shown) => shown + 1), TYPE_MS);
    return () => window.clearInterval(id);
  }, [count, text.length]);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, count)}
        <span className="sa-opening-rest">{text.slice(count)}</span>
      </span>
    </>
  );
}

/**
 * What the player sees over the opening (lib/stackacres/opening.ts): black cards first, then the
 * bus scene with bars top and bottom and Ray's words under the picture. The scene itself is drawn by
 * the map; this is only the cards, the bars, the words and the Skip button.
 *
 * `covered` keeps everything black until the map has the first frame set up, and brings the black
 * back for a skip, so the jump to the porch is not seen. `ending` fades the whole thing out.
 *
 * The cards advance on a tap, Enter or Space, and Escape skips. Skip is a real button, so it is the
 * way through for a keyboard or a screen reader.
 */
export function StackAcresOpening({
  phase,
  line,
  covered,
  ending,
  onCardsDone,
  onSkip,
}: {
  phase: OpeningPhase;
  line: string | null;
  covered: boolean;
  /** The opening is over: everything fades out, and nothing on it can be pressed. */
  ending: boolean;
  onCardsDone: () => void;
  onSkip: () => void;
}) {
  const [card, setCard] = useState(0);
  // The story cards, then the game's own name.
  const cards = OPENING_CARDS.length;
  const last = card >= cards;
  // Ray's letter lies above the words of the cards that mention it, and fades with the last of them.
  const letterUp = card < cards && OPENING_CARDS[card].letter === true;
  const cardsRef = useRef<HTMLDivElement | null>(null);

  // The parent hands a new function on most renders; held in a ref so a render does not restart the card's timer.
  const done = useRef(onCardsDone);
  useEffect(() => {
    done.current = onCardsDone;
  }, [onCardsDone]);

  const next = () => {
    if (last) done.current();
    else setCard((current) => current + 1);
  };
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  });

  useEffect(() => {
    if (phase !== "cards") return;
    const timer = window.setTimeout(() => nextRef.current(), OPENING_CARD_MS);
    return () => window.clearTimeout(timer);
  }, [phase, card]);

  // Ray's face is on screen from his first word, so it is fetched while the cards are up.
  useEffect(() => {
    new Image().src = RAY_PORTRAIT;
    new Image().src = RAY_LETTER;
  }, []);

  useEffect(() => {
    if (phase === "cards") cardsRef.current?.focus({ preventScroll: true });
  }, [phase]);

  return (
    <div
      ref={cardsRef}
      className={clsx("sa-opening", `sa-opening-${phase}`, ending && "is-ending")}
      tabIndex={phase === "cards" ? 0 : undefined}
      onClick={phase === "cards" ? next : undefined}
      onKeyDown={
        phase === "cards"
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                next();
              } else if (event.key === "Escape") onSkip();
            }
          : undefined
      }
    >
      {phase === "cards" && (
        // eslint-disable-next-line @next/next/no-img-element -- a small pixel prop, preloaded above
        <img src={RAY_LETTER} alt="" className={clsx("sa-opening-letter", letterUp && "is-up")} />
      )}
      {phase === "cards" && (
        <div key={card} className="sa-opening-card" aria-live="polite" style={{ animationDuration: `${OPENING_CARD_MS}ms` }}>
          {card < cards ? (
            <p>{OPENING_CARDS[card].text}</p>
          ) : (
            <StackAcresLogo variant="stacked" className="sa-opening-logo" alt="StackAcres" />
          )}
        </div>
      )}
      {phase === "scene" && (
        <>
          <div className="sa-opening-bar sa-opening-bar-top" aria-hidden="true" />
          <div className="sa-opening-bar sa-opening-bar-bottom" aria-hidden="true" />
          <div className="sa-opening-words" aria-live="polite">
            {line && (
              <div key={line} className="sa-opening-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- a 44px pixel portrait, same as the story dialogue's */}
                <img src={RAY_PORTRAIT} alt="" className="sa-opening-portrait" />
                <p>
                  <span className="sa-opening-who">Ray</span>
                  <TypedLine text={line} />
                </p>
              </div>
            )}
          </div>
        </>
      )}
      <div className={clsx("sa-opening-cover", covered && "is-covered")} aria-hidden="true" />
      <button
        type="button"
        className="sa-opening-skip"
        onClick={(event) => {
          event.stopPropagation();
          onSkip();
        }}
      >
        Skip
      </button>
    </div>
  );
}
