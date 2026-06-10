"use client";

import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { getPlayer } from "@/lib/api";
import type { TournamentEntry } from "@/lib/api/types";

/*
 * Entry list — sortable by seed when present (drafts/round-robins often
 * leave seeds null until pairings are generated). Withdrawn entries are
 * struck through but kept visible so the user knows who used to be in.
 */
export function EntryList({
  entries,
}: {
  entries: TournamentEntry[];
}) {
  const players = useQueries({
    queries: entries.map((e) => ({
      queryKey: ["player", e.player_id],
      queryFn: () => getPlayer(e.player_id),
    })),
  });

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-caption text-text-muted">
        No one has signed up yet.
      </p>
    );
  }

  const sorted = [...entries].sort(
    (a, b) => (a.seed ?? Number.POSITIVE_INFINITY) - (b.seed ?? Number.POSITIVE_INFINITY),
  );

  return (
    <ul className="overflow-hidden rounded-lg border border-border bg-surface">
      {sorted.map((e) => {
        const p = players.find((q) => q.data?.id === e.player_id)?.data;
        const name = p?.display_name ?? p?.name ?? `Player #${e.player_id}`;
        return (
          <li
            key={e.id}
            className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
          >
            <span className="text-numeral-sm text-text-secondary">
              {e.seed ?? "—"}
            </span>
            <Link
              href={`/players/${e.player_id}`}
              className={
                e.withdrawn
                  ? "truncate text-body-md text-text-muted line-through"
                  : "truncate text-body-md hover:underline"
              }
            >
              {name}
            </Link>
            {e.withdrawn ? (
              <span className="text-label uppercase text-text-muted">
                Withdrew
              </span>
            ) : (
              <span className="text-label uppercase text-text-secondary">
                In
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
