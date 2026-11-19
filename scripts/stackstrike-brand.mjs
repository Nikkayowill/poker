// Builds StackStrike's key art, share thumbnail and app icon from one drawing.
// Run: node scripts/stackstrike-brand.mjs  (writes public/stackstrike/)
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const OUT = "public/stackstrike";
const GOLD = "#ffd98a";
const RED = "#ff3b3b";

/** The top-down scene: a guard's flashlight, a red laser, the gold case. 1600x900. */
function scene() {
  return `
  <defs>
    <radialGradient id="beam" gradientUnits="userSpaceOnUse" cx="1030" cy="330" r="620">
      <stop offset="0" stop-color="#fff4d0" stop-opacity="0.95"/>
      <stop offset="0.45" stop-color="#ffd98a" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#ffd98a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="goldGlow" gradientUnits="userSpaceOnUse" cx="1390" cy="450" r="190">
      <stop offset="0" stop-color="${GOLD}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="redGlow" gradientUnits="userSpaceOnUse" cx="1030" cy="330" r="120">
      <stop offset="0" stop-color="${RED}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${RED}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.85"/>
    </radialGradient>
    <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M64 0H0V64" fill="none" stroke="#2b2e35" stroke-width="1"/>
    </pattern>
    <clipPath id="beamClip"><polygon points="1030,330 330,60 140,640"/></clipPath>
  </defs>
  <rect width="1600" height="900" fill="#050506"/>
  <rect width="1600" height="900" fill="url(#grid)" opacity="0.7"/>
  <!-- walls -->
  <g fill="#3a3e47" stroke="#8a909c" stroke-width="3">
    <rect x="-20" y="-20" width="1640" height="70"/>
    <rect x="-20" y="850" width="1640" height="70"/>
    <rect x="1130" y="50" width="70" height="330"/>
    <rect x="1130" y="520" width="70" height="330"/>
    <rect x="560" y="420" width="260" height="60"/>
  </g>
  <!-- flashlight beam, cut short by the wall it hits -->
  <polygon points="1030,330 330,40 100,640" fill="url(#beam)" opacity="0.9"/>
  <!-- the case -->
  <circle cx="1390" cy="450" r="190" fill="url(#goldGlow)"/>
  <path d="M1372 430v-12a8 8 0 0 1 8-8h20a8 8 0 0 1 8 8v12" fill="none" stroke="${GOLD}" stroke-width="5"/>
  <rect x="1350" y="428" width="80" height="54" rx="7" fill="#7a5a1c" stroke="${GOLD}" stroke-width="4"/>
  <rect x="1350" y="448" width="80" height="6" fill="${GOLD}" opacity="0.8"/>
  <rect x="1384" y="442" width="12" height="18" rx="2" fill="${GOLD}"/>
  <!-- guard -->
  <circle cx="1030" cy="330" r="120" fill="url(#redGlow)"/>
  <circle cx="1030" cy="330" r="30" fill="#14161a" stroke="${RED}" stroke-width="5"/>
  <circle cx="1030" cy="330" r="12" fill="${RED}" opacity="0.9"/>
  <rect x="1000" y="322" width="-40" height="16" fill="none"/>
  <!-- player and the laser they aim -->
  <line x1="420" y1="540" x2="1000" y2="342" stroke="${RED}" stroke-width="3" opacity="0.9"/>
  <line x1="420" y1="540" x2="1000" y2="342" stroke="${RED}" stroke-width="14" opacity="0.18"/>
  <circle cx="420" cy="540" r="26" fill="#e6edf3" stroke="#14161a" stroke-width="5"/>
  <line x1="420" y1="540" x2="452" y2="530" stroke="#14161a" stroke-width="9" stroke-linecap="round"/>
  <!-- crosshair on the guard -->
  <g fill="none" stroke="${RED}" stroke-width="4" stroke-linecap="round">
    <circle cx="1030" cy="330" r="58"/>
    <path d="M1030 252v34M1030 374v34M952 330h34M1074 330h34"/>
  </g>
  <rect width="1600" height="900" fill="url(#vignette)"/>`;
}

function wordmark(x, y, size) {
  return `
  <g font-family="'Open Sans','Helvetica Neue',Arial,sans-serif" font-weight="800" text-anchor="middle">
    <text x="${x}" y="${y}" font-size="${size}" letter-spacing="${size * 0.06}" fill="#000" opacity="0.55" stroke="#000" stroke-width="${size * 0.05}" transform="translate(4 6)">STACKSTRIKE</text>
    <text x="${x}" y="${y}" font-size="${size}" letter-spacing="${size * 0.06}" fill="#f4f1ea" stroke="#0b0b0d" stroke-width="${size * 0.02}">STACK<tspan fill="${GOLD}">STRIKE</tspan></text>
  </g>`;
}

const svg = (w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`;

/** The mark: a crosshair around a gold bar. Square, for icons. */
function icon(size) {
  const c = size / 2;
  const r = size * 0.3;
  return svg(
    size,
    size,
    `<defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a2417"/><stop offset="1" stop-color="#050506"/></radialGradient></defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
    <g fill="none" stroke="${RED}" stroke-width="${size * 0.035}" stroke-linecap="round">
      <circle cx="${c}" cy="${c}" r="${r}"/>
      <path d="M${c} ${size * 0.1}v${size * 0.16}M${c} ${size * 0.74}v${size * 0.16}M${size * 0.1} ${c}h${size * 0.16}M${size * 0.74} ${c}h${size * 0.16}"/>
    </g>
    <path d="M${c - size * 0.06} ${c - size * 0.08}v${-size * 0.04}a${size * 0.02} ${size * 0.02} 0 0 1 ${size * 0.02} ${-size * 0.02}h${size * 0.08}a${size * 0.02} ${size * 0.02} 0 0 1 ${size * 0.02} ${size * 0.02}v${size * 0.04}" fill="none" stroke="${GOLD}" stroke-width="${size * 0.025}"/>
    <rect x="${c - size * 0.15}" y="${c - size * 0.08}" width="${size * 0.3}" height="${size * 0.2}" rx="${size * 0.025}" fill="#7a5a1c" stroke="${GOLD}" stroke-width="${size * 0.025}"/>
    <rect x="${c - size * 0.15}" y="${c - size * 0.01}" width="${size * 0.3}" height="${size * 0.02}" fill="${GOLD}"/>
    <rect x="${c - size * 0.025}" y="${c - size * 0.03}" width="${size * 0.05}" height="${size * 0.07}" rx="${size * 0.01}" fill="${GOLD}"/>`,
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
  <text x="800" y="805" text-anchor="middle" font-family="'Open Sans',Arial,sans-serif" font-weight="600" font-size="34" letter-spacing="10" fill="#9aa3af">STAY QUIET. TAKE THE GOLD.</text>`,
);
await sharp(Buffer.from(keyart)).resize(1200, 675).png().toFile(`${OUT}/keyart.png`);
await sharp(Buffer.from(keyart)).resize(1200, 630, { fit: "cover", position: "centre" }).png().toFile(`${OUT}/thumbnail.png`);
await sharp(Buffer.from(icon(512))).png().toFile(`${OUT}/icon-512.png`);
await sharp(Buffer.from(icon(512))).resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`);
console.log("wrote", OUT);
