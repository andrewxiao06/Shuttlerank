import Link from "next/link";
import { cn } from "@/lib/utils";
import { type CategoryMatch, type MatchParticipant } from "@/lib/api/types";
import { Avatar } from "@/components/player/Avatar";
import { DeltaPill } from "./DeltaPill";

/*
 * Match row — shows both sides at a glance: each team's players (avatar +
 * name), the score, and the viewer's rating delta. Reads names/avatars
 * straight off the participants (the API now includes them), so no extra
 * lookups are needed.
 *
 * The viewer's team is shown on the left so "you vs them" reads naturally.
 */
export function MatchRow({
  match,
  viewerId,
  href,
  className,
}: {
  match: CategoryMatch;
  viewerId: number;
  href?: string;
  className?: string;
}) {
  const viewer = match.participants.find((p) => p.player_id === viewerId);
  const mySide = viewer?.team ?? "A";
  const mine = match.participants.filter((p) => p.team === mySide);
  const theirs = match.participants.filter((p) => p.team !== mySide);

  const myScore = mySide === "A" ? match.team_a_score : match.team_b_score;
  const theirScore = mySide === "A" ? match.team_b_score : match.team_a_score;
  const youWon = viewer?.team === match.winner_team;
  const verified = match.status === "verified";
  const played = formatMatchDate(match.played_at);

  const inner = (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors",
        href && "hover:bg-surface-muted",
        className,
      )}
    >
      <div className="flex items-center justify-between text-caption text-text-secondary">
        <span>
          {match.participants.length > 2 ? "Doubles" : "Singles"} · {played}
        </span>
        {verified ? (
          <span className={cn(youWon ? "text-accent" : "text-danger")}>
            {youWon ? "Won" : "Lost"}
          </span>
        ) : (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-label uppercase text-warning">
            Pending
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Side players={mine} />
        <div className="flex shrink-0 flex-col items-center">
          <span className="text-numeral-md tabular-nums">
            {myScore}
            <span className="px-1 text-text-muted">–</span>
            {theirScore}
          </span>
          {verified ? <DeltaPill delta={viewer?.delta_display ?? 0} /> : null}
        </div>
        <Side players={theirs} align="right" />
      </div>
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Side({
  players,
  align = "left",
}: {
  players: MatchParticipant[];
  align?: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0 flex-1 space-y-1", align === "right" && "items-end")}>
      {players.map((p) => (
        <div
          key={p.player_id}
          className={cn(
            "flex min-w-0 items-center gap-2",
            align === "right" && "flex-row-reverse",
          )}
        >
          <Avatar src={p.avatar_url} name={p.name} size={28} />
          <span className="truncate text-body-md">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

// "2026-06-15" → "6/15/26". Parse the parts directly (not new Date()) to
// avoid the UTC-midnight off-by-one that shifts the day in some timezones.
function formatMatchDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${String(y).slice(-2)}`;
}
