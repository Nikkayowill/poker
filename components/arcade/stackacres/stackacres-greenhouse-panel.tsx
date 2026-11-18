"use client";

import { useMemo, type SyntheticEvent } from "react";
import { X } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  STACKACRES_CATALOGUE,
  type SeedStock,
  type StackAcresCrop,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import {
  GREENHOUSE_ALLOWED_STOCK,
  GREENHOUSE_GROWTH_MULTIPLIER,
  GREENHOUSE_SLOT_CAP,
  greenhouseBuildCheck,
  greenhouseSlotLayouts,
  type GreenhouseBuildCheck,
} from "@/lib/stackacres/greenhouse";
import { machineItemIcon, machineItemLabel } from "@/lib/stackacres/machine-items";
import type { StackAcresInventory } from "@/lib/stackacres/inventory";
import { SEED_SELLER_NAME, SEED_SELLER_WHERE } from "@/lib/stackacres/seed-seller";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The Greenhouse panel: reached by tapping the Greenhouse, or the stone
 * footing it goes up on, on the Homestead (`onGreenhouseTap`,
 * components/arcade/stackacres-td/scene.ts). Two very different
 * screens live behind one component because they are the same PLACE at two
 * moments -- before a single piece of Flour or Cloth has been spent on it,
 * and after -- the same way `sectorClearCheck`'s modal and a cleared
 * district's own sidebar row are two faces of one `SectorId`.
 *
 * THE MAP DRAWS THE GREENHOUSE, NOT WHAT GROWS IN IT, so this panel is the
 * only place a housed crop is sown, watered and collected. A crop goes in as
 * dry seed and only grows once watered, from the same can as a crop outside.
 *
 * SLOTS ARE A CAPACITY VISUALIZATION, NOT A PLOT. `homestead_units` stores
 * no row/col -- only `housed_in = 'greenhouse'` and a count the database
 * caps at `GREENHOUSE_SLOT_CAP`. That is a deliberate continuation of
 * StackAcres' own "places, not plots" rule (lib/stackacres/world.ts's own
 * header): a unit you own has no position of its own to look up, on the open
 * farm or in here. `greenhouseSlotLayouts()` gives this panel six STABLE
 * positions to draw against, and `slotsFor` below pairs them with housed
 * units positionally, in the same creation order the server already returns
 * them in -- a real, deterministic picture, not a claim that unit N truly
 * stands in slot N. Sowing therefore
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
      /** Dry soil, including seed waiting for its first water. */
      readonly thirsty: boolean;
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
    return {
      kind: "growing",
      unitId: unit.id,
      stock: unit.stock,
      progress: unit.progress ?? 0,
      thirsty: unit.state === "dry",
    };
  });
}

/** How much sooner a crop finishes under glass, as a whole percent, worked
 *  out from the multiplier the server puts on its `ready_at`. Both screens
 *  say it the same way. */
export const GREENHOUSE_FASTER_PERCENT = Math.round((1 - GREENHOUSE_GROWTH_MULTIPLIER) * 100);

/** What the next empty bed says when there is no seed to sow: the Journal's
 *  own line for it. */
export const GREENHOUSE_NO_SEED = `You're out of seed. ${SEED_SELLER_NAME} sells it at ${SEED_SELLER_WHERE}.`;

/** What the panel says when a crop is thirsty and the can is empty: the
 *  watering can's own line for it out on the farm. */
export const GREENHOUSE_CAN_EMPTY = "Your watering can is empty. Fill it at the well.";

/** A crop the farm can sow under glass right now, and how much of its seed
 *  is on hand. */
export interface GreenhouseSeedChoice {
  readonly stock: StackAcresCrop;
  readonly held: number;
}

/** Every crop the farm holds seed for, in the catalogue's order. Sowing
 *  spends one seed, so a crop with none is not offered at all. */
export function greenhouseSeedChoices(seedStock: SeedStock): GreenhouseSeedChoice[] {
  return GREENHOUSE_ALLOWED_STOCK.flatMap((stock) => {
    const held = seedStock[stock] ?? 0;
    return held > 0 ? [{ stock, held }] : [];
  });
}

/** What a sow button says: the crop, and the seed on hand for it. */
export function greenhouseSowLabel(choice: GreenhouseSeedChoice): string {
  const seeds = choice.held === 1 ? "seed" : "seeds";
  return `Sow ${STACKACRES_CATALOGUE[choice.stock].label} (${choice.held.toLocaleString()} ${seeds})`;
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
  /** Seed on hand, by crop: which crops the next empty bed offers, and how
   *  much of each. */
  seedStock: SeedStock;
  /** Water left in the watering can. A thirsty crop drinks one. */
  water: number;
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `build-greenhouse`. */
  onBuild: () => void;
  /** Posts `stock` with `inGreenhouse: true` for the given crop kind. */
  onSow: (stock: StackAcresStock) => void;
  /** Posts `water` for one thirsty housed crop. Not held back by `busy`: a
   *  seed sown a moment ago can be watered straight away, like one outside. */
  onWater: (unitId: string) => void;
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
      <p className="sa-checklist-intro">
        &ldquo;Glass walls, a Flour sack for grout and a bolt of Cloth for the
        canopy. Crops grow {GREENHOUSE_FASTER_PERCENT}% faster in here,
        rain or shine, up to {GREENHOUSE_SLOT_CAP} at once.&rdquo;
      </p>
      <ul className="sa-checklist-items">
        {check.lines.map((line) => (
          <li
            key={line.item}
            className={line.met ? "sa-checklist-item is-found" : "sa-checklist-item is-unfound"}
          >
            <span className="sa-checklist-item-badge" aria-hidden="true">
              <StackAcresIcon name={machineItemIcon(line.item) as PainterName} size={26} />
            </span>
            <span className="sa-checklist-item-name">
              {machineItemLabel(line.item, line.needed)}
            </span>
            <span className="sa-checklist-item-status">
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
  sowing,
  choices,
  water,
  busy,
  onSow,
  onWater,
  onCollect,
}: {
  slot: GreenhouseSlotView;
  /** This is the empty bed the next sowing lands in, so it carries the
   *  seed list. The other empty beds just say they are empty. */
  sowing: boolean;
  choices: readonly GreenhouseSeedChoice[];
  water: number;
  busy: boolean;
  onSow: (stock: StackAcresStock) => void;
  onWater: (unitId: string) => void;
  onCollect: (unitId: string) => void;
}) {
  if (slot.kind === "ready") {
    const def = STACKACRES_CATALOGUE[slot.stock];
    return (
      <li className="sa-checklist-item is-found">
        <span className="sa-checklist-item-name">{def.label}</span>
        <span className="sa-checklist-item-status">Ready</span>
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
      <li className="sa-checklist-item is-found">
        <span className="sa-checklist-item-name">{def.label}</span>
        <span className="sa-checklist-item-status">
          {slot.thirsty ? "Needs water" : `${Math.round(slot.progress * 100)}% grown`}
        </span>
        {slot.thirsty && (
          <button
            type="button"
            className="sa-cta"
            disabled={water < 1}
            onClick={contain(() => onWater(slot.unitId))}
            onPointerDown={contain()}
          >
            Water
          </button>
        )}
      </li>
    );
  }
  return (
    <li className="sa-checklist-item is-unfound sa-greenhouse-empty-slot">
      <span className="sa-checklist-item-status">Empty bed</span>
      {sowing && choices.length === 0 && <span className="sa-greenhouse-empty-hint">{GREENHOUSE_NO_SEED}</span>}
      {sowing && choices.length > 0 && (
        <>
          <span className="sa-greenhouse-empty-hint">Choose a crop to grow here</span>
          {choices.map((choice) => (
            <button
              key={choice.stock}
              type="button"
              className="sa-cta sa-greenhouse-sow-btn"
              disabled={busy}
              onClick={contain(() => onSow(choice.stock))}
              onPointerDown={contain()}
            >
              {greenhouseSowLabel(choice)}
            </button>
          ))}
        </>
      )}
    </li>
  );
}

function GrowScreen({
  units,
  seedStock,
  water,
  busy,
  onSow,
  onWater,
  onCollect,
}: {
  units: readonly StackAcresUnitSnapshot[];
  seedStock: SeedStock;
  water: number;
  busy: boolean;
  onSow: (stock: StackAcresStock) => void;
  onWater: (unitId: string) => void;
  onCollect: (unitId: string) => void;
}) {
  const slots = useMemo(() => slotsFor(units), [units]);
  const choices = useMemo(() => greenhouseSeedChoices(seedStock), [seedStock]);
  const growing = slots.filter((slot) => slot.kind !== "empty").length;
  const nextEmpty = slots.findIndex((slot) => slot.kind === "empty");
  const thirsty = slots.some((slot) => slot.kind === "growing" && slot.thirsty);
  return (
    <>
      <p className="sa-checklist-intro">
        {growing} of {GREENHOUSE_SLOT_CAP} slots growing. Sealed from the weather outside, and
        {" "}
        {GREENHOUSE_FASTER_PERCENT}% faster than the open field.
      </p>
      {thirsty && water < 1 && <p className="sa-checklist-intro">{GREENHOUSE_CAN_EMPTY}</p>}
      <ul className="sa-checklist-items sa-greenhouse-slots">
        {slots.map((slot, index) => (
          <SlotCard
            key={index}
            slot={slot}
            sowing={index === nextEmpty}
            choices={choices}
            water={water}
            busy={busy}
            onSow={onSow}
            onWater={onWater}
            onCollect={onCollect}
          />
        ))}
      </ul>
    </>
  );
}

export function StackAcresGreenhousePanel({
  built,
  inventory,
  units,
  seedStock,
  water,
  busy,
  onBuild,
  onSow,
  onWater,
  onCollect,
  onClose,
}: GreenhousePanelProps) {
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(onClose);
  const check = useMemo(() => greenhouseBuildCheck(inventory, built), [inventory, built]);

  return (
    <div className="profile-overlay" role="presentation" onMouseDown={contain(onBackdropMouseDown)}>
      <section
        className="profile-modal htp-modal sa-greenhouse-modal"
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
        <div className="htp-body">
          {built ? (
            <GrowScreen
              units={units}
              seedStock={seedStock}
              water={water}
              busy={busy}
              onSow={onSow}
              onWater={onWater}
              onCollect={onCollect}
            />
          ) : (
            <BuildScreen check={check} busy={busy} onBuild={onBuild} />
          )}
        </div>
      </section>
    </div>
  );
}
