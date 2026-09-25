import "server-only";
import { PATTERN_PREDICTOR_CONFIG } from "@/lib/arcade/brain-streak";
import { createBrainStreakService } from "./brain-streak-service";

/** This game's id in ante_up_attempts; see lib/server/ante-up-store.ts. */
const GAME = "pattern-predictor";

export const {
  read: readBrainPatternPredictor,
  open: openBrainPatternPredictor,
  answer: answerBrainPatternPredictor,
  resign: resignBrainPatternPredictor,
  toErrorResponse: toBrainPatternPredictorErrorResponse,
} = createBrainStreakService(GAME, PATTERN_PREDICTOR_CONFIG);
