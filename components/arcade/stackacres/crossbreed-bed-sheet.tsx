"use client";

import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Coins, Dna, Sprout } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import {
  STACKACRES_CATALOGUE,
  isLivestock,
  type SeedStock,
  type StackAcresLivestock,
  type StackAcresStock,
} from "@/lib/stackacres/catalogue";
import {
  CROSSBREED_GRID_COLS,
  CROSSBREED_GRID_ROWS,
  CROSSBREED_MATRIX,
  crossbreedGridFromView,
  crossbreedableStock,
  evaluateMutationChance,
  isCrossbreedPlotReady,
  type CrossbreedBedView,
  type CrossbreedHarvestSettlement,
  type CrossbreedPlotView,
} from "@/lib/stackacres/crossbreeding";
import {
  CROSSBREED_ITEMS,
  CROSSBREED_ITEM_CATALOGUE,
  crossbreedItemLabel,
} from "@/lib/stackacres/crossbreed-items";

/**
 * The Crossbreeding Bed sheet: a fixed 4x4 of cells, each empty, growing or
 * ripe. Tap an empty cell to plant, a ripe one to bring it in.
 *
 * Mirrors SunlightForgeTable.tsx's own shape on purpose -- same sheet/scrim
 * chrome, same pointer-containment wrapper for the same reason that file
 * states in full: the StackAcres scene reads raw pointer events off its own
 * host element with Phaser input off entirely, so a press in this sheet has
 * to be stopped here or it also lands on the map underneath.
 *
 * NO OPTIMISTIC OVERLAY, unlike the Forge. A plant's only visible effect is
 * the cell itself filling in, and `act`'s own response repaints `bed` the
 * moment the server answers; guessing at it would mean inventing a plot id
 * this sheet would then have to reconcile away. A harvest is a dice roll
 * this app never fakes (see lib/stackacres/optimistic-actions.ts's header),
 * so it waits for the real answer too. The one local derivation is the
 * countdown, which ticks the readiness the server already decided forward
 * between polls -- a tap on a locally-ripe row the server still calls green
 * gets the server's own refusal, same as every other surface here.
 */

export type CrossbreedActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type CrossbreedHarvestActionResult =
  | { readonly ok: true; readonly settlement: CrossbreedHarvestSettlement | null }
  | { readonly ok: false; readonly message: string };

export interface CrossbreedBedSheetProps {
  /** Straight off the last server response. Authoritative. */
  bed: CrossbreedBedView;
  /** Ray's seed shelf -- what a crop cell is planted from. */
  seedStock: SeedStock;
  goldBalance: number;
  unlimitedGold: boolean;
  /** Crops need the Crop Fields open, the same gate an open-air sow has. */
  cropFieldsUnlocked: boolean;
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  onPlant: (row: number, col: number, stock: StackAcresStock) => Promise<CrossbreedActionResult>;
  onHarvest: (plotId: string) => Promise<CrossbreedHarvestActionResult>;
  onClose: () => void;
}

/** A message the sheet is showing about its own last action. Same posture
 *  SunlightForgeTable's `Note` takes: the page's error banner sits behind
 *  the scrim, so a refusal raised in here has to be answered in here. */
type Note = { readonly tone: "paid" | "refused"; readonly text: string };

/** Which sprite stands for a stock kind on the bed. A crop uses its own
 *  growth-stage frames; livestock reuse the pen art's sprite names. */
const LIVESTOCK_SPRITE: Record<StackAcresLivestock, string> = { hen: "hen", pig: "hog", cattle: "cow" };

function stockSpriteUrl(stock: StackAcresStock, stage: 0 | 1 | 2): string {
  return isLivestock(stock)
    ? `/stackacres/sprites/${LIVESTOCK_SPRITE[stock]}.png`
    : `/stackacres/sprites/${stock}${stage}.png`;
}

function countdownLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Wraps a handler so the press is consumed here rather than travelling on
 *  to the scene underneath. See this file's header for why that is not
 *  optional decoration. */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

export function CrossbreedBedSheet({
  bed,
  seedStock,
  goldBalance,
  unlimitedGold,
  cropFieldsUnlocked,
  busy,
  onPlant,
  onHarvest,
  onClose,
}: CrossbreedBedSheetProps) {
  const [picking, setPicking] = useState<{ row: number; col: number } | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll, !inFlight);

  // Tick only while something is still growing: a bed of ripe or empty
  // cells has no countdown to draw.
  const growing = bed.plots.some((plot) => !plot.ready && !isCrossbreedPlotReady(plot, nowMs));
  useEffect(() => {
    if (!growing) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [growing]);

  const grid = useMemo(() => crossbreedGridFromView(bed, nowMs), [bed, nowMs]);
  const plotAt = useMemo(() => {
    const byCell = new Map<string, CrossbreedPlotView>();
    for (const plot of bed.plots) byCell.set(`${plot.row}:${plot.col}`, plot);
    return byCell;
  }, [bed]);

  const working = busy || inFlight;

  // Only stock that can ever cross with something is offered: planting
  // anything else in a bed that pays nothing on a plain harvest is a pure
  // loss. Crops first, then animals.
  const plantable = useMemo(
    () => [...crossbreedableStock()].sort((a, b) => Number(isLivestock(a)) - Number(isLivestock(b))),
    [],
  );

  const canPlant = useCallback(
    (stock: StackAcresStock): boolean => {
      if (isLivestock(stock)) return unlimitedGold || goldBalance >= STACKACRES_CATALOGUE[stock].seedCost;
      return cropFieldsUnlocked && (seedStock[stock] ?? 0) > 0;
    },
    [unlimitedGold, goldBalance, cropFieldsUnlocked, seedStock],
  );

  const handlePlant = useCallback(
    async (stock: StackAcresStock): Promise<void> => {
      if (!picking || working) return;
      const def = STACKACRES_CATALOGUE[stock];
      if (!canPlant(stock)) {
        setNote({
          tone: "refused",
          text: isLivestock(stock)
            ? `${def.label} costs ${def.seedCost.toLocaleString()} Gold.`
            : `No ${def.label} seeds on the shelf. Buy some from Ray first.`,
        });
        return;
      }
      setNote(null);
      setInFlight(true);
      try {
        const result = await onPlant(picking.row, picking.col, stock);
        if (!result.ok) {
          setNote({ tone: "refused", text: result.message });
          return;
        }
        setNote({ tone: "paid", text: `${def.label} planted.` });
        setPicking(null);
      } catch {
        setNote({ tone: "refused", text: "That did not go through. Nothing was taken." });
      } finally {
        setInFlight(false);
      }
    },
    [picking, working, canPlant, onPlant],
  );

  const handleHarvest = useCallback(
    async (plot: CrossbreedPlotView): Promise<void> => {
      if (working) return;
      setNote(null);
      setInFlight(true);
      try {
        const result = await onHarvest(plot.id);
        if (!result.ok) {
          setNote({ tone: "refused", text: result.message });
          return;
        }
        const settled = result.settlement;
        if (settled?.hybridItem) {
          const held = crossbreedItemLabel(settled.hybridItem, settled.hybridQuantity ?? 0);
          setNote({
            tone: "paid",
            text: `CROSS! ${CROSSBREED_ITEM_CATALOGUE[settled.hybridItem].label} bred. You now hold ${held}.`,
          });
        } else {
          setNote({
            tone: "refused",
            text: `${STACKACRES_CATALOGUE[plot.stock].label} brought in. No cross this time.`,
          });
        }
      } catch {
        setNote({ tone: "refused", text: "That did not go through." });
      } finally {
        setInFlight(false);
      }
    },
    [working, onHarvest],
  );

  const hybridsHeld = CROSSBREED_ITEMS.filter((item) => (bed.inventory[item] ?? 0) > 0);
  const cells: { row: number; col: number }[] = [];
  for (let row = 0; row < CROSSBREED_GRID_ROWS; row += 1) {
    for (let col = 0; col < CROSSBREED_GRID_COLS; col += 1) cells.push({ row, col });
  }

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
        className="sa-sheet sa-xb"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-xb-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Dna size={13} aria-hidden="true" /> The Crossbreeding Bed
            </p>
            <h2 id="sa-xb-title">Cross two ripe rows</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="sa-sheet-close"
            onClick={contain(closeAll)}
          >
            Done
          </button>
        </header>

        <p className="sa-sheet-note">
          Plant two kinds that pair, side by side. Once both are ripe, bringing one in rolls for a
          cross: a hit clears both rows and breeds one hybrid. A row that does not cross yields
          nothing. This bed is for breeding, not for harvest.
        </p>

        {note && (
          <p
            className={clsx("sa-xb-note", `is-${note.tone}`)}
            role={note.tone === "refused" ? "alert" : "status"}
          >
            {note.text}
          </p>
        )}

        <div className="sa-xb-grid" role="group" aria-label="Crossbreeding Bed">
          {cells.map(({ row, col }) => {
            const key = `${row}:${col}`;
            const plot = plotAt.get(key);
            if (!plot) {
              const selected = picking?.row === row && picking?.col === col;
              return (
                <button
                  key={key}
                  type="button"
                  className={clsx("sa-xb-cell is-empty", { "is-picking": selected })}
                  disabled={working}
                  onClick={contain(() => setPicking(selected ? null : { row, col }))}
                  aria-label={`Empty cell, row ${row + 1} column ${col + 1}`}
                >
                  <Sprout size={16} aria-hidden="true" />
                  <span className="sa-xb-cell-label">{selected ? "Pick below" : "Plant"}</span>
                </button>
              );
            }
            // Read off `grid` rather than re-deriving: it already ran this
            // exact formula once for the whole bed, and a plot always has a
            // matching grid entry (crossbreedGridFromView maps 1:1).
            const ripe = grid.find((g) => g.id === plot.id)?.ready ?? false;
            const def = STACKACRES_CATALOGUE[plot.stock];
            const hint = ripe ? evaluateMutationChance(plot.id, grid) : null;
            const started = Date.parse(plot.startedAt);
            const readyAt = Date.parse(plot.readyAt);
            const progress = ripe
              ? 1
              : Math.max(0, Math.min(1, (nowMs - started) / Math.max(1, readyAt - started)));
            const stage: 0 | 1 | 2 = ripe ? 2 : progress < 0.5 ? 0 : 1;
            const label = ripe
              ? hint
                ? `${Math.round(hint.chance * 100)}% cross`
                : "Harvest"
              : countdownLabel(readyAt - nowMs);
            return (
              <button
                key={key}
                type="button"
                className={clsx("sa-xb-cell", { "is-ripe": ripe, "is-cross": hint !== null })}
                disabled={working || !ripe}
                onClick={contain(() => void handleHarvest(plot))}
                aria-label={ripe ? `Harvest ${def.label}` : `${def.label}, ripe in ${label}`}
              >
                <img
                  src={stockSpriteUrl(plot.stock, stage)}
                  alt=""
                  className="sa-xb-sprite"
                  draggable={false}
                />
                <span className="sa-xb-cell-label">{label}</span>
              </button>
            );
          })}
        </div>

        {picking && (
          <div className="sa-xb-picker" role="group" aria-label="Plant in the chosen cell">
            <p className="sa-xb-picker-title">
              Plant row {picking.row + 1}, column {picking.col + 1}
            </p>
            <ul className="sa-xb-stock">
              {plantable.map((stock) => {
                const def = STACKACRES_CATALOGUE[stock];
                const affordable = canPlant(stock);
                const cost = isLivestock(stock)
                  ? `${def.seedCost.toLocaleString()} Gold`
                  : `${(seedStock[stock] ?? 0).toLocaleString()} seeds`;
                return (
                  <li key={stock}>
                    <button
                      type="button"
                      className={clsx("sa-xb-stock-btn", { "is-short": !affordable })}
                      disabled={working || !affordable}
                      onClick={contain(() => void handlePlant(stock))}
                    >
                      <img
                        src={stockSpriteUrl(stock, 2)}
                        alt=""
                        className="sa-xb-sprite"
                        draggable={false}
                      />
                      <span className="sa-xb-stock-name">{def.label}</span>
                      <span className="sa-xb-stock-cost">
                        {isLivestock(stock) && <Coins size={11} aria-hidden="true" />}
                        {cost}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <h3 className="sa-xb-h">Pairings</h3>
        <ul className="sa-xb-pairs">
          {CROSSBREED_MATRIX.map((entry) => (
            <li key={`${entry.a}:${entry.b}`}>
              <span>
                {STACKACRES_CATALOGUE[entry.a].label} + {STACKACRES_CATALOGUE[entry.b].label}
              </span>
              <strong>
                {CROSSBREED_ITEM_CATALOGUE[entry.hybrid].label} {Math.round(entry.chance * 100)}%
              </strong>
            </li>
          ))}
        </ul>

        <h3 className="sa-xb-h">Hybrids bred</h3>
        {hybridsHeld.length === 0 ? (
          <p className="sa-sheet-note">Nothing yet.</p>
        ) : (
          <ul className="sa-xb-pairs">
            {hybridsHeld.map((item) => (
              <li key={item}>
                <span>{CROSSBREED_ITEM_CATALOGUE[item].label}</span>
                <strong>{(bed.inventory[item] ?? 0).toLocaleString()}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
