import { describeSharedRoutineChecks } from "./npc-schedules.suite";

// Each routine's own checks live in npc-schedules.<name>.test.ts so they run
// on separate workers; see the header of npc-schedules.suite.ts.
describeSharedRoutineChecks();
