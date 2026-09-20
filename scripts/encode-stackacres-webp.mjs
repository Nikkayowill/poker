/**
 * Re-encodes StackAcres' PNG plates as WebP, in place. `pnpm assets:webp`.
 *
 * The prep scripts still emit PNG (that is what Pillow and the packs speak);
 * run this after one of them. It deletes the PNG it replaced, since the
 * plates under public/ are build output and the real source is the external
 * packs. Re-running is a no-op, so it cannot double-encode.
 *
 * Lossless is the default and lossy has to earn the swap. "Whichever is
 * smaller" was the obvious rule and it was wrong: it sent 93 of 181 plates
 * lossy, 85 of them saving under 20KB each, so most of the roster was
 * degraded for about 150KB total. Small props suffer worst (the mushroom is
 * 49 opaque pixels, nearly all edge: mean error 10/255, against 2.3/255 on
 * the barn). The 20KB floor keeps the 7 plates worth it and leaves 174
 * pixel-exact. Pixel art and atlases never go lossy at all -- see their
 * lists below.
 */

import sharp from "sharp";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** The two directories that hold the farm's plates. */
const ROOTS = ["public/stackacres/sprites", "public/stackacres/tiles"];

/**
 * True pixel art: hard edges a lossy encoder would blur, and small enough
 * that lossless wins on size anyway. Listed explicitly because a filename
 * heuristic would eventually guess wrong and quietly blur a new sprite.
 * `traveler-ray.png` is deliberately absent -- Ray's spirit is the one smooth
 * render among the travelers.
 */
const PIXEL_ART = new Set([
  "traveler-pierre.png",
  "traveler-miles.png",
  "traveler-skye.png",
  "traveler-barnaby.png",
  "traveler-arthur.png",
  "traveler-brayden.png",
  "traveler-ivy.png",
  "traveler-wes.png",
  "traveler-bea.png",
  "traveler-leo.png",
]);

/**
 * Packed sheets. A lossy encoder does not know where one cell ends and the
 * next begins, so it bleeds colour across those boundaries -- invisible in
 * the sheet, a seam on every tile once the scene samples one cell out of it.
 */
const ATLASES = new Set(["terrain-atlas.png", "farmhand-ranger.png"]);

/** What a lossy swap has to save before it is worth any quality cost. */
const MIN_LOSSY_SAVING = 20 * 1024;

const LOSSY = { quality: 90, alphaQuality: 100, effort: 6 };
const LOSSLESS = { lossless: true, effort: 6 };

/**
 * Mean per-channel error, counting only solidly opaque pixels. Under a
 * transparent pixel the colour channels hold whatever the cut-out left behind
 * and no encoder preserves it, so including them measures noise -- it reports
 * deltas near 255 on plates that are visually untouched.
 */
async function visibleError(pngBuffer, webpBuffer) {
  const before = await sharp(pngBuffer).ensureAlpha().raw().toBuffer();
  const after = await sharp(webpBuffer).ensureAlpha().raw().toBuffer();
  let channels = 0;
  let total = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i + 3] < 200 || after[i + 3] < 200) continue;
    for (let c = 0; c < 3; c += 1) {
      total += Math.abs(before[i + c] - after[i + c]);
      channels += 1;
    }
  }
  return channels === 0 ? 0 : total / channels;
}

async function encode(file) {
  const base = path.basename(file);
  const source = (await stat(file)).size;
  const input = sharp(file);

  const lossless = await input.clone().webp(LOSSLESS).toBuffer();
  let chosen = lossless;
  let mode = "lossless";
  let error = 0;

  if (!PIXEL_ART.has(base) && !ATLASES.has(base)) {
    const lossy = await input.clone().webp(LOSSY).toBuffer();
    if (lossless.length - lossy.length >= MIN_LOSSY_SAVING) {
      chosen = lossy;
      mode = "lossy";
      error = await visibleError(await input.clone().toBuffer(), lossy);
    }
  }

  // Nothing on this roster grows as WebP today, but a tiny flat icon could,
  // and swapping a file for a bigger one is not a saving.
  if (chosen.length >= source) {
    return { base, kept: true, source, out: source };
  }

  await writeFile(file.replace(/\.png$/, ".webp"), chosen);
  await unlink(file);
  return { base, mode, source, out: chosen.length, error };
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

let totalSource = 0;
let totalOut = 0;
let converted = 0;
let kept = 0;

for (const root of ROOTS) {
  const pngs = (await readdir(root)).filter((f) => f.endsWith(".png")).sort();
  for (const name of pngs) {
    const result = await encode(path.join(root, name));
    totalSource += result.source;
    totalOut += result.out;
    if (result.kept) {
      kept += 1;
      console.log(`  kept PNG  ${result.base} (WebP was not smaller)`);
    } else {
      converted += 1;
      const cost = result.mode === "lossy" ? `  mean visible error ${result.error.toFixed(2)}/255` : "";
      console.log(`  ${result.mode.padEnd(8)} ${result.base.padEnd(28)} ${kb(result.source)} -> ${kb(result.out)}${cost}`);
    }
  }
}

if (converted === 0 && kept === 0) {
  console.log("No PNG left under public/stackacres -- already encoded.");
} else {
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
  const saved = totalSource === 0 ? 0 : 100 - (totalOut / totalSource) * 100;
  console.log(`\n${converted} converted, ${kept} left as PNG`);
  console.log(`${mb(totalSource)} -> ${mb(totalOut)} (${saved.toFixed(1)}% smaller)`);
}
