import { describe, expect, it } from "vitest";
import {
  CARD_ASPECT,
  CROWN_CLEARANCE_PX,
  HUD_RESERVE_PX,
  boardAnchor,
  boardAnchorOnFelt,
  boardCardWidth,
} from "./board-anchor";
import {
  FAR_CROWN,
  frameCamera,
  projectToNdc,
} from "./camera-framing";

/** Viewports this room is actually judged at. */
const PHONE_UPRIGHT = { w: 390, h: 844 };
const PHONE_SIDEWAYS = { w: 844, h: 390 };
const DESKTOP = { w: 1440, h: 900 };
const TABLET_UPRIGHT = { w: 820, h: 1180 };

/** Where the board's own box lands, in CSS px, for a returned anchor. */
function boardBox(w: number, h: number) {
  const anchor = boardAnchor(w, h);
  if (!anchor) throw new Error("no anchor");
  const cardH = boardCardWidth(w, h) * CARD_ASPECT;
  const centre = (anchor.top / 100) * h;
  return { top: centre - cardH / 2, bottom: centre + cardH / 2, centre };
}

/** Screen y (CSS px) of the far player's crown at this viewport. */
function crownY(w: number, h: number): number {
  const framing = frameCamera(w / h);
  const ndc = projectToNdc(FAR_CROWN, framing, w / h);
  return ((1 - ndc.y) / 2) * h;
}

describe("boardAnchor", () => {
  it("is horizontally centred at every viewport", () => {
    for (const { w, h } of [PHONE_UPRIGHT, PHONE_SIDEWAYS, DESKTOP, TABLET_UPRIGHT]) {
      expect(boardAnchor(w, h)!.left).toBeCloseTo(50, 3);
    }
  });

  it("returns null rather than NaN for a degenerate stage box", () => {
    expect(boardAnchor(0, 0)).toBeNull();
    expect(boardAnchor(390, 0)).toBeNull();
  });

  /*
   * The landscape contract. Anything at or past the framing's own
   * LANDSCAPE_ASPECT (1.5) must be EXACTLY the projected on-the-felt anchor
   * the board has always used — a phone on its side and every desktop. This
   * is the guarantee that the upright fix cannot regress the primary
   * orientation.
   */
  it("is exactly the on-felt projection sideways and on a desktop", () => {
    for (const { w, h } of [PHONE_SIDEWAYS, DESKTOP]) {
      expect(w / h).toBeGreaterThanOrEqual(1.5);
      expect(boardAnchor(w, h)!.top).toBeCloseTo(boardAnchorOnFelt(w, h)!.top, 10);
    }
  });

  /*
   * The upright contract, and the bug it exists for: on a 390x844 phone the
   * felt is a couple of hundred pixels tall, so a board anchored to it
   * blankets the cloth and covers the opponents' cards. Upright the board
   * belongs in the backdrop ABOVE the room instead.
   */
  it("lifts the board off the felt on an upright phone", () => {
    const { w, h } = PHONE_UPRIGHT;
    const lifted = boardAnchor(w, h)!.top;
    const onFelt = boardAnchorOnFelt(w, h)!.top;
    expect(lifted).toBeLessThan(onFelt);
    // Not a token nudge — it clears the table entirely.
    expect(boardBox(w, h).bottom).toBeLessThan((onFelt / 100) * h);
  });

  it("clears the pot readout and the message line", () => {
    for (const { w, h } of [PHONE_UPRIGHT, TABLET_UPRIGHT]) {
      expect(boardBox(w, h).top).toBeGreaterThanOrEqual(HUD_RESERVE_PX);
    }
  });

  /*
   * The floor is the far player's HEAD, not the far rail. A row that merely
   * clears the cloth still lands across their face, which is the mistake this
   * pins against.
   */
  it("stays above the far player's crown", () => {
    for (const { w, h } of [PHONE_UPRIGHT, TABLET_UPRIGHT]) {
      expect(boardBox(w, h).bottom).toBeLessThanOrEqual(
        crownY(w, h) - CROWN_CLEARANCE_PX + 0.001,
      );
    }
  });

  it("never rises above the HUD even as the viewport shortens", () => {
    // Sweep heights a phone can actually report, including the squat ones
    // where the backdrop band collapses and the clamp has to hold.
    for (let h = 320; h <= 1200; h += 20) {
      const box = boardBox(390, h);
      expect(box.top).toBeGreaterThanOrEqual(HUD_RESERVE_PX - 0.001);
    }
  });

  /*
   * Deliberately NOT a monotonicity assertion. The anchor wobbles by a few
   * tenths of a percent across a width sweep because `boardCardWidth` rounds
   * to whole pixels and half a card is part of the band arithmetic — which is
   * invisible on a resize and not worth contorting the solve to remove. What
   * has to hold at every shape is that the row is fully on the stage.
   */
  it("keeps the whole row on the stage at every shape", () => {
    for (let w = 320; w <= 1600; w += 20) {
      for (const h of [390, 640, 844, 1180]) {
        const box = boardBox(w, h);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe("boardCardWidth", () => {
  it("keeps a phone's cards readable and a desktop's from becoming a wall", () => {
    expect(boardCardWidth(PHONE_UPRIGHT.w, PHONE_UPRIGHT.h)).toBe(45);
    expect(boardCardWidth(DESKTOP.w, DESKTOP.h)).toBe(66);
  });

  it("is bounded at every viewport a phone can report", () => {
    for (let w = 320; w <= 1600; w += 40) {
      for (let h = 320; h <= 1200; h += 40) {
        const cw = boardCardWidth(w, h);
        expect(cw).toBeGreaterThanOrEqual(44);
        expect(cw).toBeLessThanOrEqual(66);
      }
    }
  });

  it("never lets five cards outgrow the stage", () => {
    for (let w = 320; w <= 1600; w += 20) {
      // .boardLayer's gap is 10% of a card width: 5 cards + 4 gaps.
      const row = boardCardWidth(w, 844) * (5 + 4 * 0.1);
      expect(row).toBeLessThanOrEqual(w);
    }
  });
});
