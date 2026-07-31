import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

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

  it("imports every stylesheet from globals.css, in order", () => {
    const globals = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const imported = [...globals.matchAll(/@import\s+"\.\/styles\/([^"]+)"/g)].map((match) => match[1]);

    // A new sheet that is never imported is invisible, and the numbering is
    // the cascade -- see the header comment in globals.css -- so the import
    // order has to match the filenames rather than merely contain them.
    expect(imported).toEqual([...sheets].sort());
  });
});
