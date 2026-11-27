// Builds StackDead's key art, share thumbnail, app icon and lobby tile from one drawing.
// Run: node scripts/stackstrike-brand.mjs  (writes public/stackstrike/)
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const OUT = "public/stackstrike";
const GOLD = "#ffd98a";
const RED = "#ff3b3b";
const GREEN = "#7dff6a";

/** The top-down scene: a crowd of zombies closing in on the player's red laser. 1600x900. */
function scene() {
  return `
  <defs>
    <radialGradient id="zGlow" gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="pool" gradientUnits="userSpaceOnUse" cx="420" cy="540" r="330">
      <stop offset="0" stop-color="#fff4d0" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="${GOLD}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.85"/>
    </radialGradient>
    <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M64 0H0V64" fill="none" stroke="#2b2e35" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1600" height="900" fill="#050506"/>
  <rect width="1600" height="900" fill="url(#grid)" opacity="0.7"/>
  <!-- walls -->
  <g fill="#3a3e47" stroke="#8a909c" stroke-width="3">
    <rect x="-20" y="-20" width="1640" height="70"/>
    <rect x="-20" y="850" width="1640" height="70"/>
    <rect x="1130" y="50" width="70" height="200"/>
    <rect x="560" y="420" width="260" height="60"/>
  </g>
  <!-- the player's pool of light -->
  <circle cx="420" cy="540" r="330" fill="url(#pool)"/>
  <!-- the crowd -->
  <circle cx="1030" cy="330" r="120" fill="url(#zGlow)"/>
  <circle cx="1240" cy="250" r="104" fill="url(#zGlow)"/>
  <circle cx="1300" cy="470" r="112" fill="url(#zGlow)"/>
  <circle cx="1130" cy="560" r="104" fill="url(#zGlow)"/>
  <circle cx="1420" cy="360" r="136" fill="url(#zGlow)"/>
  <circle cx="1190" cy="420" r="96" fill="url(#zGlow)"/>
  <circle cx="900" cy="170" r="96" fill="url(#zGlow)"/>
  <circle cx="1360" cy="640" r="104" fill="url(#zGlow)"/>
  <circle cx="980" cy="640" r="96" fill="url(#zGlow)"/>
  <circle cx="1030" cy="330" r="30" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="1030" cy="330" r="12" fill="${GREEN}" opacity="0.55"/>
  <circle cx="1240" cy="250" r="26" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="1240" cy="250" r="10" fill="${GREEN}" opacity="0.55"/>
  <circle cx="1300" cy="470" r="28" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="1300" cy="470" r="11" fill="${GREEN}" opacity="0.55"/>
  <circle cx="1130" cy="560" r="26" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="1130" cy="560" r="10" fill="${GREEN}" opacity="0.55"/>
  <circle cx="1420" cy="360" r="34" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="1420" cy="360" r="14" fill="${GREEN}" opacity="0.55"/>
  <circle cx="1190" cy="420" r="24" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="1190" cy="420" r="10" fill="${GREEN}" opacity="0.55"/>
  <circle cx="900" cy="170" r="24" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="900" cy="170" r="10" fill="${GREEN}" opacity="0.55"/>
  <circle cx="1360" cy="640" r="26" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="1360" cy="640" r="10" fill="${GREEN}" opacity="0.55"/>
  <circle cx="980" cy="640" r="24" fill="#1c2a1a" stroke="${GREEN}" stroke-width="4"/>
  <circle cx="980" cy="640" r="10" fill="${GREEN}" opacity="0.55"/>
  <!-- player and the laser they aim -->
  <line x1="420" y1="540" x2="1000" y2="342" stroke="${RED}" stroke-width="3" opacity="0.9"/>
  <line x1="420" y1="540" x2="1000" y2="342" stroke="${RED}" stroke-width="14" opacity="0.18"/>
  <circle cx="420" cy="540" r="26" fill="#e6edf3" stroke="#14161a" stroke-width="5"/>
  <line x1="420" y1="540" x2="452" y2="530" stroke="#14161a" stroke-width="9" stroke-linecap="round"/>
  <!-- crosshair on the nearest -->
  <g fill="none" stroke="${RED}" stroke-width="4" stroke-linecap="round">
    <circle cx="1030" cy="330" r="58"/>
    <path d="M1030 252v34M1030 374v34M952 330h34M1074 330h34"/>
  </g>
  <rect width="1600" height="900" fill="url(#vignette)"/>`;
}

function wordmark(x, y, size) {
  return `
  <g font-family="'Open Sans','Helvetica Neue',Arial,sans-serif" font-weight="800" text-anchor="middle">
    <text x="${x}" y="${y}" font-size="${size}" letter-spacing="${size * 0.06}" fill="#000" opacity="0.55" stroke="#000" stroke-width="${size * 0.05}" transform="translate(4 6)">STACKDEAD</text>
    <text x="${x}" y="${y}" font-size="${size}" letter-spacing="${size * 0.06}" fill="#f4f1ea" stroke="#0b0b0d" stroke-width="${size * 0.02}">STACK<tspan fill="${GREEN}">DEAD</tspan></text>
  </g>`;
}

const svg = (w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`;

/** The mark: a crosshair around a zombie. Square, for icons. */
function icon(size) {
  const c = size / 2;
  const r = size * 0.3;
  return svg(
    size,
    size,
    `<defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#17251a"/><stop offset="1" stop-color="#050506"/></radialGradient></defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
    <g fill="none" stroke="${RED}" stroke-width="${size * 0.035}" stroke-linecap="round">
      <circle cx="${c}" cy="${c}" r="${r}"/>
      <path d="M${c} ${size * 0.1}v${size * 0.16}M${c} ${size * 0.74}v${size * 0.16}M${size * 0.1} ${c}h${size * 0.16}M${size * 0.74} ${c}h${size * 0.16}"/>
    </g>
    <circle cx="${c}" cy="${c}" r="${size * 0.2}" fill="${GREEN}" opacity="0.18"/>
    <circle cx="${c}" cy="${c}" r="${size * 0.11}" fill="#1c2a1a" stroke="${GREEN}" stroke-width="${size * 0.025}"/>
    <circle cx="${c}" cy="${c}" r="${size * 0.045}" fill="${GREEN}" opacity="0.6"/>`,
  );
}

await mkdir(OUT, { recursive: true });

// The title screen's backdrop: the scene alone, so the page draws its own words over it.
await writeFile(`${OUT}/keyart.svg`, svg(1600, 900, scene()));

const keyart = svg(
  1600,
  900,
  `${scene()}
  <rect x="0" y="560" width="1600" height="340" fill="#000" opacity="0.0"/>
  ${wordmark(800, 745, 150)}
  <text x="800" y="805" text-anchor="middle" font-family="'Open Sans',Arial,sans-serif" font-weight="600" font-size="34" letter-spacing="10" fill="#9aa3af">HOLD THE LINE. SURVIVE THE WAVES.</text>`,
);
await sharp(Buffer.from(keyart)).resize(1200, 675).png().toFile(`${OUT}/keyart.png`);
await sharp(Buffer.from(keyart)).resize(1200, 630, { fit: "cover", position: "centre" }).png().toFile(`${OUT}/thumbnail.png`);
await sharp(Buffer.from(icon(512))).png().toFile(`${OUT}/icon-512.png`);
await sharp(Buffer.from(icon(512))).resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`);
// The lobby tile: the icon with rounded corners, since it is drawn as a plain background image.
const round = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="28" fill="#fff"/></svg>');
await sharp(Buffer.from(icon(512))).resize(128, 128).composite([{ input: round, blend: "dest-in" }]).png().toFile(`${OUT}/card.png`);
console.log("wrote", OUT);
