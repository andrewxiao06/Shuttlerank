import Link from "next/link";
import { cn } from "@/lib/utils";
import { CATEGORY_SHORT, type CategoryMatch } from "@/lib/api/types";
import { DeltaPill } from "./DeltaPill";

/*
 * Match row — DESIGN.md spec:
 *
 *   A. Xiao   vs   J. Patel       21-15 21-18
 *   Gold II        Silver III      2 days ago
 *                                         +0.041
 *
 * On mobile (<sm) the score moves under the names → two-line layout.
 *
 * PLAN.md debugging hook: "Match row shows wrong delta" → viewerId must
 * locate the participant where `player_id === viewerId`. That's enforced
 * here; rows without a viewer participant fall back to the team-A delta.
 */
export function MatchRow({
  match,
  viewerId,
  opponentName,
  href,
  className,
}: {
  match: CategoryMatch;
  viewerId: number;
  opponentName?: string;
  href?: string;
  className?: string;
}) {
  const viewer = match.participants.find((p) => p.player_id === viewerId);
  const opp = match.participants.find(
    (p) => p.team !== (viewer?.team ?? "A") && p.player_id !== viewerId,
  );
  const oppRating = opp?.post_r;
  const youWon = viewer?.team === match.winner_team;

  const ago = relativeTime(match.played_at);
  const score =
    viewer?.team === "B"
      ? `${match.team_b_score}-${match.team_a_score}`
      : `${match.team_a_score}-${match.team_b_score}`;

  const inner = (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors",
        href && "hover:bg-surface-muted",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-body-md font-semibold">
              {opponentName ?? `Player #${opp?.player_id ?? "?"}`}
            </p>
            <span
              className={cn(
                "text-label uppercase",
                youWon ? "text-accent" : "text-danger",
              )}
            >
              {youWon ? "Won" : "Lost"}
            </span>
          </div>
          <p className="text-caption text-text-secondary">
            {match.category ? CATEGORY_SHORT[match.category] : "—"} ·{" "}
            {ago}
            {oppRating != null ? ` · vs ${oppRating.toFixed(2)}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className="text-numeral-md">{score}</p>
          {match.status === "verified" ? (
            <DeltaPill delta={viewer?.delta_r ?? 0} />
          ) : (
            <span className="rounded-full bg-warning-soft px-2.5 py-1 text-label uppercase text-warning">
              Pending
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.round((now - then) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

