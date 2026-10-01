/**
 * Town Contracts: a premium door from a processed good back to Gold.
 *
 * ONE OPEN CONTRACT AT A TIME, deliberately. A board of several would let a
 * player bank up processed goods against whichever contract paid best,
 * which is a different game (arbitrage) from the one this is meant to be
 * (keep a machine fed, cash in what it makes). `homestead_contracts` mirrors
 * this in SQL with a partial unique index on `(profile_id) where status =
 * 'open'`, so the single-contract rule holds even against two racing tabs.
 *
 * NOT THE ONLY DOOR ANY MORE. `sellStackAcresItem` (lib/server/
 * stackacres-service.ts) can turn any inventory item, including Flour/
 * Cheese/Cloth, into Gold at any time, at that item's own (lower) sell
 * price -- see ./machine-items.ts's own header on why a contract still pays
 * a 1.3x premium over Sell for exactly these three goods. Neither door is
 * capped any more (see lib/stackacres/exchange.ts's header for when and why
 * the flat daily ceiling this comment used to describe was removed).
 *
 * Town Influence (./town.ts) rides the same fulfillment, uncapped -- it is
 * progression, not currency, and spends nowhere, so it carries none of the
 * ceiling's risk.
 *
 * A CONTRACT IS ONLY EVER DRAWN FROM WHAT THE PLAYER CAN ACTUALLY MAKE, which
 * is why `drawContract` takes that set rather than reading the rungs
 * directly. With one open contract at a time and no way to cancel one, a
 * contract for a good this farm has no machine for is not a missed
 * opportunity -- it is a dead end that blocks every future contract too. That
 * was already reachable before the Dairy and the Loom existed (a player who
 * never placed a Mill could still be handed a Flour contract); three
 * processed goods make it the common case rather than the odd one.
 *
 * MULTI-GOOD RUNGS (2026-09-14): `extraRequirements` lets a rung ask for a
 * second (or third) good alongside the primary `item`/`quantity` pair --
 * "4 Flour AND 1 Cheese," not a choice between them. Every rung from before
 * this date, and every single-good rung since, simply omits it. The "only
 * ever drawn from what the player can actually make" rule above now applies
 * to EVERY good a rung names, not just the primary one -- see
 * `contractRequirements`/`drawContract` below -- so a multi-good rung can
 * never become the same kind of dead end a single-good one was already
 * guarded against.
 *
 * AN EXTRA REQUIREMENT MAY NAME A RAW CROP, not only a processed good --
 * `ContractRequirement.item` is the wider `MachineItemId` for exactly this.
 * The PRIMARY requirement stays `MachineProcessedItem` deliberately: it is
 * what keeps this file's opening line true ("a door FROM A PROCESSED GOOD")
 * and what keeps a contract from ever being postable to a farm with no
 * machine at all -- see `drawContract`. A crop asked for as an EXTRA carries
 * no such gate: any farm can grow more of one it has already unlocked
 * (lib/stackacres/catalogue.ts's seed tiers), the same way collecting one
 * already lands in this same shared inventory a processed good does (see
 * ./items.ts's own header). `requirementProducible` below is the one place
 * that split is drawn.
 */

import {
  isMachineProcessedItem,
  type MachineItemId,
  type MachineProcessedItem,
} from "./machine-items";

/** One good and how much of it a contract wants. A processed good for the
 *  primary requirement always; a raw crop is only ever valid as one of
 *  `ContractDef.extraRequirements` -- see this file's header. */
export interface ContractRequirement {
  item: MachineItemId;
  quantity: number;
}

export interface ContractDef {
  /** The primary requirement. Every rung has one, whether or not it also
   *  carries `extraRequirements`. */
  item: MachineProcessedItem;
  quantity: number;
  goldReward: number;
  influenceReward: number;
  /** Goods required ALONGSIDE `item`/`quantity`, for a genuinely multi-good
   *  rung. Absent (not an empty array) for every single-good rung, the same
   *  "optional, present only when chosen" shape ./shop-locks.ts's
   *  StackAcresShopLock fields already use. */
  extraRequirements?: readonly ContractRequirement[];
}

/**
 * Every good `def` requires, primary first. The one place that shape is
 * assembled -- `canFulfillContract`, `drawContract` and the server's own
 * fulfillment step all read requirements through this rather than each
 * re-deriving "primary plus extras" by hand.
 */
export function contractRequirements(
  def: Pick<ContractDef, "item" | "quantity" | "extraRequirements">,
): readonly ContractRequirement[] {
  return [{ item: def.item, quantity: def.quantity }, ...(def.extraRequirements ?? [])];
}

/**
 * The rungs a contract is drawn from.
 *
 * FLOUR is priced off seed: a Mill turns 3 Wheat (45 Gold of seed, at
 * WHEAT_SEED_COST) into 1 Flour, so a contract asking for a handful of Flour
 * has to clear what growing and milling it actually cost -- the same "never
 * pay less than a tier's net" sanity check ./items.ts's `netPerCycle` runs
 * for stock.
 *
 * CHEESE AND CLOTH are priced off something stricter, because their raw
 * materials are not seed but FORGONE HARVEST GOLD. Milk and wool have a price
 * on the Gold track (./items.ts); sending them to a Dairy or a Loom means the
 * harvest never paid for them. So each rung below pays 1.3x
 * `recipeRawGoldValue` -- a flat 30% premium for the round trip, pinned by a
 * test in ./recipes.test.ts. Anything at or under 1.0x would make the machine
 * a sink the player built with their own Gold, which is the shape of bug this
 * file's header exists to stop repeating.
 *
 * The premium is uniform on purpose. A ladder where one good paid better per
 * unit of raw material would turn the single open contract into an arbitrage
 * puzzle -- reroll until Cheese comes up -- and there is no reroll, so it
 * would just be a bad draw the player is stuck with.
 */
export const CONTRACT_RUNGS: readonly ContractDef[] = [
  { item: "flour", quantity: 2, goldReward: 140, influenceReward: 10 },
  { item: "flour", quantity: 4, goldReward: 300, influenceReward: 25 },
  { item: "flour", quantity: 8, goldReward: 640, influenceReward: 60 },
  { item: "cheese", quantity: 2, goldReward: 1_720, influenceReward: 60 },
  { item: "cheese", quantity: 4, goldReward: 3_430, influenceReward: 130 },
  { item: "cloth", quantity: 3, goldReward: 1_190, influenceReward: 40 },
  { item: "cloth", quantity: 6, goldReward: 2_370, influenceReward: 90 },
  // One multi-good rung, added 2026-09-14. Priced the same way every other
  // rung is -- 1.3x combined recipeRawGoldValue across EVERY good it asks
  // for (3 Cheese at 660 raw + 2 Cloth at 304 raw = 2,588; 1.3x rounds to
  // 3,350), the exact rule recipes.test.ts's "contract pricing" suite checks
  // for a single-good rung, now generalized to sum every requirement rather
  // than only the primary one. Quantity 3 sits deliberately between the
  // existing Cheese rungs' 2 and 4 so gold/influence stay strictly
  // increasing within "cheese" (see that same test file): 1,720 < 3,350 <
  // 3,430, and 60 < 95 < 130. A documented first pass, same posture the
  // Prestige Reset Valve's own thresholds shipped under; not yet reviewed
  // against real play data.
  {
    item: "cheese",
    quantity: 3,
    extraRequirements: [{ item: "cloth", quantity: 2 }],
    goldReward: 3_350,
    influenceReward: 95,
  },
  // A second multi-good rung, this one with a raw crop as the extra rather
  // than a second processed good -- Spinach, same as the brief's own
  // example names. The primary stays Flour (a processed good, so this rung
  // still needs a Mill to ever be drawn -- see `requirementProducible`
  // above); the 20 Spinach on top costs about 40 Gold raw
  // (STACKACRES_ITEM_CATALOGUE.spinach.sellPrice), so quantity 3 Flour
  // (~3/4 of the existing 4-Flour rung's 300) plus a 1.3x-ish premium on
  // the Spinach lands at 280 -- strictly between the existing 2-Flour (140)
  // and 4-Flour (300) rungs, keeping "flour" gold/influence monotonic by
  // quantity the same way every other tier is. Flour rungs are exempt from
  // the strict raw-value ratio band (see recipes.test.ts -- flour is priced
  // off seed, not off `recipeRawGoldValue`), so this number is sized by the
  // same "reasonable relative to its neighbours" judgment the existing
  // Flour ladder already uses, not a fresh formula.
  {
    item: "flour",
    quantity: 3,
    extraRequirements: [{ item: "spinach", quantity: 20 }],
    goldReward: 280,
    influenceReward: 20,
  },
  // Closes the loop the two rungs above only approach: this one asks for
  // Spinach Loaf itself (lib/stackacres/recipes.ts), the recipe that grinds
  // Wheat AND Spinach together at the Mill in one batch -- growing both,
  // then milling them, is now a real prerequisite for this rung rather than
  // two independent quantities. Single-good in CONTRACT_RUNGS' own terms
  // (Spinach Loaf is the primary, nothing else required alongside it), but
  // what THAT one good costs to make already bakes in two crops. Priced the
  // ordinary way: raw value 108 (2 Wheat @ 44 + 10 Spinach @ 2, matching the
  // recipe's own inputs) x quantity 3 = 324, and 1.3x rounds to 420 -- the
  // same band every non-Flour rung clears, verified by recipes.test.ts.
  { item: "spinach_loaf", quantity: 3, goldReward: 420, influenceReward: 15 },
];

export interface StackAcresContractRow {
  id: string;
  item: MachineProcessedItem;
  quantity: number;
  goldReward: number;
  influenceReward: number;
  status: "open" | "fulfilled";
  createdAt: string;
  /** See `ContractDef.extraRequirements`. Always an array (never undefined)
   *  on a stored row, even when empty -- a row is a fact about what was
   *  actually posted, not a shelf definition that gets to leave a field
   *  implicit. */
  extraRequirements: readonly ContractRequirement[];
}

/** A source of numbers in [0, 1). Injected so a test can make it boring --
 *  the same seam ./world.ts's `Random` is. */
export type Random = () => number;

/**
 * Draws one rung at random from the goods this farm can actually make.
 *
 * Null when `producible` is empty or names nothing any rung asks for -- the
 * caller answers that as "place a machine first" rather than posting a
 * contract nobody can ever close. See the header.
 *
 * Pure -- the server calls this with `Math.random` and stamps the result onto
 * a row exactly once, the same "rolled once, never re-derived on read" rule
 * ./catalogue.ts's muck chance follows.
 */
/**
 * Whether one requirement's good is something this farm can actually get
 * more of. A processed good needs the machine that makes it, checked
 * against `producible` -- the whole reason this function (and `drawContract`
 * below) exists. A raw crop needs no such gate: it is never machine-made,
 * so "can this farm make more" is always yes for one, the same reasoning
 * this file's header states.
 */
function requirementProducible(
  requirement: ContractRequirement,
  producible: readonly MachineProcessedItem[],
): boolean {
  if (!isMachineProcessedItem(requirement.item)) return true;
  return producible.includes(requirement.item);
}

export function drawContract(
  producible: readonly MachineProcessedItem[],
  random: Random = Math.random,
): ContractDef | null {
  // Every processed good the rung names has to be producible, not just the
  // primary -- a multi-good rung with an unmakeable second processed
  // ingredient is exactly the dead end this file's header already refuses
  // for a single-good one. A raw-crop extra never blocks a draw this way.
  const eligible = CONTRACT_RUNGS.filter((rung) =>
    contractRequirements(rung).every((req) => requirementProducible(req, producible)),
  );
  if (eligible.length === 0) return null;
  return eligible[Math.floor(random() * eligible.length)];
}

/**
 * Whether every good a contract asks for is on hand right now.
 *
 * `held` is a lookup rather than a single count, since a multi-good rung
 * needs to ask "how much of THIS good" once per requirement -- the same
 * shape `inventoryQuantity` (lib/server/stackacres-service.ts) already is,
 * just partially applied to one profile's inventory by the caller.
 */
export function canFulfillContract(
  held: (item: MachineItemId) => number,
  contract: Pick<StackAcresContractRow, "item" | "quantity" | "status" | "extraRequirements">,
): boolean {
  if (contract.status !== "open") return false;
  return contractRequirements(contract).every((req) => held(req.item) >= req.quantity);
}

/**
 * How far along the board a rung is, as a 0..1 fraction, for a progress bar
 * to scale itself by.
 *
 * Clamped at both ends deliberately. A held count ABOVE the requirement is
 * still a full bar rather than an overflowing one -- surplus Flour is not
 * extra progress, it is just Flour -- and a `required` of zero reads as done
 * rather than dividing by nothing. Pure, so the bar and the button below it
 * cannot disagree about whether a rung is ready.
 */
export function contractProgress(held: number, required: number): number {
  if (required <= 0) return 1;
  return Math.min(1, Math.max(0, held / required));
}

/**
 * Whether `contract` is the board rung `def` -- what lets the town board draw
 * three rungs and mark the one actually posted.
 *
 * Matched on item AND quantity rather than on an id, because a rung in
 * CONTRACT_RUNGS has no id: the id is minted when the row is written, and the
 * board is drawn from the table. Two rungs asking for the same quantity of
 * the same item would be indistinguishable here, which is why the table has
 * none -- if one is ever added, give the rungs their own stable keys first.
 *
 * Extra requirements are compared too, in order -- the primary pair alone
 * cannot tell apart two rungs that happen to share it (there are none today,
 * but a future rung easily could).
 */
export function isPostedRung(contract: StackAcresContractRow | null, def: ContractDef): boolean {
  if (contract === null || contract.item !== def.item || contract.quantity !== def.quantity) return false;
  const extra = def.extraRequirements ?? [];
  if (contract.extraRequirements.length !== extra.length) return false;
  return contract.extraRequirements.every(
    (req, index) => req.item === extra[index].item && req.quantity === extra[index].quantity,
  );
}
