"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getLeaderboard, getMe } from "@/lib/api";
import { TierChip } from "@/components/rating/TierChip";
import { CalibrationDot } from "@/components/rating/CalibrationDot";
import { PlayerSearch } from "@/components/player/PlayerSearch";
import { formatRating } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * Leaderboard — DESIGN.md "scannable table with sticky header, tabular
 * numerals." Calibrating rows dim to opacity-60 with a ○ marker; the
 * current user's row is highlighted in `surface-muted`. State (category,
 * page, hide-provisional) is URL-synced so a row link survives reload
 * and back-button.
 */
const PAGE_SIZE = 25;

export function LeaderboardView() {
  const router = useRouter();
  const params = useSearchParams();

  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const hideProvisional = params.get("hideProvisional") === "1";

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/leaderboard?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });
  const lbQ = useQuery({
    queryKey: ["leaderboard", offset, hideProvisional],
    queryFn: () =>
      getLeaderboard({
        limit: PAGE_SIZE,
        offset,
        hideProvisional,
      }),
  });

  const data = lbQ.data;
  const myId = meQ.data?.id;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 lg:max-w-5xl">
      <header className="space-y-2">
        <p className="text-label uppercase text-text-secondary">Leaderboard</p>
        <h1 className="text-h1">Where you stand</h1>
      </header>

      {/* Search any player → their profile */}
      <div className="mt-5">
        <PlayerSearch
          onPick={(p) => router.push(`/players/${p.id}`)}
          placeholder="Search for a player…"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-caption text-text-secondary">
          <input
            type="checkbox"
            checked={hideProvisional}
            onChange={(e) =>
              update({
                hideProvisional: e.target.checked ? "1" : null,
                offset: null,
              })
            }
            className="h-4 w-4 accent-primary"
          />
          Hide provisional (still calibrating)
        </label>
        <p className="text-caption text-text-muted">
          {data ? `${data.total} player${data.total === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      <section className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="grid grid-cols-[3rem_1fr_5rem_4rem] items-center gap-3 border-b border-border bg-surface-muted px-4 py-2 text-label uppercase text-text-secondary sm:grid-cols-[3rem_1fr_6rem_5rem_5rem]">
          <span>#</span>
          <span>Player</span>
          <span className="hidden text-right sm:block">Matches</span>
          <span className="text-right">Rating</span>
          <span className="text-right">Tier</span>
        </div>

        {lbQ.isPending ? (
          <SkeletonRows />
        ) : lbQ.isError ? (
          <p className="p-6 text-center text-caption text-danger">
            Couldn&apos;t load: {(lbQ.error as Error).message}
          </p>
        ) : data!.entries.length === 0 ? (
          <p className="p-6 text-center text-caption text-text-muted">
            No players ranked yet.
          </p>
        ) : (
          <ul>
            {data!.entries.map((e) => {
              const isMe = myId != null && e.player_id === myId;
              return (
                <li
                  key={e.player_id}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    e.calibrating && "opacity-60",
                    isMe && "bg-surface-muted/60",
                  )}
                >
                  <Link
                    href={`/players/${e.player_id}`}
                    className="grid min-h-11 grid-cols-[3rem_1fr_5rem_4rem] items-center gap-3 px-4 py-2 hover:bg-surface-muted sm:grid-cols-[3rem_1fr_6rem_5rem_5rem]"
                  >
                    <span className="text-numeral-sm text-text-secondary">
                      {e.rank}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 truncate text-body-md">
                      <CalibrationDot show={e.calibrating} />
                      <span className="truncate">{e.name}</span>
                      {isMe ? (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-label uppercase text-on-primary">
                          You
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden text-right text-numeral-sm text-text-secondary sm:block">
                      {e.match_count}
                    </span>
                    <span className="text-right text-numeral-md">
                      {formatRating(e.display)}
                    </span>
                    <span className="text-right">
                      <TierChip rating={e.display} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data && data.total > PAGE_SIZE ? (
        <nav className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() =>
              update({ offset: String(Math.max(0, offset - PAGE_SIZE)) })
            }
            disabled={offset === 0}
            className="h-11 rounded-md border border-border bg-surface px-4 text-body-md disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-caption text-text-secondary">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => update({ offset: String(offset + PAGE_SIZE) })}
            disabled={offset + PAGE_SIZE >= data.total}
            className="h-11 rounded-md border border-border bg-surface px-4 text-body-md disabled:opacity-40"
          >
            Next →
          </button>
        </nav>
      ) : null}
    </main>
  );
}

function SkeletonRows() {
  return (
    <ul>
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="h-12 animate-pulse border-b border-border bg-surface-muted/40 last:border-b-0"
        />
      ))}
    </ul>
  );
}
