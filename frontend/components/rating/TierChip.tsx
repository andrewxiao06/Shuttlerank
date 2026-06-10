import { cn } from "@/lib/utils";
import { TIER_CHIP_BG, tierFor } from "@/lib/tier";

/*
 * Tier chip — DESIGN.md "chip-tier" token. Tier color used as a soft tint;
 * label text stays text-primary (the tier hues are mid-saturation and
 * black passes WCAG AA on all six per DESIGN.md).
 */
export function TierChip({
  rating,
  className,
}: {
  rating: number | null | undefined;
  className?: string;
}) {
  const tier = tierFor(rating);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-label uppercase text-text-primary",
        TIER_CHIP_BG[tier.name],
        className,
      )}
    >
      {tier.label}
    </span>
  );
}
