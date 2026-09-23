import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STACKACRES_CROPS } from "@/lib/stackacres/catalogue";
import { cropFrame, type CropStage } from "./crop-frames";

const atlas = JSON.parse(readFileSync("public/stackacres-td/common/sprites.json", "utf8")) as {
  frames: Record<string, unknown>;
};

describe("crop frames", () => {
  for (const crop of STACKACRES_CROPS) {
    it(`draws ${crop} from frames that exist`, () => {
      for (const stage of [0, 1, 2] as CropStage[]) expect(atlas.frames).toHaveProperty([cropFrame(crop, stage)]);
    });

    it(`ripens ${crop} into its own drawing`, () => {
      expect(cropFrame(crop, 2)).not.toBe("crop_generic_2");
    });
  }
});
