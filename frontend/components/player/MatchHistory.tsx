"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listPlayerMatches } from "@/lib/api";
import { MatchRow } from "@/components/match/MatchRow";

const RECENT_COUNT = 5;

/*
 * Match history for a player — recent few by default with a "Show all"
 * toggle to expand to the complete list. Each row links to the full match
 * detail (per-participant rating changes). Shared by /me and /players/[id].
 */
export function MatchHistory({ playerId }: { playerId: number }) {
  const [showAll, setShowAll] = useState(false);

  const q = useQuery({
    queryKey: ["matches", playerId],
    queryFn: () => listPlayerMatches(playerId),
  });

  const sorted = (q.data ?? [])
    .slice()
    .sort((a, b) => b.played_at.localeCompare(a.played_at));
  const shown = showAll ? sorted : sorted.slice(0, RECENT_COUNT);
  const hasMore = sorted.length > RECENT_COUNT;

  return (
    <section className="mt-8 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-h3">{showAll ? "Match history" : "Recent matches"}</h2>
        {hasMore ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-caption text-primary underline-offset-2 hover:underline"
          >
            {showAll ? "Show recent" : `Show all (${sorted.length})`}
          </button>
        ) : null}
      </div>

      {q.isPending ? (
        <ul className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="h-20 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </ul>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-caption text-text-muted">
          No matches yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((m) => (
            <li key={m.id}>
              <MatchRow match={m} viewerId={playerId} href={`/matches/${m.id}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
