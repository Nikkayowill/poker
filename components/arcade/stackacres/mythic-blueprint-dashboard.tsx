"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type SyntheticEvent,
} from "react";
import clsx from "clsx";
import { Check, Flame, Hammer, Lock, Sparkles } from "lucide-react";
import { useModalDismiss } from "@/components/use-modal-dismiss";
import type { BlueprintId } from "@/lib/stackacres/blueprints";
import { inventoryQuantity, type StackAcresInventory } from "@/lib/stackacres/inventory";
import { MACHINE_ITEM_CATALOGUE, machineItemLabel, type MachineItemId } from "@/lib/stackacres/machine-items";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * Ray's Mythic Blueprints, the progress dashboard.
 *
 * DELIBERATELY TAKES ITS OWN CLIENT-LOCAL VIEW TYPES rather than importing
 * `BlueprintView` from lib/server/stackacres-blueprint-service.ts, the same
 * choice ./TownContractsModal.tsx already made for `Contract` against
 * `StackAcresContractRow`: that file carries `import "server-only"`, and
 * even though a `import type` of it would be erased at compile time and
 * cost nothing at runtime, keeping this component's props shaped by what
 * actually arrives over JSON (not by whichever server type happens to
 * describe it today) is what lets the two evolve independently. `BlueprintId`
 * is the one exception, imported from lib/stackacres/blueprints.ts -- a pure
 * lib/ module with no server dependency, same as `MachineItemId` below.
 *
 * MOVES NO GOLD. See lib/server/stackacres-blueprint-service.ts's own header
 * -- there is no reservation step here to mirror TownContractsModal's, and
 * no optimistic Gold or Influence line to roll back.
 *
 * OPTIMISTIC CONTRIBUTION VIA `useOptimistic`, React 19's own primitive,
 * rather than TownContractsModal's hand-rolled pending-array-plus-rollback.
 * The two solve the same problem -- show a delivery immediately, correct
 * from the server's answer either way -- and `useOptimistic` is a strict
 * simplification here because a blueprint contribution never needs
 * TownContractsModal's multi-line, splice-by-identity unwind: a single
 * requirement line is bumped, and the very next render (whether the request
 * lands or fails) replaces `blueprints` wholesale from the authoritative
 * prop, which is what makes an optimistic update automatically "roll back"
 * without any bookkeeping of its own.
 *
 * POINTER CONTAINMENT: every handler on the scrim and sheet is wrapped in
 * `contain`, the identical pattern TownContractsModal.tsx documents in full
 * -- this sheet renders over the StackAcres canvas, which reads raw pointer
 * events off its host element with Phaser input off entirely.
 */

export interface BlueprintRequirementView {
  readonly item: MachineItemId;
  readonly label: string;
  readonly required: number;
  readonly contributed: number;
}

/** `spritePhase` keys the construction-phase illustration below --
 *  `"spire-foundation" | "spire-framework" | "spire-crown"` for
 *  mythic-ember-spire today, plain string so a future structure's own phase
 *  names need no change here. */
export interface BlueprintStageCardView {
  readonly index: number;
  readonly label: string;
  readonly spritePhase: string;
  readonly requirements: readonly BlueprintRequirementView[];
  readonly satisfied: boolean;
}

export interface BlueprintCardView {
  readonly id: BlueprintId;
  readonly label: string;
  readonly status: "not_started" | "in_progress" | "completed";
  readonly currentStage: number;
  readonly totalStages: number;
  /** 0..1 across every stage, not just the current one -- see
   *  overallProgressFraction in lib/stackacres/blueprints.ts. */
  readonly overallProgress: number;
  /** null once completed -- there is no current requirement list left to
   *  show. */
  readonly stage: BlueprintStageCardView | null;
  readonly nextUnlock: string | null;
}

/** What a start or a contribute came back as. A refusal carries the
 *  server's own wording -- this dashboard never invents an explanation for
 *  something the server declined, the identical rule
 *  ContractActionResult states. */
export type BlueprintActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface MythicBlueprintDashboardProps {
  /** Every structure in the catalogue, present whether or not it has been
   *  started -- straight off StackAcresView.blueprints. */
  blueprints: readonly BlueprintCardView[];
  /** The shelf a delivery spends from. Authoritative; the optimistic
   *  overlay below is layered on top of it and never replaces it. */
  inventory: StackAcresInventory;
  /** Something else on the page is already talking to the server. */
  busy: boolean;
  /** Posts `start-blueprint`. Moves nothing. */
  onStart: (structureId: BlueprintId) => Promise<BlueprintActionResult>;
  /** Posts `contribute-blueprint`. */
  onContribute: (
    structureId: BlueprintId,
    itemId: MachineItemId,
    amount: number,
  ) => Promise<BlueprintActionResult>;
  onClose: () => void;
}

type Note = { readonly tone: "delivered" | "refused"; readonly text: string };

/** Wraps a handler so the press is consumed here rather than travelling on
 *  to the canvas underneath -- see this file's own header. */
function contain<E extends SyntheticEvent>(handler?: (event: E) => void) {
  return (event: E) => {
    event.stopPropagation();
    handler?.(event);
  };
}

type OptimisticDelivery = { readonly structureId: BlueprintId; readonly item: MachineItemId; readonly amount: number };

/** Bumps one requirement line's `contributed`, clamped at `required` the
 *  same way the server's own accept-amount clamp works -- an optimistic
 *  overlay that could read ABOVE what a real delivery could ever report
 *  would flash a wrong number for one frame before the server's answer
 *  corrected it. Recomputes `satisfied` from every line, not just the one
 *  touched, the identical "every line, not just one" rule
 *  isStageSatisfied in lib/stackacres/blueprints.ts enforces. Leaves
 *  `currentStage`/`totalStages`/`overallProgress` untouched -- advancing a
 *  stage is reported by the server's own answer, never guessed here. */
function withOptimisticDelivery(
  card: BlueprintCardView,
  item: MachineItemId,
  amount: number,
): BlueprintCardView {
  if (!card.stage) return card;
  const requirements = card.stage.requirements.map((requirement) =>
    requirement.item === item
      ? { ...requirement, contributed: Math.min(requirement.required, requirement.contributed + amount) }
      : requirement,
  );
  return {
    ...card,
    stage: {
      ...card.stage,
      requirements,
      satisfied: requirements.every((requirement) => requirement.contributed >= requirement.required),
    },
  };
}

/** The height of the ground line every phase draws against, and the layer
 *  order the construction illustration below builds up in -- higher phases
 *  draw every layer at or below their own index, which is what makes each
 *  milestone read as "on top of what was already there" rather than a
 *  replacement. */
const PHASE_ORDER = ["spire-foundation", "spire-framework", "spire-crown"] as const;

type SpirePhase = (typeof PHASE_ORDER)[number] | "empty" | "complete";

function phaseFor(card: BlueprintCardView): SpirePhase {
  if (card.status === "completed") return "complete";
  if (card.status === "not_started" || !card.stage) return "empty";
  const known = PHASE_ORDER.includes(card.stage.spritePhase as (typeof PHASE_ORDER)[number]);
  return known ? (card.stage.spritePhase as (typeof PHASE_ORDER)[number]) : "empty";
}

/**
 * Draws the Ember Spire's construction, layer by layer, straight onto a 2D
 * canvas context -- no sprite sheet, the same painter-function posture
 * ./stackacres-art.ts's own vector painters take (see lib/stackacres/
 * crop-visuals.ts's header on why crops are drawn rather than sprited).
 *
 * THIS IS THE ONE PLACE A CONSTRUCTION MILESTONE BECOMES A VISUAL CHANGE.
 * Layered strictly by PHASE_ORDER's index: foundation draws at every phase
 * from "spire-foundation" on, framework only from "spire-framework" on, the
 * crown cone only at "spire-crown" and beyond, and "complete" adds the
 * flourish (a lit crown and a small ember drift) on top of all three. An
 * "empty" phase (not started) draws nothing but the ground.
 */
function drawSpire(ctx: CanvasRenderingContext2D, width: number, height: number, phase: SpirePhase) {
  ctx.clearRect(0, 0, width, height);

  const groundY = height - 18;
  const centerX = width / 2;

  // Sky backdrop -- a flat dusk gradient, not tied to the app's own theme
  // tokens (this canvas is drawn pixels, not themed DOM), warm enough to
  // read as "ember" without competing with the gold accent everywhere else
  // in this app's chrome.
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, "#1c1330");
  sky.addColorStop(1, "#3a2140");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, groundY);

  // Ground.
  ctx.fillStyle = "#2c2418";
  ctx.fillRect(0, groundY, width, height - groundY);

  if (phase === "empty") return;

  const phaseIndex = phase === "complete" ? PHASE_ORDER.length - 1 : PHASE_ORDER.indexOf(phase);

  // Layer 0: the foundation -- a squat stone base with three coursing lines.
  const baseWidth = width * 0.46;
  const baseHeight = height * 0.16;
  const baseY = groundY - baseHeight;
  ctx.fillStyle = "#8a7a63";
  ctx.fillRect(centerX - baseWidth / 2, baseY, baseWidth, baseHeight);
  ctx.strokeStyle = "#5f5140";
  ctx.lineWidth = 1;
  for (let course = 1; course < 3; course += 1) {
    const y = baseY + (baseHeight / 3) * course;
    ctx.beginPath();
    ctx.moveTo(centerX - baseWidth / 2, y);
    ctx.lineTo(centerX + baseWidth / 2, y);
    ctx.stroke();
  }

  if (phaseIndex < 1) return;

  // Layer 1: the framework -- a rising timber scaffold, two uprights and
  // crossed braces, above the base.
  const frameTop = baseY - height * 0.34;
  const frameWidth = baseWidth * 0.72;
  ctx.strokeStyle = "#b98a4a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(centerX - frameWidth / 2, baseY);
  ctx.lineTo(centerX - frameWidth / 2, frameTop);
  ctx.moveTo(centerX + frameWidth / 2, baseY);
  ctx.lineTo(centerX + frameWidth / 2, frameTop);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(centerX - frameWidth / 2, baseY);
  ctx.lineTo(centerX + frameWidth / 2, frameTop);
  ctx.moveTo(centerX + frameWidth / 2, baseY);
  ctx.lineTo(centerX - frameWidth / 2, frameTop);
  ctx.stroke();

  if (phaseIndex < 2) return;

  // Layer 2: the crown -- a spire cone rising off the framework's top.
  const crownHeight = height * 0.3;
  const crownWidth = frameWidth * 0.6;
  ctx.fillStyle = "#c98f3a";
  ctx.beginPath();
  ctx.moveTo(centerX, frameTop - crownHeight);
  ctx.lineTo(centerX - crownWidth / 2, frameTop);
  ctx.lineTo(centerX + crownWidth / 2, frameTop);
  ctx.closePath();
  ctx.fill();

  if (phase !== "complete") return;

  // Flourish: a lit crown tip and a small drift of embers, only once the
  // whole structure is finished.
  const tipX = centerX;
  const tipY = frameTop - crownHeight;
  const glow = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 22);
  glow.addColorStop(0, "rgba(255, 196, 92, 0.95)");
  glow.addColorStop(1, "rgba(255, 196, 92, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 22, 0, Math.PI * 2);
  ctx.fill();

  const emberSeeds = [0.18, 0.42, 0.63, 0.81, 0.95];
  emberSeeds.forEach((seed, index) => {
    const x = tipX + (seed - 0.5) * crownWidth * 2.2;
    const y = tipY - 10 - seed * 30 - index * 4;
    ctx.fillStyle = index % 2 === 0 ? "#ffb35c" : "#ff8a3d";
    ctx.beginPath();
    ctx.arc(x, y, 2 + (index % 3), 0, Math.PI * 2);
    ctx.fill();
  });
}

function BlueprintConstructionCanvas({ card }: { card: BlueprintCardView }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phase = phaseFor(card);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    drawSpire(ctx, canvas.width, canvas.height, phase);
  }, [phase]);

  return (
    <canvas
      ref={canvasRef}
      width={220}
      height={180}
      className="sa-blueprint-canvas"
      role="img"
      aria-label={
        phase === "empty"
          ? `${card.label}: not yet begun`
          : phase === "complete"
            ? `${card.label}: construction finished`
            : `${card.label}: under construction, ${card.stage?.label ?? ""} under way`
      }
    />
  );
}

export function MythicBlueprintDashboard({
  blueprints,
  inventory,
  busy,
  onStart,
  onContribute,
  onClose,
}: MythicBlueprintDashboardProps) {
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState<Note | null>(null);
  const [starting, setStarting] = useState<BlueprintId | null>(null);

  const [optimisticBlueprints, addOptimisticDelivery] = useOptimistic(
    blueprints,
    (state: readonly BlueprintCardView[], delivery: OptimisticDelivery) =>
      state.map((card) =>
        card.id === delivery.structureId
          ? withOptimisticDelivery(card, delivery.item, delivery.amount)
          : card,
      ),
  );

  const closeAll = useCallback(() => onClose(), [onClose]);
  const { closeButtonRef, onBackdropMouseDown } = useModalDismiss(closeAll, !isPending && starting === null);

  const working = busy || isPending || starting !== null;

  const handleStart = useCallback(
    (structureId: BlueprintId) => {
      if (working) return;
      setNote(null);
      setStarting(structureId);
      void onStart(structureId)
        .then((result) => {
          if (!result.ok) setNote({ tone: "refused", text: result.message });
        })
        .catch(() => setNote({ tone: "refused", text: "That did not go through. Try again in a moment." }))
        .finally(() => setStarting(null));
    },
    [working, onStart],
  );

  const handleDeliver = useCallback(
    (card: BlueprintCardView, requirement: BlueprintRequirementView) => {
      if (working) return;
      const remaining = requirement.required - requirement.contributed;
      const held = inventoryQuantity(inventory, requirement.item);
      const amount = Math.min(remaining, held);
      if (amount <= 0) return;

      setNote(null);
      startTransition(async () => {
        addOptimisticDelivery({ structureId: card.id, item: requirement.item, amount });
        try {
          const result = await onContribute(card.id, requirement.item, amount);
          if (!result.ok) {
            setNote({ tone: "refused", text: result.message });
            return;
          }
          setNote({ tone: "delivered", text: `Delivered ${machineItemLabel(requirement.item, amount)}.` });
        } catch {
          setNote({ tone: "refused", text: "That delivery did not go through. Nothing was taken." });
        }
      });
    },
    [working, inventory, onContribute, addOptimisticDelivery],
  );

  const cards = useMemo(() => optimisticBlueprints, [optimisticBlueprints]);

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
        className="sa-sheet sa-blueprints"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-blueprints-title"
        onPointerDown={contain()}
        onPointerUp={contain()}
        onClick={contain()}
      >
        <header className="sa-sheet-head">
          <div>
            <p className="sa-clear-kicker">
              <Hammer size={13} aria-hidden="true" /> Ray&rsquo;s Mythic Blueprints
            </p>
            <h2 id="sa-blueprints-title">Mythic construction</h2>
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
          A mythic structure rises in stages -- deliver what one stage still needs, in whatever
          sittings suit you, and the next stage reveals itself once every line is met. No Gold
          moves either way.
        </p>

        {note && (
          <p
            className={clsx("sa-contracts-note", `is-${note.tone === "delivered" ? "paid" : "refused"}`)}
            role={note.tone === "refused" ? "alert" : "status"}
          >
            {note.text}
          </p>
        )}

        <ul className="sa-blueprint-list">
          {cards.map((card) => (
            <li key={card.id} className={clsx("sa-blueprint-card", `is-${card.status}`)}>
              <BlueprintConstructionCanvas card={card} />

              <div className="sa-blueprint-body">
                <div className="sa-blueprint-head">
                  <h3>{card.label}</h3>
                  <span className="sa-contract-tag">
                    {card.status === "completed" ? (
                      <>
                        <Check size={11} aria-hidden="true" /> Finished
                      </>
                    ) : card.status === "in_progress" ? (
                      `Stage ${card.currentStage + 1} of ${card.totalStages}`
                    ) : (
                      <>
                        <Lock size={11} aria-hidden="true" /> Not started
                      </>
                    )}
                  </span>
                </div>

                <span className="sa-contract-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${card.overallProgress})` }} />
                </span>
                <span className="sa-sr">
                  {Math.round(card.overallProgress * 100)}% built overall
                </span>

                {card.status === "not_started" && (
                  <button
                    type="button"
                    className="sa-cta"
                    disabled={working}
                    onClick={contain(() => handleStart(card.id))}
                  >
                    <Hammer size={16} aria-hidden="true" /> Begin construction
                  </button>
                )}

                {card.status === "in_progress" && card.stage && (
                  <>
                    <p className="sa-blueprint-stage-label">{card.stage.label}</p>
                    {card.stage.requirements.map((requirement) => {
                      const met = requirement.contributed >= requirement.required;
                      const held = inventoryQuantity(inventory, requirement.item);
                      const canDeliver = !met && held > 0;
                      const filled =
                        requirement.required <= 0
                          ? 1
                          : Math.min(1, requirement.contributed / requirement.required);
                      return (
                        <div className="sa-contract-req" key={requirement.item}>
                          <StackAcresIcon
                            name={MACHINE_ITEM_CATALOGUE[requirement.item].icon as PainterName}
                            size={22}
                          />
                          <span className="sa-contract-bar" aria-hidden="true">
                            <span style={{ transform: `scaleX(${filled})` }} />
                          </span>
                          <span className="sa-contract-count">
                            <strong>{requirement.contributed.toLocaleString()}</strong>
                            {" / "}
                            {requirement.required.toLocaleString()}
                          </span>
                          <span className="sa-sr">
                            {requirement.label} needed, {requirement.contributed.toLocaleString()} delivered,{" "}
                            {held.toLocaleString()} on the shelf
                          </span>
                          <button
                            type="button"
                            className="sa-cta sa-cta-small"
                            disabled={working || !canDeliver}
                            onClick={contain(() => handleDeliver(card, requirement))}
                          >
                            {met ? "Delivered" : held > 0 ? "Deliver" : "None on hand"}
                          </button>
                        </div>
                      );
                    })}
                    {card.nextUnlock && (
                      <p className="sa-blueprint-unlock">
                        <Sparkles size={13} aria-hidden="true" /> Finishing this reveals{" "}
                        <strong>{card.nextUnlock}</strong>
                      </p>
                    )}
                  </>
                )}

                {card.status === "completed" && (
                  <p className="sa-blueprint-unlock">
                    <Flame size={13} aria-hidden="true" /> Every stage delivered.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
