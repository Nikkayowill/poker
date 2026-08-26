// Generates the iOS "apple-touch-startup-image" splash screens referenced
// from app/layout.tsx's <head>.
//
// iOS has no equivalent of Android/Chrome's automatic manifest-driven splash
// (icon + background_color painted instantly on tap) -- without these,
// Safari just shows a blank screen for as long as the page takes to load and
// hydrate. Apple never added a general "give me any size" API either: each
// device/orientation/pixel-ratio combination needs its own exact-size PNG,
// matched via a <link media="..."> query.
//
// The size list below is CSS-pixel "buckets", not device names -- Apple has
// reused the same handful of logical viewport sizes across many generations
// (390x844 covers 12/12 Pro/13/13 Pro/14, for instance), so this list stays
// correct for hardware released after this script was written as long as
// Apple keeps recycling buckets, which it has for a decade. A brand-new
// bucket just falls back to today's blank screen -- no regression.
//
// Re-run this (`node scripts/generate-startup-images.mjs`) whenever
// public/brand/stackchips-logo.png changes, same idea as the ImageMagick
// icon-raster regen documented in app/manifest.ts.

import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SOURCE_LOGO = "public/brand/stackchips-logo.png";
const OUT_DIR = "public/splash";

// The same matte obsidian the manifest and html/body paint with
// (01-tokens.css / app/manifest.ts) -- a splash in a different colour than
// the page it hands off to would itself flash.
const BACKGROUND = "#0f1218";

// [cssWidth, cssHeight, devicePixelRatio] portrait buckets, oldest-supported
// to newest, deduped where two form factors share a bucket.
const PORTRAIT_BUCKETS = [
  [320, 568, 2], // iPhone SE (1st gen)
  [375, 667, 2], // iPhone SE 2nd/3rd gen, 6/7/8
  [414, 736, 3], // 6/7/8 Plus
  [375, 812, 3], // X/XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12/12 Pro, 13/13 Pro, 14
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 3], // 14 Pro Max, 15 Pro Max, 16 Plus
  [402, 874, 3], // 16 Pro
  [440, 956, 3], // 16 Pro Max
];

async function buildOne([cssW, cssH, ratio]) {
  const width = cssW * ratio;
  const height = cssH * ratio;
  const logoSide = Math.round(Math.min(width, height) * 0.34);

  const logo = await sharp(SOURCE_LOGO).resize(logoSide, logoSide).toBuffer();

  const fileName = `apple-splash-${width}x${height}.png`;
  await sharp({
    create: { width, height, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(`${OUT_DIR}/${fileName}`);

  return { cssW, cssH, ratio, fileName };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const built = [];
  for (const bucket of PORTRAIT_BUCKETS) {
    built.push(await buildOne(bucket));
  }

  // Emitted as a ready-to-paste block so app/layout.tsx and this generator
  // cannot silently drift apart -- paste the whole thing in on any re-run.
  console.log("\n--- paste into app/layout.tsx's <head> ---\n");
  for (const { cssW, cssH, ratio, fileName } of built) {
    console.log(
      `        <link rel="apple-touch-startup-image" href="/splash/${fileName}" media="(device-width: ${cssW}px) and (device-height: ${cssH}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)" />`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
