"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { STACKACRES_CATALOGUE, type StackAcresStock } from "@/lib/stackacres/catalogue";
import type { BuyOption } from "@/lib/stackacres/district-panel";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The seed menu, dropped on the canvas beside a finger.
 *
 * Tapping a district's empty fenced ground is the "I want something HERE"
 * gesture, and the answer used to be a trip out to the sidebar: travel,
 * wait for the panel, scroll to Buy, pick a kind. This is that choice moved
 * to where the finger already is -- one ring of buttons, one tap each, gone
 * again the moment anything else happens.
 *
 * It is a menu of KINDS, not of everything a district affords. Expanding
 * capacity with Gold and the deep management behind it stay in the sidebar
 * on purpose: they are decisions you make about the farm, not about the
 * patch of mud under your thumb, and a Gold spend should never be one
 * mis-aimed tap away from one that spends Gold.
 *
 * Real DOM buttons, not canvas hit boxes. The Escape key closes it and the
 * first option takes focus when it opens, so a keyboard reaches it -- though
 * a keyboard user's own path to the same purchases is the sidebar's Buy
 * section, which is still there and still complete.
 *
 * Dismissal is NOT this component's job and deliberately so. The tap-anywhere
 * scrim lives in stackacres-farm.tsx, rendered earlier in .sa-field so it
 * covers the map but stacks UNDER the toolbelt, signpost and camera buttons
 * -- which keeps those live while the menu is up, and their camera moves are
 * the other thing that closes it (`onViewMoved`). A scrim in here would be
 * inside this component's own stacking context and would swallow the chrome
 * along with the map.
 */

/** Which painter stands for a stock, matching the sidebar's own buy rows so
 *  the same thing is never two pictures. */
const STOCK_ICON: Readonly<Record<StackAcresStock, PainterName>> = {
  // All 22 crops.
  artichoke: "ico-artichoke",
  beet: "ico-beet",
  brokoly: "ico-brokoly",
  cabbage: "ico-cabbage",
  carrot: "ico-carrot",
  corn: "ico-corn",
  corn2: "ico-corn2",
  cucumber: "ico-cucumber",
  eggplant: "ico-eggplant",
  garlic: "ico-garlic",
  grap: "ico-grap",
  grap2: "ico-grap2",
  onion: "ico-onion",
  pepper: "ico-pepper",
  poppy: "ico-poppy",
  potato: "ico-potato",
  pumpkin: "ico-pumpkin",
  sunflowe_broken: "ico-sunflowe_broken",
  sunflower: "ico-sunflower",
  tomato: "ico-tomato",
  wheat1: "ico-wheat",
  wheat2: "ico-wheat2",
  hen: "hen",
  pig: "sheep",
  cattle: "cow",
};

/** How far the buttons sit from the tap, in pixels, and the arc they spread
 *  over. The whole ring opens ABOVE the tap and symmetrically about it: a
 *  thumb covers what it is pressing, so anything at the finger's own level is
 *  a button chosen blind. At this radius the nearest edge still clears a
 *  fingertip, and two options land ~120px apart -- wide of each other at
 *  78px each. */
const RADIUS = 78;
const ARC_START = -140;
const ARC_END = -40;

/** How much room the ring needs above the tap: the radius, plus half a
 *  button, plus a little air. Below this the whole thing mirrors downward --
 *  a landscape phone is 390px tall and a tap near the top would otherwise
 *  put half the menu off the map. */
const HEADROOM = 118;

/** The same accounting as HEADROOM, measured sideways instead of up: the
 *  radius at the arc's widest (cos of 40 degrees) plus half a button's width,
 *  rounded up with a little air. Below this on one side, .sa-field's own
 *  `overflow: hidden` (52-stackacres.css) does not squeeze that side's
 *  buttons, it clips them off entirely -- gone, not reachable, not just
 *  cramped. Fixed by a nudge rather than a flip: the arc is already
 *  symmetric left-right, so mirroring it (the way HEADROOM's `flip` does
 *  vertically) would change nothing. */
const SIDE_ROOM = 108;

export interface StackAcresRadialMenuProps {
  /** Where the finger landed, in pixels inside .sa-field. */
  at: { x: number; y: number };
  /** The district's own buy options -- the same `buyOptionsForZone` the
   *  sidebar renders, so a kind that is capped or unaffordable says exactly
   *  what it says over there. */
  options: readonly BuyOption[];
  /** The district's own label. Its leading "The " is trimmed below, for the
   *  same reason the signpost trims it (stackacres-destinations.tsx): these
   *  are short inline labels rather than sentences, and "Manage The
   *  Farmstead" reads like a typo. */
  districtLabel: string;
  busy: boolean;
  onSeed: (stock: StackAcresStock) => void;
  onClose: () => void;
  /** "There is more to this district than seeding" -- hands off to the
   *  sidebar for capacity, buying outright and what's already standing here. */
  onManage: () => void;
  /**
   * One extra ring button appended after the stock options, for something
   * that is not a `StackAcresStock` purchase at all -- today, tilling or
   * removing a soil bed under the tap. Not tied to `STOCK_ICON`/`STACKACRES_CATALOGUE`
   * the way a seed option is, since neither exists for a bed; the icon and
   * label are named explicitly instead. `null` when the tapped ground has
   * nothing extra to offer.
   */
  extraActions?: readonly {
    key: string;
    label: string;
    icon: PainterName;
    cost?: number;
    disabledReason?: string;
    onSelect: () => void;
  }[];
}

export function StackAcresRadialMenu({
  at,
  options,
  districtLabel,
  busy,
  onSeed,
  onClose,
  onManage,
  extraActions = [],
}: StackAcresRadialMenuProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  // The extra button (till/remove a bed) is one more slot in the same ring,
  // not a second ring -- it shares the arc's spacing math below so it never
  // reads as a bolted-on afterthought.
  const slotCount = options.length + extraActions.length;

  // Read fresh on every open rather than threaded down from stackacres-farm.tsx
  // as a prop: openPanel() (the ring's own "Manage" handoff) always closes the
  // ring first, so .sa-field is never narrowed by the district drawer while
  // this is up, and window.innerWidth is exactly .sa-field's own width, edge
  // to edge, for as long as that holds.
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Past this many, the fixed 100-degree arc has no room left between
  // buttons and they render almost fully stacked on each other -- the exact
  // failure the Long Meadow hit at 22 crops (see StackAcresSeedStrip's own
  // header) and the Farmstead hit again the same way once it inherited the
  // Crop Fields. A caller with that many options belongs on the seed strip,
  // not here -- this is a loud dev-only signal so that mistake is caught at
  // the call site instead of shipping as a pile of unreadable buttons.
  if (process.env.NODE_ENV !== "production" && slotCount > 6) {
    console.warn(
      `StackAcresRadialMenu: ${slotCount} options for "${districtLabel}" won't fit the ring's fixed arc. ` +
        "Use StackAcresSeedStrip (or otherwise cut this list down) instead.",
    );
  }

  useEffect(() => {
    // Deferred a tick for the same reason stackacres-farm.tsx defers its own
    // localStorage read: focusing synchronously in an effect body fights
    // React's own commit ordering on the frame the menu appears.
    const timer = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // One option sits straight above the finger rather than at the start of an
  // arc it would be the only thing on.
  const spread = slotCount > 1 ? (ARC_END - ARC_START) / (slotCount - 1) : 0;
  const base = slotCount > 1 ? ARC_START : -90;
  // Mirrored about the horizontal when there is no room overhead, which
  // negates every angle and puts the handoff pill above the pin instead.
  const flip = at.y < HEADROOM;
  // How far to nudge the whole ring away from whichever edge is too close --
  // the pin (.sa-radial-pin) is not part of this and stays exactly on the
  // tap, since it is the one thing on screen promising "this is where you
  // touched." At most one of these is ever positive; a viewport narrower than
  // 2 * SIDE_ROOM would need both, but that is well below the smallest phone
  // this app ships against.
  const nudgeX = Math.max(0, SIDE_ROOM - at.x) - Math.max(0, at.x + SIDE_ROOM - viewportWidth);

  const place = districtLabel.replace(/^The /, "");

  return (
    <div className="sa-radial" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-radial-pin" aria-hidden="true" />
      <div className="sa-radial-ring" role="group" aria-label={`Seed at ${place}`}>
        {options.map((option, index) => {
          const degrees = base + spread * index;
          const angle = ((flip ? -degrees : degrees) * Math.PI) / 180;
          const def = STACKACRES_CATALOGUE[option.stock];
          const disabled = busy || !option.seedAfford;
          return (
            <button
              key={option.stock}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              className="sa-radial-btn"
              style={{
                left: `${Math.cos(angle) * RADIUS + nudgeX}px`,
                top: `${Math.sin(angle) * RADIUS}px`,
              }}
              disabled={disabled}
              title={option.seedReason ?? undefined}
              onClick={() => onSeed(option.stock)}
            >
              <StackAcresIcon name={STOCK_ICON[option.stock]} size={26} />
              <span className="sa-radial-name">{option.label}</span>
              {/* Priced with the same purse icon the header and the sidebar's
                  own buy rows use, rather than a "B" abbreviation nothing
                  else on this screen says. */}
              <span className="sa-radial-cost">
                {option.atCap ? (
                  `${option.owned}/${option.cap} full`
                ) : (
                  <>
                    <StackAcresIcon name="ico-gold" size={12} />
                    {def.seedCost.toLocaleString()}
                  </>
                )}
              </span>
            </button>
          );
        })}
        {extraActions.map((extraAction, offset) => {
          const index = options.length + offset;
          const degrees = base + spread * index;
          const angle = ((flip ? -degrees : degrees) * Math.PI) / 180;
          const disabled = busy || Boolean(extraAction.disabledReason);
          return (
            <button
              key={extraAction.key}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              className="sa-radial-btn"
              style={{
                left: `${Math.cos(angle) * RADIUS + nudgeX}px`,
                top: `${Math.sin(angle) * RADIUS}px`,
              }}
              disabled={disabled}
              title={extraAction.disabledReason}
              onClick={extraAction.onSelect}
            >
              <StackAcresIcon name={extraAction.icon} size={26} />
              <span className="sa-radial-name">{extraAction.label}</span>
              {typeof extraAction.cost === "number" && (
                <span className="sa-radial-cost">
                  <StackAcresIcon name="ico-gold" size={12} />
                  {extraAction.cost.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={clsx("sa-radial-more", { "is-under-ring": flip })}
        style={{ left: `${nudgeX}px` }}
        onClick={onManage}
      >
        Manage {place}
      </button>
    </div>
  );
}
