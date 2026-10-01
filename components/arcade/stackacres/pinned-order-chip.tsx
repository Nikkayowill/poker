"use client";

import { Pin } from "lucide-react";
import {
  contractItemIcon,
  contractItemLabel,
  type ContractItem,
  type StackAcresContractRow,
} from "@/lib/stackacres/contracts";
import { StackAcresIcon } from "./stackacres-icon";
import type { PainterName } from "./stackacres-art";

/**
 * The pinned town order, kept on the HUD so the player can see how far along
 * it is without opening the board. One chip, one line per requirement,
 * pressing it opens the board. Same tag as the Journal chip, so the row
 * stays one family of badges.
 */
export function StackAcresPinnedOrderChip({
  contract,
  heldOf,
  onOpen,
}: {
  contract: StackAcresContractRow;
  heldOf: (item: ContractItem) => number;
  onOpen: () => void;
}) {
  const ready = contract.requirements.every((line) => heldOf(line.item) >= line.quantity);
  const summary = contract.requirements
    .map((line) => `${heldOf(line.item).toLocaleString()} of ${contractItemLabel(line.item, line.quantity)}`)
    .join(", ");
  return (
    <button
      type="button"
      className={`sa-prestige-badge sa-pinned-order${ready ? " is-ready" : ""}`}
      onClick={onOpen}
      title={`${contract.title}: ${summary}. ${ready ? "Ready to deliver." : "Open the town board."}`}
      data-testid="sa-pinned-order"
    >
      <Pin size={13} aria-hidden="true" />
      {contract.requirements.map((line) => (
        <span className="sa-pinned-order-line" key={line.item}>
          <StackAcresIcon name={contractItemIcon(line.item) as PainterName} size={18} />
          <strong>
            {heldOf(line.item).toLocaleString()}/{line.quantity.toLocaleString()}
          </strong>
        </span>
      ))}
      <span className="sa-sr">Pinned order: {summary}</span>
    </button>
  );
}
