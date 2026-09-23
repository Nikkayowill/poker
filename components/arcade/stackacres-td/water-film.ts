import Phaser from "phaser";
import {
  FILM_COLUMNS,
  FILM_OPACITY,
  FILM_SIZE,
  filmDrift,
  filmFrame,
  filmSheetSize,
  foamSet,
  type WaterSpec,
} from "@/lib/stackacres-td/water";

/** Over the ground picture (-10), under the critters on the water (-9), beds and everything standing. */
const WATER_FILM_DEPTH = -9.5;
/** Foam is Stardew's pale blue, laid on nearly solid. */
const FOAM_RGB = [156 / 255, 222 / 255, 242 / 255] as const;
const FOAM_ALPHA = 0.8;

type Keep = <T extends Phaser.GameObjects.GameObject>(object: T) => T;

/**
 * The lake's moving film of light and its foam, Stardew's way (lib/stackacres-td/water.ts has the timing).
 *
 * One quad over the water's box, drawn by a small shader. It reads two pictures the art pipeline draws:
 * the area's mask (areas/<area>/water.png: red where the film lies, green which set of foam dashes a
 * pixel is in) and the film's ten frames (common/water-film.png). Per pixel it picks the frame, shifts it
 * up by the drift, and lays it on at FILM_OPACITY; a foam pixel of the set showing goes pale on top.
 * Everything is worked out in whole ground-picture pixels, so it stays as crisp as the ground under it,
 * and the pattern is pinned to the map rather than to the quad.
 *
 * The painted lake (its deep water, the stones on the bottom, the shadows under the dock and lily pads)
 * is in the ground picture; this only adds the light moving over it. Under prefers-reduced-motion the
 * film holds still. The Canvas renderer has no shaders, so there the lake is just the painted picture.
 */
export class WaterFilm {
  private shader: Phaser.GameObjects.Shader | null = null;
  private readonly webgl: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly keep: Keep,
  ) {
    this.webgl = scene.sys.game.renderer.type === Phaser.WEBGL;
  }

  /** Called on entering an area, after the area's objects were cleared. No `water`, no film (see AreaSpec). */
  build(water: WaterSpec | null | undefined, maskKey: string): void {
    this.shader = null;
    if (!water || !this.webgl) return;
    const sheet = filmSheetSize();
    const base = new Phaser.Display.BaseShader(`water-film:${maskKey}`, FRAGMENT, undefined, {
      maskSize: { type: "2f", value: { x: water.w * 2, y: water.h * 2 } },
      sheetSize: { type: "2f", value: { x: sheet.width, y: sheet.height } },
      origin: { type: "2f", value: { x: water.x * 2, y: water.y * 2 } },
      frame: { type: "1f", value: 0 },
      drift: { type: "1f", value: 0 },
      foamSet: { type: "1f", value: 1 },
    });
    this.shader = this.keep(
      this.scene.add
        .shader(base, water.x, water.y, water.w, water.h, [maskKey, "water-film"], {
          minFilter: "nearest",
          magFilter: "nearest",
          wrapS: "clamp_to_edge",
          wrapT: "clamp_to_edge",
        })
        .setOrigin(0, 0)
        .setDepth(WATER_FILM_DEPTH),
    );
  }

  update(timeMs: number, reducedMotion: boolean): void {
    if (!this.shader) return;
    const ms = reducedMotion ? 0 : timeMs;
    this.shader.setUniform("frame.value", filmFrame(ms));
    this.shader.setUniform("drift.value", filmDrift(ms));
    this.shader.setUniform("foamSet.value", foamSet(ms));
  }
}

// highp where the GPU has it: the pixel maths reaches 2,000+, which mediump rounds. A phone without it still
// compiles the shader (Phaser throws on a failed compile, which would stop the area loading).
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 resolution;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform vec2 maskSize;
uniform vec2 sheetSize;
uniform vec2 origin;
uniform float frame;
uniform float drift;
uniform float foamSet;

varying vec2 fragCoord;

const float SIZE = ${FILM_SIZE.toFixed(1)};
const float COLUMNS = ${FILM_COLUMNS.toFixed(1)};
const float OPACITY = ${FILM_OPACITY.toFixed(3)};
const vec3 FOAM = vec3(${FOAM_RGB.map((c) => c.toFixed(4)).join(", ")});
const float FOAM_ALPHA = ${FOAM_ALPHA.toFixed(2)};

void main() {
  // The ground picture's pixel under this fragment: two to a map unit, counted from the quad's top left.
  vec2 px = floor(vec2(fragCoord.x, resolution.y - fragCoord.y) * 2.0);
  vec4 mask = texture2D(iChannel0, (px + 0.5) / maskSize);
  float filmed = step(0.5, mask.r);
  float dashes = mask.g > 0.75 ? 2.0 : (mask.g > 0.25 ? 1.0 : 0.0);
  float foam = dashes == foamSet ? 1.0 : 0.0;
  if (filmed + foam < 0.5) discard;

  vec2 p = mod(px + origin + vec2(0.0, drift), SIZE);
  vec2 cell = vec2(mod(frame, COLUMNS), floor(frame / COLUMNS)) * SIZE;
  vec3 film = texture2D(iChannel1, (cell + p + 0.5) / sheetSize).rgb;

  // Premultiplied, as Phaser blends: the film, then the foam over it.
  float alpha = OPACITY * filmed;
  vec3 colour = film * alpha;
  colour = mix(colour, FOAM, FOAM_ALPHA * foam);
  alpha = mix(alpha, 1.0, FOAM_ALPHA * foam);
  gl_FragColor = vec4(colour, alpha);
}
`;
