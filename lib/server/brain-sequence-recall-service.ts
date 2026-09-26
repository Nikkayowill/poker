import "server-only";
import { SEQUENCE_RECALL_CONFIG } from "@/lib/arcade/brain-streak-rounds";
import { createBrainStreakService } from "./brain-streak-service";

/** This game's id in ante_up_attempts; see lib/server/ante-up-store.ts. */
const GAME = "sequence-recall";

export const {
  read: readBrainSequenceRecall,
  open: openBrainSequenceRecall,
  answer: answerBrainSequenceRecall,
  resign: resignBrainSequenceRecall,
  toErrorResponse: toBrainSequenceRecallErrorResponse,
} = createBrainStreakService(GAME, SEQUENCE_RECALL_CONFIG);
