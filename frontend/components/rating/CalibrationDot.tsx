import { cn } from "@/lib/utils";

/*
 * DESIGN.md mandate: show a warning-colored ○ when rd > 150 to explain
 * why a rating moves a lot early. Title attribute gives screen readers
 * the same context.
 */
export function CalibrationDot({
  show,
  className,
}: {
  show: boolean;
  className?: string;
}) {
  if (!show) return null;
  return (
    <span
      role="img"
      aria-label="Still calibrating"
      title="Still calibrating — rating will stabilize as you play more matches"
      className={cn(
        "inline-flex h-2.5 w-2.5 rounded-full bg-warning",
        className,
      )}
    />
  );
}
