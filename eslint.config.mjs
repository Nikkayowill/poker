import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  // .claude/worktrees holds full checkouts other concurrent sessions use for
  // isolated work -- unignored, `npm run lint` was scanning every one of them
  // too, inflating one 5-file diff's lint run into 80k+ reported problems
  // (found 2026-08-19 chasing what looked like a real regression and wasn't).
  globalIgnores([".next/**", "coverage/**", "next-env.d.ts", ".claude/**"]),
]);
