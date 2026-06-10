import { cn } from "@/lib/utils";
import type { MatchStatus } from "@/lib/api/types";

/*
 * Validation state banner — DESIGN.md locked semantics:
 *  - verified → accent (green)
 *  - pending  → warning (amber)
 *  - disputed → danger (red)
 *  - expired  → text-muted (gray, no chip color)
 *
 * Auto-verify countdown rendered inline when an `expiresAt` is in the
 * future; once expired the API would transition to verified or expired
 * via the background job (see PLAN.md "Auto-verify never fires").
 */
export function StatusBanner({
  status,
  expiresAt,
  className,
}: {
  status: MatchStatus | null;
  expiresAt?: string | null;
  className?: string;
}) {
  if (!status) return null;
  const tone = TONE[status];
  const countdown = expiresAt && status === "pending" ? autoVerifyIn(expiresAt) : null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-body-md",
        tone.classes,
        className,
      )}
      role="status"
    >
      <div>
        <p className="font-semibold">{tone.title}</p>
        <p className="text-caption opacity-80">{tone.detail}</p>
      </div>
      {countdown ? (
        <p className="shrink-0 text-caption">{countdown}</p>
      ) : null}
    </div>
  );
}

const TONE: Record<
  MatchStatus,
  { classes: string; title: string; detail: string }
> = {
  pending: {
    classes: "border-warning/30 bg-warning-soft text-warning",
    title: "Pending approval",
    detail: "Waiting for all participants to approve before ratings update.",
  },
  verified: {
    classes: "border-accent/30 bg-accent-soft text-accent",
    title: "Verified",
    detail: "Ratings have been updated for everyone in this match.",
  },
  disputed: {
    classes: "border-danger/30 bg-danger-soft text-danger",
    title: "Disputed",
    detail: "Someone flagged this match. Ratings are frozen pending review.",
  },
  expired: {
    classes: "border-border bg-surface-muted text-text-secondary",
    title: "Expired",
    detail: "This match expired before everyone approved.",
  },
};

function autoVerifyIn(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Auto-verifies any moment";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days >= 1) return `Auto-verifies in ${days}d`;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 1) return `Auto-verifies in ${hours}h`;
  const minutes = Math.max(1, Math.floor(ms / (1000 * 60)));
  return `Auto-verifies in ${minutes}m`;
}
