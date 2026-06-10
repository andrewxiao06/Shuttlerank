"use client";

import { useQuery } from "@tanstack/react-query";
import { getPlayer, listPlayerMatches } from "@/lib/api";
import { type CategoryRating } from "@/lib/api/types";
import { MatchRow } from "@/components/match/MatchRow";
import { TierChip } from "@/components/rating/TierChip";
import { CalibrationDot } from "@/components/rating/CalibrationDot";
import { CeilingBar } from "@/components/rating/CeilingBar";
import { RatingHistoryChart } from "@/components/player/RatingHistoryChart";
import { formatRating } from "@/lib/format";
import { isCalibrating } from "@/lib/tier";

/*
 * Profile view — DESIGN.md "Your rating is the hero." One universal
 * rating per player, so the hero card is the whole story: rating, tier,
 * calibration state, and ceiling progress. Chart + match list below.
 */
export function ProfileView({ playerId }: { playerId: number }) {
  const playerQ = useQuery({
    queryKey: ["player", playerId],
    queryFn: () => getPlayer(playerId),
  });

  const matchesQ = useQuery({
    queryKey: ["matches", playerId],
    queryFn: () => listPlayerMatches(playerId),
  });

  if (playerQ.isPending) return <ProfileSkeleton />;
  if (playerQ.isError)
    return (
      <ErrorState
        title="Couldn't load this profile"
        detail={(playerQ.error as Error).message}
      />
    );

  const player = playerQ.data;
  const rating: CategoryRating | undefined = player.ratings[0];

  const verifiedMatches = (matchesQ.data ?? []).filter(
    (m) => m.status === "verified",
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 lg:max-w-5xl">
      {/* Header */}
      <header className="space-y-1">
        <p className="text-label uppercase text-text-secondary">Player</p>
        <h1 className="text-h1">{player.display_name ?? player.name}</h1>
      </header>

      {/* Hero rating */}
      {rating ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-6 shadow-elevation-1">
          <div className="flex items-center justify-between">
            <p className="text-label uppercase text-text-secondary">Rating</p>
            <CalibrationDot show={isCalibrating(rating.rd)} />
          </div>
          <p className="mt-2 text-display-lg sm:text-display-xl">
            {rating.match_count > 0 ? formatRating(rating.display) : "—"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TierChip rating={rating.display} />
            <span className="text-caption text-text-muted">
              {rating.match_count} match{rating.match_count === 1 ? "" : "es"}
              {rating.last_active ? ` · last ${rating.last_active}` : ""}
            </span>
          </div>
          <div className="mt-4">
            <CeilingBar display={rating.display} ceiling={rating.ceiling} />
            <p className="mt-1 text-caption text-text-muted">
              Rating cap {formatRating(rating.ceiling)} — raised by playing
              ranked tournaments.
            </p>
          </div>
        </section>
      ) : null}

      {/* History chart */}
      <section className="mt-8 space-y-3">
        <h2 className="text-h3">Rating history</h2>
        {matchesQ.isPending ? (
          <div className="h-44 animate-pulse rounded-lg bg-surface-muted" />
        ) : (
          <RatingHistoryChart matches={verifiedMatches} viewerId={playerId} />
        )}
      </section>

      {/* Recent matches */}
      <section className="mt-8 space-y-3">
        <h2 className="text-h3">Recent matches</h2>
        {matchesQ.isPending ? (
          <SkeletonList />
        ) : (matchesQ.data?.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-caption text-text-muted">
            No matches yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {(matchesQ.data ?? [])
              .slice()
              .sort((a, b) => b.played_at.localeCompare(a.played_at))
              .map((m) => (
                <li key={m.id}>
                  <MatchRow
                    match={m}
                    viewerId={playerId}
                    href={`/matches/${m.id}`}
                  />
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ProfileSkeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl animate-pulse space-y-6 px-4 py-6 sm:px-6">
      <div className="h-6 w-24 rounded bg-surface-muted" />
      <div className="h-48 rounded-xl bg-surface-muted" />
      <div className="h-44 rounded-lg bg-surface-muted" />
    </main>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="h-20 animate-pulse rounded-lg bg-surface-muted" />
      ))}
    </ul>
  );
}

function ErrorState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-h2">{title}</h1>
      <p className="mt-2 text-caption text-text-secondary">{detail}</p>
    </main>
  );
}
