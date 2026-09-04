"use client";

import clsx from "clsx";
import { Lock } from "lucide-react";
import { isSectorUnlocked, type SectorId } from "@/lib/stackacres/sectors";
import { zonesByDistance, type ZoneId } from "@/lib/stackacres/zones";

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
 */

/** Which way each district lies from the farmyard, on screen. Written down
 *  rather than derived: the isometric shear means a district that is due
 *  south in world space arrives at the lower LEFT of the screen, and the
 *  compass a player reads has to match the thumb, not the coordinates. */
const HEADING: Readonly<Record<ZoneId, string>> = {
  farmstead: "home",
  meadow: "south",
  oxfields: "east",
  wallow: "north-west",
};

export interface StackAcresDestinationsProps {
  /** Null until the player has travelled somewhere; the farm is where the
   *  camera opens, but "at the farm" is not a thing this component can know
   *  on its own -- panning away is not arriving anywhere. */
  active: ZoneId | null;
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
  /** Produce sitting in the barn, unsold -- shown as a badge on Ray's entry
   *  the same way it used to sit on the header's own Store button. */
  carrying: number;
}

export function StackAcresDestinations({
  active,
  onTravel,
  unlocked,
  onOpenStore,
  carrying,
}: StackAcresDestinationsProps) {
  return (
    <nav className="sa-destinations" aria-label="Places">
      {zonesByDistance().map((zone) => {
        const open = isSectorUnlocked(zone.id, unlocked);
        return (
          <button
            key={zone.id}
            type="button"
            className={clsx("sa-dest", `sa-dest-${zone.id}`, {
              "is-there": active === zone.id,
              "is-wild": !open,
            })}
            // The blurb is the honest description of the place and belongs to
            // the button, not to a tooltip a thumb can never open.
            title={open ? zone.blurb : `${zone.blurb} Not cleared yet.`}
            aria-label={`${zone.label}, ${HEADING[zone.id]} — ${zone.blurb}${open ? "" : " Not cleared yet."}`}
            onClick={() => onTravel(zone.id)}
          >
            <span className="sa-dest-swatch" aria-hidden="true" />
            <span className="sa-dest-text">
              <span className="sa-dest-name">{zone.label.replace(/^The /, "")}</span>
              <span className="sa-dest-way" aria-hidden="true">
                {open ? HEADING[zone.id] : "uncleared"}
              </span>
            </span>
            {!open && (
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
        title="Sell produce, buy feed, and exchange Bushels for Gold."
        aria-label="Buy from Ray — sell produce, buy feed, and exchange Bushels for Gold."
        onClick={onOpenStore}
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
    </nav>
  );
}
