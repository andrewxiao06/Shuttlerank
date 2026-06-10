"use client";

import { cn } from "@/lib/utils";
import {
  CATEGORY_SHORT,
  RatingCategorySchema,
  type RatingCategory,
} from "@/lib/api/types";

/*
 * Horizontal-scroll category picker. Mobile-first — pills wrap onto a
 * single scrollable row at <sm; on ≥sm they wrap normally. Each pill is
 * 44px tall so DESIGN.md's tap-target rule holds even one-handed.
 *
 * Controlled component — owners hold the selected category (so the value
 * can be URL-synced or React-state-only depending on the caller).
 */
export const ALL_CATEGORIES = RatingCategorySchema.options;

export function CategorySelector({
  value,
  onChange,
  categories = ALL_CATEGORIES,
  className,
}: {
  value: RatingCategory;
  onChange: (c: RatingCategory) => void;
  categories?: readonly RatingCategory[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Rating category"
      className={cn(
        "scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0",
        className,
      )}
    >
      {categories.map((c) => {
        const selected = c === value;
        return (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(c)}
            className={cn(
              "h-11 shrink-0 rounded-full border px-4 text-body-md transition-colors",
              selected
                ? "border-primary bg-primary text-on-primary"
                : "border-border bg-surface text-text-primary hover:bg-surface-muted",
            )}
          >
            {CATEGORY_SHORT[c]}
          </button>
        );
      })}
    </div>
  );
}
