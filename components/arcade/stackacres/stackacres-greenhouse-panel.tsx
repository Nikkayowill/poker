"use client";

import { useMemo, type SyntheticEvent } from "react";
import { X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { STACKACRES_CATALOGUE, type StackAcresStock } from "@/lib/stackacres/catalogue";
import {
  GREENHOUSE_ALLOWED_STOCK,
  GREENHOUSE_GROWTH_MULTIPLIER,
  GREENHOUSE_SLOT_CAP,
  greenhouseBuildCheck,
  greenhouseSlotLayouts,
  type GreenhouseBuildCheck,
} from "@/lib/stackacres/greenhouse";
import { MACHINE_ITEM_CATALOGUE, machineItemLabel } from "@/lib/stackacres/machine-items";
import type { StackAcresInventory } from "@/lib/stackacres/inventory";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The Greenhouse panel: reached by tapping its footprint on the map
 * (`onGreenhouseTap` in stackacres-scene.ts / stackacres-world.tsx), which
 * also eases the camera inside it (`enterGreenhouse`). Two very different
 * screens live behind one component because they are the same PLACE at two
 * moments -- before a single piece of Flour or Cloth has been spent on it,
 * and after -- the same way `sectorClearCheck`'s modal and a cleared
 * district's own sidebar row are two faces of one `SectorId`.
 *
 * SLOTS ARE A CAPACITY VISUALIZATION, NOT A PLOT. `homestead_units` stores
 * no row/col -- only `housed_in = 'greenhouse'` and a count the database
 * caps at `GREENHOUSE_SLOT_CAP`. That is a deliberate continuation of
 * StackAcres' own "places, not plots" rule (lib/stackacres/world.ts's own
 * header): a unit you own has no position of its own to look up, on the open
 * farm or in here. `greenhouseSlotLayouts()` gives this panel (and the
 * scene's own static footprint) six STABLE positions to draw against, and
 * `slotsFor` below pairs them with housed units positionally, in the same
 * creation order the server already returns them in -- a real, deterministic
 * picture, not a claim that unit N truly stands in slot N. Sowing therefore
 * asks for a STOCK KIND, never a slot: whichever slot is empty next is
 * simply the one a fresh crop's picture lands in.
 */

export type GreenhouseSlotView =
  | { readonly kind: "empty" }
  | {
      readonly kind: "growing";
      readonly unitId: string;
      readonly stock: StackAcresStock;
      readonly progress: number;
    }
  | { readonly kind: "ready"; readonly unitId: string; readonly stock: StackAcresStock };

/** Every housed, unmucked unit paired positionally with a stable slot
 *  layout -- see the file header. Mucked units are surfaced through the
 *  ordinary outdoor sidebar/tap-action path like any other muck, not
 *  through this panel, which only shows growing and ready crops. */
export function slotsFor(units: readonly StackAcresUnitSnapshot[]): GreenhouseSlotView[] {
  const housed = units.filter((unit) => unit.housedIn === "greenhouse" && unit.state !== "mucked");
  const layout = greenhouseSlotLayouts();
  return layout.map((_slot, index): GreenhouseSlotView => {
    const unit = housed[index];
    if (!unit) return { kind: "empty" };
    if (unit.state === "ready") return { kind: "ready", unitId: unit.id, stock: unit.stock };
    return { kind: "growing", unitId: unit.id, stock: unit.stock, progress: unit.progress ?? 0 };
  });
}

export interface GreenhousePanelProps {
  /** Whether the Greenhouse has been built yet -- gates which of the two
   *  screens this panel shows. */
  built: boolean;
  /** The processing-track shelf the build cost is checked against. */
  inventory: StackAcresInventory;
  /** Every owned unit -- filtered to the housed, unmucked ones by
   *  `slotsFor`. */
  units: readonly StackAcresUnitSnapshot[];
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `build-greenhouse`. */
  onBuild: () => void;
  /** Posts `stock` with `inGreenhouse: true` for the given crop kind. */
  onSow: (stock: StackAcresStock) => void;
  /** Posts `collect` for one ready housed unit. */
  onCollect: (unitId: string) => void;
  onClose: () => void;
}

/** Same "consume the press here, do not let it fall through to the map
 *  underneath" wrapper TownContractsModal.tsx documents in full -- this
 *  sheet renders outside the Phaser host, so `stopPropagation` alone is the
 *  whole story here (see that file's own header for the scene's own,
 *  different trap). */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

function BuildScreen({
  check,
  busy,
  onBuild,
}: {
  check: GreenhouseBuildCheck;
  busy: boolean;
  onBuild: () => void;
}) {
  return (
    <>
      <p className="sa-museum-intro">
        &ldquo;Glass walls, a Flour sack for grout and a bolt of Cloth for the
        canopy. Keeps a crop growing at {Math.round(GREENHOUSE_GROWTH_MULTIPLIER * 100)}% pace,
        rain or shine, up to {GREENHOUSE_SLOT_CAP} at once.&rdquo;
      </p>
      <ul className="sa-museum-items">
        {check.lines.map((line) => (
          <li
            key={line.item}
            className={line.met ? "sa-museum-item is-found" : "sa-museum-item is-unfound"}
          >
            <span className="sa-museum-item-badge" aria-hidden="true">
              <StackAcresIcon name={MACHINE_ITEM_CATALOGUE[line.item].icon as PainterName} size={26} />
            </span>
            <span className="sa-museum-item-name">
              {machineItemLabel(line.item, line.needed)}
            </span>
            <span className="sa-museum-item-status">
              {line.held.toLocaleString()} / {line.needed.toLocaleString()} on hand
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="sa-cta"
        disabled={busy || !check.ok}
        onClick={contain(onBuild)}
        onPointerDown={contain()}
      >
        {check.ok ? "Build the Greenhouse" : "Not enough materials yet"}
      </button>
    </>
  );
}

function SlotCard({
  slot,
  busy,
  onSow,
  onCollect,
}: {
  slot: GreenhouseSlotView;
  busy: boolean;
  onSow: (stock: StackAcresStock) => void;
  onCollect: (unitId: string) => void;
}) {
  if (slot.kind === "ready") {
    const def = STACKACRES_CATALOGUE[slot.stock];
    return (
      <li className="sa-museum-item is-found">
        <span className="sa-museum-item-name">{def.label}</span>
        <span className="sa-museum-item-status">Ready</span>
        <button
          type="button"
          className="sa-cta"
          disabled={busy}
          onClick={contain(() => onCollect(slot.unitId))}
          onPointerDown={contain()}
        >
          Collect
        </button>
      </li>
    );
  }
  if (slot.kind === "growing") {
    const def = STACKACRES_CATALOGUE[slot.stock];
    return (
      <li className="sa-museum-item is-found">
        <span className="sa-museum-item-name">{def.label}</span>
        <span className="sa-museum-item-status">{Math.round(slot.progress * 100)}% grown</span>
      </li>
    );
  }
  return (
    <li className="sa-museum-item is-unfound sa-greenhouse-empty-slot">
      <span className="sa-museum-item-status">Empty</span>
      {GREENHOUSE_ALLOWED_STOCK.map((stock) => {
        const def = STACKACRES_CATALOGUE[stock];
        return (
          <button
            key={stock}
            type="button"
            className="sa-cta sa-greenhouse-sow-btn"
            disabled={busy}
            onClick={contain(() => onSow(stock))}
            onPointerDown={contain()}
          >
            Sow {def.label} ({def.seedCost.toLocaleString()}g)
          </button>
        );
      })}
    </li>
  );
}

function GrowScreen({
  units,
  busy,
  onSow,
  onCollect,
}: {
  units: readonly StackAcresUnitSnapshot[];
  busy: boolean;
  onSow: (stock: StackAcresStock) => void;
  onCollect: (unitId: string) => void;
}) {
  const slots = useMemo(() => slotsFor(units), [units]);
  const growing = slots.filter((slot) => slot.kind !== "empty").length;
  return (
    <>
      <p className="sa-museum-intro">
        {growing} of {GREENHOUSE_SLOT_CAP} slots growing. Sealed from the weather outside, and
        {" "}
        {Math.round((1 - GREENHOUSE_GROWTH_MULTIPLIER) * 100)}% faster than the open field.
      </p>
      <ul className="sa-museum-items sa-greenhouse-slots">
        {slots.map((slot, index) => (
          <SlotCard key={index} slot={slot} busy={busy} onSow={onSow} onCollect={onCollect} />
        ))}
      </ul>
    </>
  );
}

export function StackAcresGreenhousePanel({
  built,
  inventory,
  units,
  busy,
  onBuild,
  onSow,
  onCollect,
  onClose,
}: GreenhousePanelProps) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  const check = useMemo(() => greenhouseBuildCheck(inventory, built), [inventory, built]);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={contain(onBackdropMouseDown)}>
      <section
        className="profile-modal htp-modal sa-museum-modal sa-greenhouse-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-greenhouse-title"
        onMouseDown={contain()}
      >
        <header className="profile-modal-header">
          <div>
            <span>THE GREENHOUSE</span>
            <h2 id="sa-greenhouse-title">{built ? "Under glass" : "Not built yet"}</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={contain(onClose)} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="htp-body sa-museum-body">
          {built ? (
            <GrowScreen units={units} busy={busy} onSow={onSow} onCollect={onCollect} />
          ) : (
            <BuildScreen check={check} busy={busy} onBuild={onBuild} />
          )}
        </div>
      </section>
    </div>
  );
}
