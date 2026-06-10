import { cn } from "@/lib/utils";

/*
 * Ceiling bar — shows how close a player is to their cap. Capped state
 * (display ≥ ceiling) renders a full bar in `warning` with the unlock
 * prompt; this is the integrity story called out in PLAN.md item 5.
 *
 * Bottom is hard-coded to 2.0 (the DUPR-style scale floor in CLAUDE.md),
 * so the bar fills from "raw beginner" → "ceiling", not from 0.
 */
const SCALE_FLOOR = 2.0;

export function CeilingBar({
  display,
  ceiling,
  className,
}: {
  display: number;
  ceiling: number;
  className?: string;
}) {
  const span = Math.max(0.001, ceiling - SCALE_FLOOR);
  const filled = Math.max(0, Math.min(1, (display - SCALE_FLOOR) / span));
  const pct = Math.round(filled * 100);
  const capped = display >= ceiling - 0.01;

  return (
    <div className={cn("space-y-1", className)}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% to ceiling`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            capped ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-caption text-text-muted">
        {capped
          ? "Capped — play a sanctioned tournament to raise this"
          : `${pct}% to cap (${ceiling.toFixed(2)})`}
      </p>
    </div>
  );
}
