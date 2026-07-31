import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { NEXT_HAND_DELAY_MS } from "@/lib/game/engine";

/**
 * Structural checks on the stylesheets, because nothing else looks at them.
 *
 * A script-driven edit to 08-seat.css once left an orphaned closing brace
 * behind. Every gate stayed green -- tsc does not read CSS, eslint does not
 * read CSS, and all 214 unit tests passed -- while the app rendered
 * completely unstyled and the dev server logged "Parsing CSS source code
 * failed" a hundred times. The only thing that caught it was looking at a
 * screenshot, which is not a thing CI does.
 *
 * These are deliberately crude. They are not a CSS parser; they are the
 * cheapest checks that would have failed on that mistake.
 */

const STYLES_DIR = join(process.cwd(), "app", "styles");
const sheets = readdirSync(STYLES_DIR).filter((file) => file.endsWith(".css"));

/** Braces inside comments and quoted strings are not structure. */
function stripNonStructural(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

describe("stylesheets", () => {
  it("finds the stylesheet directory", () => {
    expect(sheets.length).toBeGreaterThan(0);
  });

  it.each(sheets)("%s has balanced braces", (sheet) => {
    const css = stripNonStructural(readFileSync(join(STYLES_DIR, sheet), "utf8"));
    const open = (css.match(/\{/g) ?? []).length;
    const close = (css.match(/\}/g) ?? []).length;
    expect({ sheet, open, close }).toEqual({ sheet, open: close, close });
  });

  it.each(sheets)("%s never closes more blocks than it opened", (sheet) => {
    // Catches an orphan `}` in the middle of a file, which a plain count can
    // miss when a matching stray `{` appears later.
    const css = stripNonStructural(readFileSync(join(STYLES_DIR, sheet), "utf8"));
    let depth = 0;
    let wentNegative = false;
    for (const char of css) {
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth < 0) wentNegative = true;
      }
    }
    expect({ sheet, wentNegative }).toEqual({ sheet, wentNegative: false });
  });

  /**
   * The next hand is dealt on a timer now, so the celebration has a budget it
   * did not have when a player pressed a button to move on. Nothing else in
   * the toolchain reads both a TypeScript constant and a CSS keyframe: tsc
   * does not see the stylesheets, and the stylesheets cannot see
   * NEXT_HAND_DELAY_MS. Without this, lengthening a winner animation would
   * simply start getting cut off mid-flight on a live table, and the only
   * symptom would be that something looked slightly wrong.
   */
  describe("the winner celebration fits inside the wait before the next hand", () => {
    /** Everything that plays on a table where the hand has just been won. */
    const CELEBRATION = [
      "pot-drain",
      "chip-shuffle-to-winner",
      "winning-card-lift",
      "spent-card-fade",
      "hand-result-in",
      "winner-badge-enter",
      "winning-cards-glow",
      "stack-win-pulse",
      "win-amount-rise",
    ];

    /**
     * The widest stagger the chip funnel applies, from table-effects.tsx:
     * twelve chips at 34ms apart. It arrives as var(--chip-delay), which is
     * not a number a stylesheet reader can resolve, so it is stated here and
     * charged to every animation rather than quietly treated as zero.
     */
    const CHIP_STAGGER_MS = 11 * 34;

    const seconds = (value: string | undefined) =>
      value === undefined ? 0 : Math.round(Number.parseFloat(value) * 1000);

    /** Every `animation:` shorthand in the styles, by animation name. */
    function declaredAnimations(): Map<string, { endsAtMs: number; source: string }> {
      const found = new Map<string, { endsAtMs: number; source: string }>();
      sheets.forEach((sheet) => {
        const css = stripNonStructural(readFileSync(join(STYLES_DIR, sheet), "utf8"));
        for (const match of css.matchAll(/animation:\s*([^;}]+)[;}]/g)) {
          const shorthand = match[1].trim();
          const name = CELEBRATION.find((candidate) => shorthand.includes(candidate));
          if (!name) continue;
          // Two time values in a shorthand: duration first, delay second.
          const times = [...shorthand.matchAll(/(?<![\w-])(\d*\.?\d+)s(?![\w-])/g)].map((t) => t[0]);
          const duration = seconds(times[0]);
          const delay = shorthand.includes("var(--chip-delay)")
            ? CHIP_STAGGER_MS
            : seconds(times[1]);
          // A bare trailing integer is the iteration count.
          const iterations = Number.parseInt(shorthand.match(/\s(\d+)\s*$/)?.[1] ?? "1", 10);
          found.set(name, { endsAtMs: delay + duration * iterations, source: sheet });
        }
      });
      return found;
    }

    it("finds every celebration animation it means to check", () => {
      // Otherwise a renamed animation silently drops out of the budget and
      // this whole block passes by measuring nothing.
      expect([...declaredAnimations().keys()].sort()).toEqual([...CELEBRATION].sort());
    });

    it.each(CELEBRATION)("%s finishes before the next hand is dealt", (name) => {
      const declared = declaredAnimations().get(name);
      expect(declared).toBeDefined();
      expect({ name, endsAtMs: declared!.endsAtMs, within: true }).toEqual({
        name,
        endsAtMs: declared!.endsAtMs,
        within: declared!.endsAtMs <= NEXT_HAND_DELAY_MS,
      });
    });

    it("leaves a visible beat after the last one, rather than cutting it fine", () => {
      const latest = Math.max(...[...declaredAnimations().values()].map((a) => a.endsAtMs));
      expect(NEXT_HAND_DELAY_MS - latest).toBeGreaterThanOrEqual(300);
    });
  });

  it("imports every stylesheet from globals.css, in order", () => {
    const globals = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const imported = [...globals.matchAll(/@import\s+"\.\/styles\/([^"]+)"/g)].map((match) => match[1]);

    // A new sheet that is never imported is invisible, and the numbering is
    // the cascade -- see the header comment in globals.css -- so the import
    // order has to match the filenames rather than merely contain them.
    expect(imported).toEqual([...sheets].sort());
  });
});
