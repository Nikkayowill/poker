import type Phaser from "phaser";
import { NODE_ART } from "@/lib/stackacres-td/gather-nodes";
import { LAND_BOULDER_ART } from "@/lib/stackacres-td/land-obstacles";

/** Paints the hand-drawn pieces once: what a spent tree or boulder leaves
 *  behind (the `stump` and `rubble` textures), and the boulder standing on
 *  land still being cleared, which no field atlas holds. */
export function drawNodeTextures(textures: Phaser.Textures.TextureManager): void {
  for (const { texture, rows, colors } of [...Object.values(NODE_ART), LAND_BOULDER_ART]) {
    if (textures.exists(texture)) continue;
    const canvas = textures.createCanvas(texture, rows[0].length, rows.length);
    if (!canvas) continue;
    const ctx = canvas.getContext();
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const colour = colors[row[x]];
        if (!colour) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    canvas.refresh();
  }
}
