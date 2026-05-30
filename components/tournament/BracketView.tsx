"use client";

import { useQueries } from "@tanstack/react-query";
import { getPlayer } from "@/lib/api";
import type { Tournament } from "@/lib/api/types";

/*
 * Bracket view — minimal SVG for single-elim, list-of-rounds for the
 * others. We don't render real fixture data here yet (the real API
 * exposes round-robin/Swiss pairings as match rows, not a tree), so the
 * single-elim case projects a notional bracket from the active entry
 * list. Phase 9 will swap to API-returned pairings.
 *
 * Border-based connectors rather than SVG strokes so the layout reflows
 * naturally on mobile (DESIGN.md "no horizontal scroll on any viewport").
 */
export function BracketView({ tournament }: { tournament: Tournament }) {
  const active = tournament.entries.filter((e) => !e.withdrawn);
  const players = useQueries({
    queries: active.map((e) => ({
      queryKey: ["player", e.player_id],
      queryFn: () => getPlayer(e.player_id),
    })),
  });
  const nameOf = (id: number) => {
    const p = players.find((q) => q.data?.id === id)?.data;
    return p?.display_name ?? p?.name ?? `Player #${id}`;
  };

  if (tournament.format !== "single_elim") {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-caption text-text-muted">
        Bracket view is only rendered for single-elimination. For{" "}
        {tournament.format.replace("_", "-")}, results will appear as match
        rows once pairings are generated.
      </div>
    );
  }

  // Pad to next power of two so the bracket is balanced.
  const ordered = [...active].sort(
    (a, b) => (a.seed ?? Number.POSITIVE_INFINITY) - (b.seed ?? Number.POSITIVE_INFINITY),
  );
  const size = nextPowerOfTwo(ordered.length);
  while (ordered.length < size) {
    ordered.push({ id: -ordered.length, player_id: -1, seed: null, withdrawn: false });
  }

  // Pair top vs bottom (1 vs 16, 2 vs 15, etc.).
  const round1: Array<[number, number]> = [];
  for (let i = 0; i < size / 2; i++) {
    round1.push([ordered[i].player_id, ordered[size - 1 - i].player_id]);
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit gap-8">
        <Round title="Round 1" matches={round1.map((m) => m.map(nameOf) as [string, string])} />
        {/* Subsequent rounds remain as "TBD" placeholders for the mock. */}
        {Array.from({ length: Math.log2(size) - 1 }).map((_, idx) => (
          <Round
            key={idx}
            title={idx === Math.log2(size) - 2 ? "Final" : `Round ${idx + 2}`}
            matches={Array.from({ length: size / 2 ** (idx + 2) }).map(
              () => ["TBD", "TBD"],
            )}
            placeholder
          />
        ))}
      </div>
    </div>
  );
}

function Round({
  title,
  matches,
  placeholder,
}: {
  title: string;
  matches: Array<[string, string]>;
  placeholder?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-label uppercase text-text-secondary">{title}</p>
      <ul className="space-y-3">
        {matches.map((m, i) => (
          <li
            key={i}
            className={
              placeholder
                ? "w-44 overflow-hidden rounded-md border border-dashed border-border text-text-muted"
                : "w-44 overflow-hidden rounded-md border border-border bg-surface"
            }
          >
            <p className="truncate border-b border-border px-3 py-2 text-body-sm">
              {m[0] === "Player #-1" ? "bye" : m[0]}
            </p>
            <p className="truncate px-3 py-2 text-body-sm">
              {m[1] === "Player #-1" ? "bye" : m[1]}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 2;
  return 2 ** Math.ceil(Math.log2(n));
}
