/**
 * The gold coin art shared by the page-change orb (components/loading/
 * orb-transition-layer.tsx) and the win celebration (components/celebration/
 * win-celebration.tsx): the same coin, so a payout reads as the same Gold
 * the rest of the app already shows spinning during a page load, not a
 * second, different-looking effect.
 *
 * Pure canvas drawing, no timeline or state -- each caller owns its own
 * positions and calls `drawCoin` per frame.
 */

export const SPRITE_PX = 128;

export interface CoinSprites {
  readonly face: HTMLCanvasElement;
  readonly edge: HTMLCanvasElement;
  readonly band: HTMLCanvasElement;
  readonly shine: HTMLCanvasElement;
  readonly goldGlow: HTMLCanvasElement;
  readonly violetGlow: HTMLCanvasElement;
}

export function sprite(width: number, height: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (g) paint(g);
  return canvas;
}

export function glow(rgb: string, strength: number): HTMLCanvasElement {
  return sprite(SPRITE_PX, SPRITE_PX, (g) => {
    const half = SPRITE_PX / 2;
    const fill = g.createRadialGradient(half, half, 0, half, half, half);
    fill.addColorStop(0, `rgba(${rgb}, ${strength})`);
    fill.addColorStop(0.45, `rgba(${rgb}, ${strength * 0.35})`);
    fill.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = fill;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  });
}

/** The coin art, in the primary button's gold bevel so it reads as the same Gold. */
export function coinSprites(): CoinSprites {
  const half = SPRITE_PX / 2;
  const r = half - 2;
  const disc = (g: CanvasRenderingContext2D, radius: number) => {
    g.beginPath();
    g.arc(half, half, radius, 0, Math.PI * 2);
  };

  const face = sprite(SPRITE_PX, SPRITE_PX, (g) => {
    const bevel = g.createLinearGradient(half - r * 0.6, half - r, half + r * 0.6, half + r);
    bevel.addColorStop(0, "#ffe08f");
    bevel.addColorStop(0.38, "#ffe98a");
    bevel.addColorStop(0.74, "#ffd23f");
    bevel.addColorStop(1, "#a8760c");
    disc(g, r);
    g.fillStyle = bevel;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "#8a5a06";
    disc(g, r - 1.5);
    g.stroke();

    g.lineWidth = 2;
    g.strokeStyle = "rgba(138, 90, 6, 0.5)";
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      g.beginPath();
      g.moveTo(half + Math.cos(a) * r * 0.84, half + Math.sin(a) * r * 0.84);
      g.lineTo(half + Math.cos(a) * r * 0.93, half + Math.sin(a) * r * 0.93);
      g.stroke();
    }

    g.lineWidth = 3;
    g.strokeStyle = "rgba(138, 90, 6, 0.7)";
    disc(g, r * 0.72);
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(255, 246, 204, 0.75)";
    g.beginPath();
    g.arc(half - 1, half - 1, r * 0.72, Math.PI * 0.8, Math.PI * 1.7);
    g.stroke();

    const diamond = (dx: number, dy: number) => {
      g.beginPath();
      g.moveTo(half + dx, half + dy - r * 0.42);
      g.lineTo(half + dx + r * 0.3, half + dy);
      g.lineTo(half + dx, half + dy + r * 0.42);
      g.lineTo(half + dx - r * 0.3, half + dy);
      g.closePath();
    };
    diamond(2.5, 2.5);
    g.fillStyle = "rgba(138, 90, 6, 0.6)";
    g.fill();
    const pip = g.createLinearGradient(half, half - r * 0.42, half, half + r * 0.42);
    pip.addColorStop(0, "#fff3b8");
    pip.addColorStop(1, "#e0a92a");
    diamond(0, 0);
    g.fillStyle = pip;
    g.fill();
  });

  const edge = sprite(SPRITE_PX, SPRITE_PX, (g) => {
    const fill = g.createLinearGradient(0, half - r, 0, half + r);
    fill.addColorStop(0, "#d9a12a");
    fill.addColorStop(1, "#6e4604");
    disc(g, r);
    g.fillStyle = fill;
    g.fill();
  });

  // The coin's rim seen side-on: a vertical ramp stretched between its two faces.
  const band = sprite(4, SPRITE_PX, (g) => {
    const fill = g.createLinearGradient(0, 2, 0, SPRITE_PX - 2);
    fill.addColorStop(0, "#e6b23a");
    fill.addColorStop(0.5, "#b07a10");
    fill.addColorStop(1, "#6e4604");
    g.fillStyle = fill;
    g.fillRect(0, 2, 4, SPRITE_PX - 4);
  });

  const shine = sprite(SPRITE_PX, SPRITE_PX, (g) => {
    disc(g, r);
    g.clip();
    const sweep = g.createLinearGradient(0, 0, SPRITE_PX, SPRITE_PX);
    sweep.addColorStop(0.3, "rgba(255, 255, 255, 0)");
    sweep.addColorStop(0.45, "rgba(255, 255, 255, 0.9)");
    sweep.addColorStop(0.6, "rgba(255, 255, 255, 0)");
    g.fillStyle = sweep;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  });

  return { face, edge, band, shine, goldGlow: glow("255, 210, 63", 0.55), violetGlow: glow("155, 63, 240", 0.5) };
}

/**
 * One coin flipping about its upright axis. The two faces sit a rim's
 * thickness apart and the rim fills the gap, so it reads as a solid disc
 * even edge-on. It dims as it turns away and catches a glint face-on.
 */
export function drawCoin(
  ctx: CanvasRenderingContext2D,
  art: CoinSprites,
  x: number,
  y: number,
  r: number,
  angle: number,
  alpha: number,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const halfWidth = Math.max(Math.abs(c), 0.03) * r;
  const rim = r * 0.2 * s * (c >= 0 ? 1 : -1);
  const front = x + rim / 2;
  const back = x - rim / 2;
  ctx.globalAlpha = alpha;
  ctx.drawImage(art.edge, back - halfWidth, y - r, halfWidth * 2, r * 2);
  ctx.drawImage(art.band, Math.min(front, back), y - r, Math.abs(rim), r * 2);
  ctx.drawImage(art.face, front - halfWidth, y - r, halfWidth * 2, r * 2);
  const turned = 1 - Math.abs(c);
  if (turned > 0.02) {
    ctx.globalAlpha = alpha * turned * 0.45;
    ctx.drawImage(art.edge, front - halfWidth, y - r, halfWidth * 2, r * 2);
  }
  const glint = Math.abs(c) ** 10;
  if (glint > 0.02) {
    ctx.globalAlpha = alpha * glint * 0.7;
    ctx.drawImage(art.shine, front - halfWidth, y - r, halfWidth * 2, r * 2);
  }
}
