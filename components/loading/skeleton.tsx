import clsx from "clsx";

/**
 * The one shimmering-block primitive every loading skeleton in the app
 * composes from -- see 47-loading.css for the shimmer keyframe and its
 * reduced-motion fallback (a static tone, no animation).
 *
 * Sizing is entirely up to the caller's className: a skeleton only earns its
 * keep by matching the real content's footprint exactly, so the space is
 * already reserved before data arrives and nothing shifts when it's swapped
 * in (see rank-strip.tsx's own comment on why `return null` used to be the
 * accepted tradeoff here).
 */
export function Skeleton({ className }: { className?: string }) {
  return <span className={clsx("skeleton-block", className)} aria-hidden="true" />;
}
