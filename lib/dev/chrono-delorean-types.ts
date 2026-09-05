/**
 * The wire shape Chrono-DeLorean Mode's control route
 * (app/api/dev/chrono-delorean/route.ts) answers with, shared between the
 * server module that produces it (lib/server/chrono-delorean.ts) and the
 * client panel that renders it (components/dev/ChronoDevPanel.tsx).
 *
 * Deliberately its own file with no `server-only` import: a client component
 * needs this shape too, and `import type` from a `server-only`-guarded module
 * is erased by the compiler either way, but keeping the shared contract in a
 * file neither side has to reach across the boundary for is the less
 * surprising choice, not a stricter one.
 */
export interface ChronoDeloreanStatus {
  enabled: boolean;
  /** The currently stored offset, in milliseconds, signed. */
  offsetMs: number;
  realNowIso: string;
  simulatedNowIso: string;
}
