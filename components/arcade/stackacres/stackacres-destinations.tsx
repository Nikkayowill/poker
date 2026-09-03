"use client";

import clsx from "clsx";
import { zonesByDistance, type ZoneId } from "@/lib/stackacres/zones";

/**
 * The signpost: where else there is to go.
 *
 * The map has been roamable in every direction for a while, but roaming is
 * only worth doing if you know something is out there -- and a world whose
 * districts you can only find by dragging far enough in the right direction
 * is a world most players never see past the fence of. This is the one piece
 * of chrome that exists purely to answer "where else?", and tapping an entry
 * flies the camera to that district's gate.
 *
 * Ordered outward from the farm (`zonesByDistance`), so it reads as a journey
 * rather than as an alphabetised menu, and the farm itself is first because
 * it is both where you start and what "back" means.
 *
 * It is deliberately NOT a map, a minimap or a fast-travel menu with costs and
 * cooldowns. It is a signpost at a junction: four names and the direction
 * each one is in. The travelling is still done by the camera, over ground the
 * player watches go past, which is most of what makes four rectangles feel
 * like one place.
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
}

export function StackAcresDestinations({ active, onTravel }: StackAcresDestinationsProps) {
  return (
    <nav className="sa-destinations" aria-label="Places">
      {zonesByDistance().map((zone) => (
        <button
          key={zone.id}
          type="button"
          className={clsx("sa-dest", `sa-dest-${zone.id}`, { "is-there": active === zone.id })}
          // The blurb is the honest description of the place and belongs to
          // the button, not to a tooltip a thumb can never open.
          title={zone.blurb}
          aria-label={`${zone.label}, ${HEADING[zone.id]} — ${zone.blurb}`}
          onClick={() => onTravel(zone.id)}
        >
          <span className="sa-dest-swatch" aria-hidden="true" />
          <span className="sa-dest-text">
            <span className="sa-dest-name">{zone.label.replace(/^The /, "")}</span>
            <span className="sa-dest-way" aria-hidden="true">
              {HEADING[zone.id]}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}
