import "server-only";
import { QUICK_MATH_CONFIG } from "@/lib/arcade/brain-streak-rounds";
import { createBrainStreakService } from "./brain-streak-service";

/** This game's id in ante_up_attempts; see lib/server/ante-up-store.ts. */
const GAME = "quick-math";

export const {
  read: readBrainQuickMath,
  open: openBrainQuickMath,
  answer: answerBrainQuickMath,
  resign: resignBrainQuickMath,
  toErrorResponse: toBrainQuickMathErrorResponse,
} = createBrainStreakService(GAME, QUICK_MATH_CONFIG);
