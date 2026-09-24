import type { FencePiece } from "@/lib/stackacres/fences";
import type { Ref } from "react";
import type { StackAcresUnitSnapshot } from "@/lib/stackacres/units";
import type { StackAcresTool } from "@/lib/stackacres/tools";
import type { SectorId } from "@/lib/stackacres/sectors";
import type { StackAcresCutter } from "@/lib/stackacres/cutters";
import type { HiddenZoneId } from "@/lib/stackacres/secrets";
import type { MapPlaceId } from "@/lib/stackacres/map-places";
import type { ZoneId } from "@/lib/stackacres/zones";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import type { TravelerId } from "@/lib/stackacres/story/travelers";
import type { FishSpecies } from "@/lib/stackacres/fishing";
import type { HuntingWeapon, QuarrySpecies } from "@/lib/stackacres/hunting";
import type { PainterName } from "./stackacres-art";
import type { WorldPoint } from "@/lib/stackacres/world";
import type { SoilTile } from "@/lib/stackacres/soil";
import type { WoodNodeSnapshot } from "@/lib/stackacres/wood";
import type { StoneNodeSnapshot } from "@/lib/stackacres/stone-nodes";
import type { ForageNodeSnapshot } from "@/lib/stackacres/forage";
import type { LandObstacleSnapshot } from "@/lib/stackacres/land-clearing";

/**
 * What the farm shell (stackacres-farm.tsx) hands the map under it, and what it
 * can ask of that map. The top-down world (../stackacres-td/topdown-world.tsx)
 * implements it; parts it doesn't draw yet are named no-ops there.
 */

export interface StackAcresSceneUnit {
  id: string;
  stock: StackAcresStock;
  state: "working" | "hungry" | "dry" | "ready" | "mucked";
  /** 0..1 while working, 1 once ready, null while mucked. */
  progress: number | null;
  /** True once bought outright with Gold -- drawn no differently, kept only
   *  because it is part of what makes a unit's own picture change (see
   *  `signatureOf`), the same way it was on the old cell. */
  permanent: boolean;
  /** The crop's fixed planting slot, the only thing that puts it on a tile at
   *  all (see `CropPlacement.slot`). Null for livestock, for a Greenhouse
   *  crop, and for a crop sown before soil tiers shipped -- any of which
   *  scatters off the lattice instead of standing on a bed. */
  soilSlot?: number | null;
  /** Set when this crop is standing in the built Greenhouse rather than out
   *  on the meadow's own soil. Always paired with a null `soilSlot` (see
   *  `assignSoilSlot`'s early return for it), which is what scatters it
   *  inside its own zone instead of landing on top of a real meadow crop. */
  housedIn?: "greenhouse" | null;
  /** Seed waiting for its first water; drawn as a sown heap. See
   *  `StackAcresUnitSnapshot.seed`. */
  seed: boolean;
}

/** Where a tap landed, in CSS pixels relative to the canvas host -- which is
 *  also the box every DOM overlay on this screen is positioned in, so the
 *  shell can drop a menu or a label straight onto these numbers. */
export interface TapPoint {
  x: number;
  y: number;
}

/**
 * A square the farmer is standing on with the belt's tool in hand
 * (lib/stackacres/toolbelt.ts). The map reports where he is; the shell asks the
 * belt what the held tool does there, so the map still knows nothing about what
 * anything costs or yields.
 */
export interface UseSquare {
  /** The Crop Fields bed under his feet, or null anywhere off the field. */
  tile: { tx: number; ty: number } | null;
  /** The crop on that bed, or the nearest animal he walked up to. */
  unitId: string | null;
  /** Where to float a line, in the same CSS-pixel box every overlay uses. */
  at: TapPoint;
  /** True while the Use key is held down and he is walking a row, false for a single press or a tap. */
  stroke: boolean;
}

/**
 * One fishing fight, as the shell asks for it.
 *
 * `species` picks the profile the gauge plays at -- how short the bar is and
 * how hard the fish darts -- and nothing else. It is NOT the catch: which
 * fish a landed cast gives is rolled server-side inside `catch-fish`, which
 * is why the copy fields exist and why the shell passes a species-free line
 * (see `rollGaugeDifficulty` in lib/stackacres/fishing-gauge.ts).
 */
export interface FishingGaugeRequest {
  readonly species: FishSpecies;
  /** Heading on the gauge panel. */
  readonly title?: string;
  /** Hint under the gauge once the fish is landed. */
  readonly landedHint?: string;
  readonly onLanded?: () => void;
  readonly onEscaped?: () => void;
  readonly onClosed?: () => void;
}

/**
 * One stalk, played on the open map, as the shell asks for it.
 *
 * `species` picks how hard the stalk plays -- how fast the animal moves and
 * how briefly it stands still -- and NOTHING else, the same way
 * `FishingGaugeRequest.species` does. It is not the prize: what a bagged
 * stalk yields is rolled server-side inside `bag-quarry`, which is why the
 * copy fields exist and why the shell passes a species-free line (see
 * `rollQuarryDifficulty` in lib/stackacres/hunt-proximity.ts).
 *
 * `weapon` is the real progression input: the bow until the farm reaches
 * Level 4, the rifle after (see `bestWeapon` in lib/stackacres/hunting.ts).
 */
export interface HuntScopeRequest {
  readonly species: QuarrySpecies;
  readonly weapon: HuntingWeapon;
  /** Hint under the alert gauge once the animal is taken. */
  readonly baggedHint?: string;
  readonly onBagged?: () => void;
  readonly onLost?: () => void;
  readonly onClosed?: () => void;
}

/** How a fight ended, as the map needs to act it out. */
export type FishingCastOutcome = "landed" | "escaped";

/** The fish a landed cast gave, as the server rolled it, and its name for "+1 Trout". */
export interface RevealedFish {
  readonly species: FishSpecies;
  readonly noun: string;
}


/** One flag per traveler: has their unlock been met yet. Read straight off
 *  `StackAcresStoryView.travelers[id].unlocked`, so the scene never keeps
 *  its own copy of the rule. */
export type TravelerUnlocks = Readonly<Record<TravelerId, boolean>>;

export type FarmerAction = "water" | "harvest" | "hoe" | "plant";

/** Who an emote bubble pops up over: the farmer, or a person on the map by their rig name. */
export type EmoteTarget = "farmer" | "ray" | "pilgrim" | TravelerId;
/** Stardew's emote set is the reference; each is a small icon bubble in the common atlas. */
export type EmoteKind = "heart" | "exclaim" | "question" | "note" | "sleep" | "sweat" | "sparkle";

export interface StackAcresWorldApi {
  zoomBy: (factor: number) => void;
  recenter: () => void;
  /** Travel to a district's gate (lib/stackacres/zones.ts). */
  focusZone: (zone: MapPlaceId) => void;
  /** Which map place the farmer is standing in right now. */
  currentPlace: () => MapPlaceId;
  /** The squash-and-stretch a tapped unit answers with, before the network
   *  has said anything at all. */
  popUnit: (unitId: string) => void;
  /** A ripe crop is picked: it comes out of the ground and hops into the
   *  farmer's hands. Called just before the collect goes out. */
  pullCrop: (unitId: string) => void;
  /** Critical Harvest Cascade: the same gold-burst `celebrate` triggers for a
   *  solo unit, fanned out across several units with a stagger between each
   *  so a chain reads as a chain. See stackacres-scene.ts's own method. */
  celebrateCascade: (unitIds: string[]) => void;
  /**
   * The extra beat a LUCKY harvest gets: the crit flash (micro shake, gold
   * wash, "CRIT! x2" springing up over the unit) and a burst of deep-gold
   * sparks at its base.
   *
   * Pushed from the shell rather than fired inside the scene alongside the
   * ordinary harvest burst, because only the settlement response knows whether
   * the roll actually hit -- the crit is rolled server-side inside the guarded
   * write (see lib/stackacres/equipment.ts's `rollHarvestCrit`), so there is
   * nothing local to predict it from.
   *
   * `multiplier` is the TOTAL payout multiple (`1 + critBonus`), not the bonus
   * alone -- see `critFlashLabel` in lib/stackacres/juice.ts.
   */
  celebrateCrit: (unitId: string, multiplier: number) => void;
  /** The farmer acts out a water, harvest, hoe or planting drop where he stands. */
  farmerAction: (action: FarmerAction, impact?: TapPoint) => void;
  /** A small emote bubble over someone's head for a moment: a heart when a gift lands, a note when a
   *  traveler's story moves on. Nothing happens when that person isn't on the map the player is looking at. */
  emote: (who: EmoteTarget, kind: EmoteKind) => void;
  /**
   * Puts the fishing gauge up over the map: the skill half of a cast (see
   * lib/stackacres/fishing-gauge.ts). The world owns it because the gauge is
   * a Phaser scene layered on the same game, and the world is what holds
   * that game.
   *
   * The shell decides what each outcome MEANS -- landing one is what sends
   * `catch-fish` -- so this only reports which way the fight went. Exactly
   * one of `onLanded`/`onEscaped` fires, always followed by `onClosed`, and
   * `onClosed` fires on its own if there is no map to fight on.
   */
  startFishingGauge: (request: FishingGaugeRequest) => void;
  /**
   * Starts a stalk on the open map: the skill half is proximity and
   * patience, not a minigame overlay (see lib/stackacres/hunt-proximity.ts).
   * The world owns it for the same reason it owns the fishing gauge -- the
   * floating alert gauge is a Phaser scene layered on the same game, and the
   * world is what holds that game and the farmer's live position.
   *
   * The shell decides what each outcome MEANS -- bagging one is what sends
   * `bag-quarry` -- so this only reports which way the stalk went. Exactly
   * one of `onBagged`/`onLost` fires, always followed by `onClosed`, and
   * `onClosed` fires on its own if there is no map to stalk on.
   */
  startHuntScope: (request: HuntScopeRequest) => void;
  /**
   * Hands the gauge's answer back to the map, so the farmer can act it out:
   * landed keeps him on a bent rod until `revealCatch`, escaped snaps the rod
   * back on a slack line and takes the input lock the cast put on off.
   *
   * The shell calls this from the same `onLanded`/`onEscaped` it already had
   * -- it has to be told, because the fight happens in a separate Phaser scene
   * that knows nothing about the farmer standing underneath it (see
   * fishing-gauge-scene.ts's own header on why it is its own scene).
   */
  endFishingCast: (outcome: FishingCastOutcome) => void;
  /**
   * After a landed fight, once `catch-fish` has answered and the gauge is
   * off the screen: the fish jumps out of the water into the farmer's hands
   * and he holds it up with "+1 Trout" over it. Null when there is no fish
   * after all (the request failed), and the line comes in empty. Either way
   * this is what gives him back after a landed fight.
   */
  revealCatch: (fish: RevealedFish | null) => void;
  /** A line of text that lifts off the tap and fades -- the reward, or the
   *  reason there wasn't one. */
  floatAt: (at: TapPoint, text: string, tone: "gain" | "deny", icon?: PainterName) => void;
  /** Shows or hides each traveler as their own unlock is met -- nobody
   *  stands on the farm before that. Same "push, never rebuild" contract as
   *  `setSoil`: called with the full eleven-entry record whenever the
   *  story view changes, a no-op where nothing flipped. */
  setTravelerUnlocks: (unlocked: TravelerUnlocks) => void;
  /** Placed soil beds (lib/stackacres/soil.ts), passed straight through to
   *  the scene's own methods of the same name -- see stackacres-scene.ts's
   *  "the seam the shop will arrive through" section for what each does.
   *  Exposed here for the same reason `popUnit`/`floatAt` are: the shell
   *  drives these off a server response landing, not off a prop the scene
   *  must always reflect. */
  soilTiles: () => SoilTile[];
  setSoil: (tiles: readonly SoilTile[]) => void;
  placeSoilAt: (x: number, y: number) => boolean;
  removeSoilAt: (x: number, y: number) => boolean;
  /** Outlines the tile a pending bed will actually land on, snapped through
   *  the same `soilTileAt` the placement uses. `null` clears it. Pushed from
   *  the shell because the shell owns the radial menu the preview belongs
   *  to -- the scene has no idea a ring is open. */
  previewSoilAt: (world: WorldPoint | null) => void;
  /** Replays a tap's own hit-test chain against a point that never actually
   *  reached the canvas -- see StackAcresScene's own `tapAt` for why the
   *  seed menu's dismissal scrim needs this. `clientX`/`clientY` are CSS
   *  pixels, the same space a `PointerEvent` carries. */
  tapAt: (clientX: number, clientY: number) => void;
  /** A world point as pixels inside the field, for pointing a drag tool at a
   *  fixed spot. Null until the scene has booted. */
  fieldPointFor: (x: number, y: number) => TapPoint | null;
  /**
   * Goes to sleep in the bed: a sleepy bubble, a fade to black, `whileDark`
   * (the shell moves the clock and asks the server), then the room fades back
   * up in morning light. Input waits for the whole of it. Resolves once the
   * view is back; with no map to fade, it just runs `whileDark`.
   */
  sleep: (whileDark: () => Promise<void> | void) => Promise<void>;
}

export interface StackAcresWorldProps {
  units: StackAcresUnitSnapshot[];
  /** The choppable trees, so a felled one shows as a stump until it regrows. */
  woodNodes: readonly WoodNodeSnapshot[];
  /** The Mine's boulders, so a mined-out one shows as rubble until it re-forms. */
  stoneNodes: readonly StoneNodeSnapshot[];
  /** The Homestead's forage bushes, so a picked one shows as a bare stub
   *  until its seed heads come back. */
  forageNodes: readonly ForageNodeSnapshot[];
  /** What is still standing on land being cleared, so a felled obstacle
   *  disappears and an emptied sector stops being overgrown. */
  landObstacles: readonly LandObstacleSnapshot[];
  /** Every fence piece the farm has put up, by Homestead map square (lib/stackacres/fences.ts). */
  fences: readonly FencePiece[];
  tool: StackAcresTool;
  /** Fired once, by nonce, to trigger the gold-burst effect on one unit --
   *  the client-side twin of a confirmed collect. */
  celebrate: { unitId: string; nonce: number } | null;
  onReady: () => void;
  /** What the belt is holding, so the Use key beside the thumb stick names the job it will do. */
  useKeyLabel: string;
  /**
   * The farmer is standing on a square with a belt tool in hand: either he
   * walked to a tapped one and arrived, or the Use key fired on the one under
   * his feet. This is how watering, sowing, hoeing and picking all reach the
   * shell now; it replaced the drag tokens and the seed ring.
   */
  onUseSquare: (square: UseSquare) => void;
  /** A finger landed on this district's fenced ground, on nothing in
   *  particular -- an offer to seed something there. `world` is the same
   *  point in world units, alongside the CSS-pixel `at` -- see
   *  StackAcresSceneCallbacks.onGroundTap's own doc for why both travel. */
  onGroundTap: (zone: ZoneId, at: TapPoint, world: WorldPoint) => void;
  /** A hold-tap relocation landed: the bed group touching `(tx, ty)` should
   *  move so that tile lands on `(toTx, toTy)`. See
   *  StackAcresSceneCallbacks.onSoilMoveCommitted's own doc. */
  onSoilMoveCommitted?: (tx: number, ty: number, toTx: number, toTy: number) => void;
  /** A finger landed on the barn -- Ray's Supply Store's own entryway. */
  onBarnTap: () => void;
  /** A finger landed on the signpost, the Town Board's entryway now that
   *  the places list is gone. */
  onSignpostTap: () => void;
  /** The workbench inside the workshop was tapped: the Workshop's recipes. */
  onWorkshopTap: () => void;
  /** A finger landed on the yard's well. Fills the watering can. */
  onWellTap: (at: TapPoint) => void;
  /**
   * A fish has taken the line: the shell's cue to open the gauge.
   *
   * NOT the tap on the dock. The map owns the whole cast -- walking out to the
   * water, the swing, the wait for a bite -- and only calls this once there is
   * something to fight, so a cast the player backs out of never reaches the
   * shell at all. `at` is where the bobber is sitting, which is where the
   * cast's own lines belong. `castPower` is the power bar the cast was thrown
   * on, 0 to 1: how far out it landed, which `catch-fish` rolls against.
   * See scene.ts's `beginCast`.
   */
  onDockTap: (at: TapPoint, castPower: number) => void;
  /** A finger landed on the treeline at the Ancestral Oak -- the entryway to
   *  a stalk, the way the dock is the entryway to a cast. The shell decides
   *  whether one is on offer and with which weapon; the map only reports the
   *  tap. */
  onThicketTap: (at: TapPoint) => void;
  /** A finger landed on one of the Homestead's own choppable trees (see
   *  lib/stackacres/tree-nodes.ts). The farmer is already swinging his axe at
   *  it, and the shell sends the swing; a stump still growing back never gets
   *  here, the map says so itself. */
  onTreeTap: (nodeId: string, at: TapPoint) => void;
  /** Whether he has the energy for a swing that costs it: the axe, and any
   *  swing on land being cleared. False once the shell has said why. Asked
   *  before the swing, so a tired farmer never swings at nothing. */
  maySwing: (at: TapPoint) => boolean;
  /** A finger landed on one of the Mine's three tagged boulders (see
   *  lib/stackacres/stone-nodes.ts). A pick swing, same split as `onTreeTap`. */
  onStoneTap: (nodeId: string, at: TapPoint) => void;
  /** A finger landed on one of the Homestead's four forage bushes (see
   *  lib/stackacres/forage.ts). The shell sends the pick straight off. */
  onForageTap: (nodeId: string, at: TapPoint) => void;
  /** A finger landed on something standing on land still being cleared (see
   *  lib/stackacres/land-clearing.ts). An axe or pick swing, same split as
   *  `onTreeTap`. */
  onLandTap: (obstacleId: string, at: TapPoint) => void;
  /** A finger landed on the Greenhouse's own footprint: the shell's cue to
   *  open its panel, which shows either the build screen or the slots. */
  onGreenhouseTap: () => void;
  /** A finger landed on the Pixel Pilgrim himself. Fires no bow and
   *  reaches no server by itself -- this is only the cue to open his
   *  dialogue; see stackacres-farm.tsx's `onWorldMonkTap`. */
  onMonkTap: (at: TapPoint) => void;
  /** A finger landed on Ray himself, not the barn behind him --
   *  see stackacres-farm.tsx's `onWorldRayTap`. */
  onRayTap: (at: TapPoint) => void;
  /** A finger landed on the player's house. Opens the house panel (the
   *  kitchen), never anything of Ray's -- see stackacres-farm.tsx's `onWorldHouseTap`. */
  onHouseTap: (at: TapPoint) => void;
  /** The farmer walked up to the bed in the farmhouse. The shell decides
   *  whether it is late enough to sleep. */
  onBedTap: (at: TapPoint) => void;
  /** The farm clock's game hour right now (lib/stackacres/clock.ts). The map
   *  reads it for its light, its critters and who is sleepy. */
  clockHour: () => number;
  /** The farm clock's game day number (lib/stackacres/clock.ts): the people on
   *  their rounds keep a slightly different day each day. */
  clockDay: () => number;
  /** A finger landed on one of the eleven story travelers (see
   *  lib/stackacres/story/placement.ts). `at` is the point over their head,
   *  where the dialogue bubble hangs; see stackacres-farm.tsx's
   *  `onWorldTravelerTap`. */
  onTravelerTap: (traveler: TravelerId, at: TapPoint) => void;
  /** A finger landed on one of the three hidden discovery spots (see
   *  lib/stackacres/secrets.ts's `HIDDEN_ZONES`). The scene has already fired
   *  its own local `secretDiscoveryPuff` by the time this callback runs. */
  onSecretZoneTap: (zoneId: HiddenZoneId, at: TapPoint) => void;
  /** Land the player may work (lib/stackacres/sectors.ts). Everything else
   *  is drawn as wild growth and has no farm on it to tap. */
  sectors: SectorId[];
  /** A finger landed anywhere on land that has not been cleared -- the offer
   *  to buy it, answered by the clearing modal in stackacres-farm.tsx. */
  onLockedSectorTap: (zone: ZoneId, at: TapPoint) => void;
  /** The camera moved, so anything the shell pinned to a screen position is
   *  now pointing at the wrong part of the world. */
  onViewMoved: () => void;
  /** The farmer went through a door or a gate and arrived somewhere: its name, for a tag on the HUD. */
  onPlaceEntered: (name: string) => void;
  /** The cutter in hand, which sets the mow swathe and how long it stays cut. */
  cutter: StackAcresCutter;
  /** The Synergy Tree's `automated_logistics` multiplier on the farmhand's
   *  walk speed -- `StackAcresView.synergy.farmhandSpeedMultiplier`, 1 with
   *  no active perk. */
  farmhandSpeedMultiplier: number;
  /** How much wider than the arrival window the camera frames a district --
   *  `HUD_VIEW_EXPANSION` while the signpost rail is collapsed into the
   *  compass quick-nav, 1 otherwise. */
  viewExpansion: number;
  /** Placed soil beds, ALREADY merged with the starter pair -- the shell owns
   *  that merge (see stackacres-farm.tsx's `applyResponse`), this component
   *  only ever pushes what it is handed straight into the scene, the same
   *  "push, never rebuild" contract `sectors` above already follows. */
  soilTiles: readonly SoilTile[];
  api: Ref<StackAcresWorldApi | null>;
}
