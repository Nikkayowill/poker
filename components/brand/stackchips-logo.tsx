import Image from "next/image";

/**
 * The StackChips "High Roller Arcade" badge.
 *
 * One component rather than an <Image> repeated at each call site, because
 * the asset has a constraint call sites shouldn't have to remember: the
 * supplied PNG had no alpha channel at all (a solid black plate behind the
 * art), so the transparent copy in public/brand/ was produced by flood-
 * filling that plate from the four corners rather than keying out black
 * globally, which would have punched holes through the banner's interior
 * (genuinely black). So there is exactly one correct file to point at, and
 * this is the thing that points at it.
 *
 * `priority` is opt-in: the sign-in screen's copy is the largest contentful
 * paint on the signed-out page and shouldn't lazy-load, while the footer's
 * should.
 */
export function StackChipsLogo({
  size = 132,
  priority = false,
  className,
}: {
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/brand/stackchips-logo.png"
      alt="StackChips — High Roller Arcade"
      width={size}
      // The source is square (512x512) and the art is centred in it, so the
      // padding is part of the composition rather than something to crop out.
      height={size}
      priority={priority}
      className={className}
    />
  );
}
