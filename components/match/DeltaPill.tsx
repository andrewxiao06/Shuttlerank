import { cn } from "@/lib/utils";
import { deltaTone, formatDelta } from "@/lib/format";

/*
 * Rating delta pill — DESIGN.md "delta-positive" / "delta-negative" tokens.
 * Colorblind users disambiguate via sign + shape per DESIGN.md "Don't" rule:
 * we always render the +/− prefix from `formatDelta`, never the color alone.
 */
export function DeltaPill({
  delta,
  className,
}: {
  delta: number | null | undefined;
  className?: string;
}) {
  const tone = deltaTone(delta);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-numeral-sm",
        tone === "positive" && "bg-accent-soft text-accent",
        tone === "negative" && "bg-danger-soft text-danger",
        tone === "neutral" && "bg-surface-muted text-text-secondary",
        className,
      )}
    >
      {formatDelta(delta)}
    </span>
  );
}
