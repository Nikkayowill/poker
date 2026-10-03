"use client";

import { useCallback, useMemo, useState, type SyntheticEvent } from "react";
import { Heart } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import { STACKACRES_CATALOGUE, isLivestock, isMarketLivestock, marketAnimalPrice } from "@/lib/stackacres/catalogue";
import { marketWeightOf, maxMarketWeight } from "@/lib/stackacres/sale-barn";
import {
  BARN_STATUS_LABELS,
  MOOD_LABELS,
  animalMoodFor,
  animalNameFor,
  barnStatusFor,
  careYieldBonus,
  hasCaredToday,
  liveCareStreak,
  type BarnStatus,
} from "@/lib/stackacres/barn";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import { StackAcresIcon } from "./stackacres-icon";

/** The farm canvas sits under every sheet and listens for pointers of its
 *  own, so a tap that lands on this panel must not also reach it. Same
 *  guard, for the same reason, as CrossbreedBedSheet's. */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

/**
 * The barn panel: every animal on the farm on one card each, by name, with
 * what it is doing and the one thing there is to do with it today.
 *
 * IT OWNS NO RULES. Every line here comes out of lib/stackacres/barn.ts
 * against the same unit snapshots the map is already drawing, so the panel
 * and the world can never disagree about an animal -- the same split the
 * Greenhouse panel keeps, where the component is a picture of state it does
 * not derive.
 *
 * Sorted by what wants dealing with first, not by when the animal was
 * bought: a barn with fourteen animals in it is a to-do list, and burying
 * the hungry one under nine content ones is the failure mode worth designing
 * against.
 */

const STATUS_ORDER: Readonly<Record<BarnStatus, number>> = {
  hungry: 0,
  producing: 1,
  "needs-attention": 2,
  content: 3,
};

export interface BarnAnimalCard {
  unitId: string;
  name: string;
  kindLabel: string;
  status: BarnStatus;
  moodLabel: string;
  streak: number;
  /** Extra produce already riding on this cycle from tending. */
  bonus: number;
  /** What tending right now would add. 0 on the first two days of a streak. */
  bonusIfTended: number;
  canTend: boolean;
  hungryAt: string | null;
  /** A hog or steer: how heavy it is, how heavy it can get, what it would
   *  sell for now, and whether it is ready to go to the sale barn. Null for
   *  everyone else. */
  market: { weight: number; maxWeight: number; gold: number; ready: boolean; food: string } | null;
}

/** Every animal on the farm, worst first. Crops and mucked plots are not
 *  animals and never appear. */
export function barnCardsFor(
  units: readonly StackAcresUnitSnapshot[],
  now: Date,
  today: string,
): BarnAnimalCard[] {
  return units
    // Livestock only, and only what is actually living there: a mucked plot
    // has nobody on it, and a crop is not somebody.
    .filter((unit) => isLivestock(unit.stock) && unit.state !== "mucked")
    .map((unit) => {
      const care = {
        caredOn: unit.caredOn ?? null,
        careStreak: unit.careStreak ?? 0,
        careBonus: unit.careBonus ?? 0,
      };
      const animal = { state: unit.state, hungryAt: unit.hungryAt, care };
      const tended = hasCaredToday(care, today);
      const streak = liveCareStreak(care, today);
      return {
        unitId: unit.id,
        name: animalNameFor(unit.id, unit.stock),
        kindLabel: STACKACRES_CATALOGUE[unit.stock].label,
        status: barnStatusFor(animal, now, today),
        moodLabel: MOOD_LABELS[animalMoodFor(animal, today)],
        streak,
        bonus: care.careBonus,
        // What TODAY's tend would be worth, which is the streak it would
        // land on -- not the streak showing now.
        bonusIfTended: careYieldBonus(tended ? streak : streak + 1),
        canTend: !tended && unit.state !== "mucked",
        hungryAt: unit.hungryAt,
        market: isMarketLivestock(unit.stock)
          ? (() => {
              const weight = marketWeightOf({ ...unit, stock: unit.stock });
              return {
                weight,
                maxWeight: maxMarketWeight(unit.stock),
                gold: marketAnimalPrice(unit.stock, weight),
                ready: unit.state === "ready",
                food: unit.stock === "hog" ? "corn" : "cattle feed",
              };
            })()
          : null,
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
}

/** "in 4m", "now". Deliberately coarse: a countdown to the second on a
 *  window measured in hours is noise, and it would re-render every tick. */
function whenHungry(hungryAt: string | null, now: Date): string {
  if (!hungryAt) return "";
  const ms = Date.parse(hungryAt) - now.getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${Math.max(1, minutes)}m`;
  return `in ${Math.round(minutes / 60)}h`;
}

export interface StackAcresBarnPanelProps {
  units: readonly StackAcresUnitSnapshot[];
  now: Date;
  today: string;
  /** True while a tend is in flight, so a card cannot be double-tapped. */
  busy: boolean;
  hasBarn: boolean;
  onTend: (unitId: string) => void;
  /** Closes the sheet and opens the herd bar to move animals around. Null when there is no herd out on the Homestead. */
  onMoveAnimals: (() => void) | null;
  onClose: () => void;
}

export function StackAcresBarnPanel({
  units,
  now,
  today,
  busy,
  hasBarn,
  onTend,
  onMoveAnimals,
  onClose,
}: StackAcresBarnPanelProps) {
  const close = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(close, !busy);
  const live = useMemo(() => barnCardsFor(units, now, today), [units, now, today]);

  /**
   * The order the list was in when it opened, frozen.
   *
   * `barnCardsFor` sorts worst-first, which is right for deciding what to
   * deal with -- but a card that re-sorts the instant it is tended jumps out
   * from under the finger that tended it, and the next tap lands on a
   * different animal. So the ORDER is decided once, when the panel opens,
   * and the CONTENT keeps updating in place: a tended card says "Tended"
   * where it stands, the same way a ticked item on a to-do list does not
   * leap to the bottom while you are still reading it.
   *
   * An animal that appears while the panel is open (a purchase from another
   * tab) is not in the frozen order and sorts to the end rather than being
   * dropped.
   */
  // Captured once at mount, which is exactly "when the panel opened" -- this
  // component is only mounted while the barn is on screen.
  const [frozenOrder] = useState(() =>
    barnCardsFor(units, now, today).map((card) => card.unitId),
  );
  const cards = useMemo(() => {
    const rank = (unitId: string) => {
      const index = frozenOrder.indexOf(unitId);
      return index === -1 ? frozenOrder.length : index;
    };
    return [...live].sort((a, b) => rank(a.unitId) - rank(b.unitId));
  }, [live, frozenOrder]);
  const waiting = cards.filter((card) => card.canTend).length;

  return (
    <div
      className="sa-sheet-scrim"
      role="presentation"
      onMouseDown={contain(onBackdropMouseDown)}
      onPointerDown={contain()}
      onPointerUp={contain()}
      onPointerMove={contain()}
      onTouchStart={contain()}
      onTouchMove={contain()}
      onClick={contain()}
      onWheel={contain()}
    >
      <section
        className="sa-sheet sa-barn"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-barn-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Heart size={13} aria-hidden="true" /> The barn
            </p>
            <h2 id="sa-barn-title">Who lives here</h2>
          </div>
          <div className="sa-sheet-head-keys">
            {onMoveAnimals && (
              <button type="button" className="sa-sheet-close" onClick={contain(onMoveAnimals)}>
                Move animals
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              className="sa-sheet-close"
              onClick={contain(close)}
            >
              Done
            </button>
          </div>
        </header>

        <p className="sa-sheet-note">
          {cards.length === 0
            ? "Nobody lives here yet. Buy a hen, a sheep, a cow or a pig and they will show up on this list."
            : waiting > 0
              ? `${waiting} of your ${cards.length} animals haven't had your time today.`
              : "Everyone has had your time today."}
        </p>

        {cards.length > 0 && (
          <ul className="sa-barn-list">
            {cards.map((card) => (
              <li key={card.unitId} className={`sa-barn-card is-${card.status}`}>
                <div className="sa-barn-who">
                  <strong>{card.name}</strong>
                  <span className="sa-barn-kind">{card.kindLabel}</span>
                </div>
                <div className="sa-barn-state">
                  <span className={`sa-barn-status is-${card.status}`}>
                    {card.market?.ready ? "Ready to sell" : BARN_STATUS_LABELS[card.status]}
                  </span>
                  <span className="sa-barn-mood">{card.moodLabel}</span>
                  {card.status !== "producing" && card.hungryAt && (
                    <span className="sa-barn-feed">
                      <StackAcresIcon name="ico-feed" size={12} /> {whenHungry(card.hungryAt, now)}
                    </span>
                  )}
                </div>
                <div className="sa-barn-care">
                  {card.streak > 0 && <span className="sa-barn-streak">{card.streak} day streak</span>}
                  {card.bonus > 0 && <span className="sa-barn-bonus">+{card.bonus} this batch</span>}
                  <button
                    type="button"
                    className="sa-barn-tend"
                    disabled={!card.canTend || busy}
                    onClick={contain(() => onTend(card.unitId))}
                  >
                    <Heart size={12} aria-hidden="true" />
                    {card.canTend
                      ? card.bonusIfTended > 0
                        ? `Tend (+${card.bonusIfTended})`
                        : "Tend"
                      : "Tended"}
                  </button>
                </div>
                {card.market && (
                  <p className="sa-barn-weight">
                    Weight {card.market.weight} of {card.market.maxWeight}.{" "}
                    {card.market.ready
                      ? `Hank will pay ${card.market.gold.toLocaleString()} Gold at the sale barn.`
                      : `Feed it ${card.market.food} to put on weight.`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="sa-sheet-note">
          {hasBarn
            ? "Your Barn keeps everyone comfortable, so they stay fed for longer."
            : "Build a Barn in the Workshop and they will stay fed for longer, with room for more."}
          {" Tending costs nothing. Come back every day and their produce improves, up to a point."}
        </p>
      </section>
    </div>
  );
}
