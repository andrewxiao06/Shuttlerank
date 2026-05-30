import Link from "next/link";
import { cn } from "@/lib/utils";
import { TIER_BG, isCalibrating } from "@/lib/tier";
import {
  CATEGORY_LABEL,
  type CategoryRating,
  type RatingCategory,
} from "@/lib/api/types";
import { formatRating } from "@/lib/format";
import { TierChip } from "./TierChip";
import { CalibrationDot } from "./CalibrationDot";
import { CeilingBar } from "./CeilingBar";
import { DeltaPill } from "../match/DeltaPill";
import { tierFor } from "@/lib/tier";

/*
 * Rating tile — the signature DUBR surface (DESIGN.md "rating tile"
 * ASCII spec). 3px tier-color stripe; display rating is the hero number;
 * tier chip, calibrating dot, recent delta, ceiling bar all stack below.
 *
 * Renders an empty state when match_count === 0 so the six categories all
 * show up on a new profile without crashing.
 */
export function RatingTile({
  rating,
  recentDelta,
  selected,
  onSelect,
  className,
  href,
}: {
  rating: CategoryRating;
  recentDelta?: number | null;
  selected?: boolean;
  onSelect?: (category: RatingCategory) => void;
  className?: string;
  href?: string;
}) {
  const tier = tierFor(rating.display);
  const empty = rating.match_count === 0;

  const inner = (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface text-left shadow-elevation-1 transition-colors",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        onSelect && "cursor-pointer hover:bg-surface-muted",
        className,
      )}
    >
      <div className={cn("h-1 w-full", empty ? "bg-border" : TIER_BG[tier.name])} />
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <p className="text-label uppercase text-text-secondary">
            {CATEGORY_LABEL[rating.category]}
          </p>
          <CalibrationDot show={isCalibrating(rating.rd)} />
        </div>

        {empty ? (
          <div className="space-y-2 py-2">
            <p className="text-numeral-lg text-text-muted">—</p>
            <p className="text-caption text-text-muted">
              Play your first match to start rating
            </p>
          </div>
        ) : (
          <>
            <p className="text-display-lg">{formatRating(rating.display)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <TierChip rating={rating.display} />
              {recentDelta != null && recentDelta !== 0 ? (
                <DeltaPill delta={recentDelta} />
              ) : null}
            </div>
            <CeilingBar display={rating.display} ceiling={rating.ceiling} />
          </>
        )}
      </div>
    </div>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(rating.category)}
        className="block w-full text-left"
        aria-pressed={selected}
      >
        {inner}
      </button>
    );
  }
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}
