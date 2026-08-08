/**
 * Bundle the 3D room into one self-contained HTML page.
 *
 * The published artifact's CSP allows no external hosts — no CDN, no
 * stylesheet, no font, no fetch — so three.js, React, R3F and the scene all
 * have to arrive inline in a single file. esbuild does the bundling; this
 * script inlines the two outputs into the page shell and writes the result.
 *
 * Run: node scripts/build-game3d-artifact.mjs
 * Out: dist-artifact/game3d.html  (plus sim.js / sim.css, kept for diffing)
 *
 * This exists because the first version of that bundle was produced by an
 * ad-hoc command that nothing recorded, which left the next person unable to
 * rebuild it after a source change — the entire value of a build is that it
 * can be run again.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist-artifact");

/**
 * Pinned, and fetched by npx rather than added to package.json: this bundles
 * an experiment on an experimental branch, and the app itself has no need of
 * a second bundler in its dependency tree. The version is written down so the
 * build is still reproducible.
 */
const ESBUILD = "esbuild@0.28.1";

await mkdir(outDir, { recursive: true });

await run("npx", [
  "--yes", ESBUILD,
  join(root, "components/game3d/demo/artifact-entry.tsx"),
  "--bundle",
  "--minify",
  "--format=iife",
  "--target=es2020",
  "--jsx=automatic",
  // The seat artwork ships inside the page: the artifact's CSP allows no
  // fetches, so .webp imports become data URIs.
  "--loader:.webp=dataurl",
  // Next resolves "@/..." through tsconfig paths; esbuild is told directly.
  `--alias:@=${root}`,
  '--define:process.env.NODE_ENV="production"',
  `--outfile=${join(outDir, "sim.js")}`,
], { cwd: root, maxBuffer: 64 * 1024 * 1024 });

const [shell, css, js] = await Promise.all([
  readFile(join(root, "components/game3d/demo/artifact-shell.html"), "utf8"),
  readFile(join(outDir, "sim.css"), "utf8"),
  readFile(join(outDir, "sim.js"), "utf8"),
]);

// A closing tag inside the bundle would end the inline script early and
// silently truncate the page. Cheap to check, impossible to spot by eye.
if (/<\/script/i.test(js)) {
  throw new Error("bundle contains a closing script tag; inlining would break the page");
}

const html = shell
  .replace("/*MODULE_CSS*/", () => css)
  .replace("/*BUNDLE_JS*/", () => js);

const outFile = join(outDir, "game3d.html");
await writeFile(outFile, html, "utf8");

/*
 * game3d.html is publish-clean: the Artifact platform wraps it in a
 * <!doctype html> skeleton, so the file itself must not carry one. That
 * also means opening it from disk renders in QUIRKS MODE, where the layout
 * genuinely breaks (flex trays overlap, fixed/absolute chrome lands in the
 * wrong place) — which cost a long debugging detour once already. Preview
 * and headless-test THIS file instead; it is the published page's real
 * rendering conditions.
 */
const preview = `<!doctype html>\n<html>\n<head><meta charset="utf-8"></head>\n<body>\n${html}\n</body>\n</html>\n`;
const previewFile = join(outDir, "game3d-preview.html");
await writeFile(previewFile, preview, "utf8");

console.log(`\nwrote ${outFile} — ${(html.length / 1024).toFixed(0)} KB`);
console.log(`wrote ${previewFile} (doctype-wrapped local preview)`);
