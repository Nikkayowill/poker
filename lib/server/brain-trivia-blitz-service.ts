import "server-only";
import { TRIVIA_BLITZ_CONFIG } from "@/lib/arcade/brain-streak";
import { createBrainStreakService } from "./brain-streak-service";

/** This game's id in ante_up_attempts; see lib/server/ante-up-store.ts. */
const GAME = "trivia-blitz";

export const {
  read: readBrainTriviaBlitz,
  open: openBrainTriviaBlitz,
  answer: answerBrainTriviaBlitz,
  resign: resignBrainTriviaBlitz,
  toErrorResponse: toBrainTriviaBlitzErrorResponse,
} = createBrainStreakService(GAME, TRIVIA_BLITZ_CONFIG);
