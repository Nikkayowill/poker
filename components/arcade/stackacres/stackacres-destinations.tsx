"use client";

import clsx from "clsx";
import { ChevronDown, Compass, Lock, ScrollText } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { isSectorUnlocked, type SectorId } from "@/lib/stackacres/sectors";
import { STACKACRES_ZONES, zonesByDistance, type ZoneId } from "@/lib/stackacres/zones";

/**
 * The signpost: where else there is to go, and where to spend what you made.
 *
 * The map has been roamable in every direction for a while, but roaming is
 * only worth doing if you know something is out there -- and a world whose
 * districts you can only find by dragging far enough in the right direction
 * is a world most players never see past the fence of. This is the one piece
 * of chrome that exists purely to answer "where else?", and tapping a
 * district entry flies the camera to that district's gate.
 *
 * Ordered outward from the farm (`zonesByDistance`), so it reads as a journey
 * rather than as an alphabetised menu, and the farm itself is first because
 * it is both where you start and what "back" means. Grandfather Ray sits
 * last, after every district: he is not somewhere further out, he is who you
 * see once you have something to spend.
 *
 * The district entries are deliberately NOT a map, a minimap or a fast-travel
 * menu with costs and cooldowns -- four names and the direction each one is
 * in, and the travelling is still done by the camera, over ground the player
 * watches go past. Ray's entry breaks that pattern on purpose: he is already
 * standing at the Farmstead (see props.ts), so there is nowhere for the
 * camera to fly to, and tapping him opens the supply store directly instead.
 * That used to be its own "Store" button in the header; folding it in here
 * is what makes "go to him to buy anything" literally true rather than a
 * turn of phrase -- there is no purchase path left that does not start by
 * picking Ray off this list.
 *
 * On a short landscape phone (`compact`) the six boards collapse into one
 * compass button -- the Compass Quick-Nav -- that names where you are and
 * drops the same list down when tapped. The rail used to wrap onto two rows
 * there and cover a good third of the map; the screen it gives back is what
 * the camera's `viewExpansion` pulls out into.
 */

/** Which way each district lies from the farmyard, on screen. Written down
 *  rather than derived: the isometric shear means a district that is due
 *  south in world space arrives at the lower LEFT of the screen, and the
 *  compass a player reads has to match the thumb, not the coordinates.
 *
 *  Re-derived for the 2026-09-07 map re-lay by projecting each district's
 *  centre relative to the Farmstead's and reading the screen angle off it.
 *  FOUR OF THE NINE READ "east", and that is not a mistake to fix: the map is
 *  a band running east across the screen, so most of it genuinely is east of
 *  home. The heading is a hint, not an identifier -- the rail is sorted by
 *  `zonesByDistance` and labelled with the district's own name, which is what
 *  actually tells two easts apart. */
const HEADING: Readonly<Record<ZoneId, string>> = {
  farmstead: "home",
  henhaven: "north-east",
  meadow: "east",
  oxfields: "east",
  wallow: "east",
  townsquare: "south-west",
  mine: "north-east",
  coast: "east",
  oak: "east",
};

export interface StackAcresDestinationsProps {
  /** Null until the player has travelled somewhere; the farm is where the
   *  camera opens, but "at the farm" is not a thing this component can know
   *  on its own -- panning away is not arriving anywhere. */
  active: ZoneId | null;
  /** Collapse the rail into the compass quick-nav (short landscape phones). */
  compact?: boolean;
  onTravel: (zone: ZoneId) => void;
  /**
   * Land the player may work. A district not in here is still listed and
   * still travelled to -- the signpost's job is to say a place exists, and
   * hiding one until it is bought would mean nobody knows there is anything
   * to buy. It just wears a lock, and arriving makes the offer.
   */
  unlocked: readonly SectorId[];
  /** Opens the supply store. Ray's own entry, not a travel target. */
  onOpenStore: () => void;
  /** Opens the town board. Like Ray's entry, not a travel target: the town
   *  itself is off the map -- what is on the farm is the board it posts to,
   *  and the whole of it is the sheet this opens. */
  onOpenContracts: () => void;
  /** Whether the town currently has an order up, for the dot on the entry.
   *  Deliberately not a count: there is only ever one (see
   *  lib/stackacres/contracts.ts), so a number would read as a promise of
   *  more. */
  contractPosted: boolean;
  /** Produce sitting in the barn, unsold -- shown as a badge on Ray's entry
   *  the same way it used to sit on the header's own Store button. */
  /** How many fields and pens are ready to bring in. */
  carrying: number;
}

export function StackAcresDestinations({
  active,
  compact = false,
  onTravel,
  unlocked,
  onOpenStore,
  onOpenContracts,
  contractPosted,
  carrying,
}: StackAcresDestinationsProps) {
  const [dropped, setOpen] = useState(false);
  const menuId = useId();
  const navRef = useRef<HTMLElement>(null);
  // Only a compact rail has a drop-down to be open; a wide one always shows
  // its boards, whatever was toggled before a rotation widened it.
  const open = compact && dropped;
  const showList = !compact || open;

  // The drop-down closes on Escape and on a press anywhere outside it -- it
  // sits over the map, and a tap on the map should reach the map.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPress = (e: PointerEvent) => {
      if (navRef.current && e.target instanceof Node && !navRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  const pick = (act: () => void) => () => {
    setOpen(false);
    act();
  };

  const here = active ? STACKACRES_ZONES[active] : STACKACRES_ZONES.farmstead;

  return (
    <nav ref={navRef} className={clsx("sa-destinations", { "is-compact": compact, "is-open": open })} aria-label="Places">
      {compact && (
        <button
          type="button"
          className={clsx("sa-dest sa-quicknav", { "is-there": active !== null })}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`Places -- you are at ${here.label}. ${open ? "Close" : "Open"} the list.`}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="sa-dest-swatch sa-quicknav-compass" aria-hidden="true">
            <Compass size={16} />
          </span>
          <span className="sa-dest-text">
            <span className="sa-dest-name">{here.label.replace(/^The /, "")}</span>
            <span className="sa-dest-way" aria-hidden="true">
              {active ? HEADING[active] : "places"}
            </span>
          </span>
          <span className="sa-quicknav-caret" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
          {(carrying > 0 || contractPosted) && <span className="sa-dest-dot" aria-hidden="true" />}
        </button>
      )}
      {showList && (
        <div id={menuId} className="sa-dest-list">
          {zonesByDistance().map((zone) => {
            const cleared = isSectorUnlocked(zone.id, unlocked);
            return (
              <button
                key={zone.id}
                type="button"
                className={clsx("sa-dest", `sa-dest-${zone.id}`, {
                  "is-there": active === zone.id,
                  "is-wild": !cleared,
                })}
                // The blurb is the honest description of the place and belongs to
                // the button, not to a tooltip a thumb can never open.
                title={cleared ? zone.blurb : `${zone.blurb} Not cleared yet.`}
                aria-label={`${zone.label}, ${HEADING[zone.id]} — ${zone.blurb}${cleared ? "" : " Not cleared yet."}`}
                onClick={pick(() => onTravel(zone.id))}
              >
                <span className="sa-dest-swatch" aria-hidden="true" />
                <span className="sa-dest-text">
                  <span className="sa-dest-name">{zone.label.replace(/^The /, "")}</span>
                  <span className="sa-dest-way" aria-hidden="true">
                    {cleared ? HEADING[zone.id] : "uncleared"}
                  </span>
                </span>
                {!cleared && (
                  <span className="sa-dest-lock" aria-hidden="true">
                    <Lock size={12} />
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            className="sa-dest sa-dest-ray"
            title="Buy feed, and see what is left of the daily allowance."
            aria-label="Buy from Ray — buy feed, and see what is left of the daily allowance."
            onClick={pick(onOpenStore)}
          >
            <img
              src="/stackacres/sprites/grandfather-ray-portrait.png"
              alt=""
              className="sa-dest-ray-portrait"
              aria-hidden="true"
            />
            <span className="sa-dest-text">
              <span className="sa-dest-name">Buy from Ray</span>
              <span className="sa-dest-way" aria-hidden="true">
                supplies
              </span>
            </span>
            {carrying > 0 && (
              <span className="sa-dest-badge" aria-hidden="true">
                {carrying}
              </span>
            )}
          </button>
          <button
            type="button"
            className="sa-dest sa-dest-board"
            title="See what the town is asking for, and what it pays."
            aria-label={
              contractPosted
                ? "Town board — an order is up. See what the town is asking for, and what it pays."
                : "Town board — see what the town is asking for, and what it pays."
            }
            onClick={pick(onOpenContracts)}
          >
            <span className="sa-dest-swatch" aria-hidden="true">
              <ScrollText size={14} />
            </span>
            <span className="sa-dest-text">
              <span className="sa-dest-name">Town board</span>
              <span className="sa-dest-way" aria-hidden="true">
                {contractPosted ? "order up" : "orders"}
              </span>
            </span>
            {contractPosted && <span className="sa-dest-dot" aria-hidden="true" />}
          </button>
        </div>
      )}
    </nav>
  );
}
