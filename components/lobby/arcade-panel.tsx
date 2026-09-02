"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { Gamepad2 } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";
import { ARCADE_GAMES, arcadeFloorSummary, toArcadeWallet } from "@/lib/arcade/games";
import { tapSound } from "@/lib/audio/ui-sounds";

/**
 * The hub's arcade tile: what is behind /games, in one row.
 *
 * It used to be the whole catalogue: ten scrolling rows of name, stake and
 * Play, inside a 2x2 grid cell with a half-cut fifth row as the only hint
 * that it scrolled. That was the right shape when the arcade was four rows
 * and a promise; at ten live games it's a list competing with the hub's own
 * tiles for the same job, in a box a third their size, with the last six
 * games reachable only by scrolling inside a card on a page that also
 * scrolls. The catalogue has its own route now (app/(lobby)/games/page.tsx),
 * and this is a door to it.
 *
 * The wallet predicates moved with the list. Nothing here is gated, since
 * nothing here is a purchase: "See all" always works, and affordability is
 * decided per row on the floor itself, which is also the only place it can be
 * shown honestly.
 */
export function ArcadePanel({
  profile,
  style,
}: {
  profile: PlayerProfile | null;
  /** Carries `--tile-index` from lobby.tsx. This section shares
   * `.hub-tile`'s entrance stagger, so it needs the same custom property
   * every other tile sets inline. */
  style?: CSSProperties;
}) {
  // Counted, not written down. The header used to read "10 games in the
  // works", which was true when none of them were and quietly became a lie
  // the day Blackjack shipped. A hub blurb must not misdescribe what's
  // behind it (see lib/arcade/games.ts's own header for the rule this broke
  // once, on a game that has since been deleted).
  const summary = arcadeFloorSummary(ARCADE_GAMES);
  const wallet = toArcadeWallet(profile);

  return (
    <section className="hub-tile hub-tile-arcade" style={style} aria-labelledby="arcade-heading">
      <div className="arcade-head">
        <Gamepad2 size={16} aria-hidden="true" />
        <div className="arcade-head-copy">
          <strong id="arcade-heading">Ante Up</strong>
          {/* Both counted off the catalogue, never written down -- see the
              note on `summary` above. "free every day" was the old wording
              and was wrong twice: these are free every time, not once a day,
              and the number it counted was the empty puzzle bucket, so the
              tile shipped reading "0 free every day". */}
          <small>
            {summary.free} free to play · {summary.staked} staked in Gold
          </small>
        </div>
      </div>

      {/* Names, not a count. "10 games" tells a player nothing they can want;
          four titles tell them whether the door is worth opening. Truncated by
          CSS rather than sliced here, so the list stays honest at any width. */}
      <p className="arcade-preview">{summary.previewNames.join(" · ")}</p>

      <Link className="arcade-see-all" href="/games" onClick={tapSound}>
        See all
        {/* The balance the floor's stakes will be checked against, stated on
            the way in. A player who cannot afford a 1,000 Gold round should
            find that out before they pick a machine, not after. */}
        <span className="arcade-see-all-wallet">
          {wallet.unlimitedGold ? "Unlimited" : wallet.goldBalance.toLocaleString()} Gold
        </span>
      </Link>
    </section>
  );
}
