"use client";

import { useQuery } from "@tanstack/react-query";
import { getPlayer, listPlayerMatches } from "@/lib/api";
import { FormatRatings } from "@/components/rating/FormatRatings";
import { MatchHistory } from "@/components/player/MatchHistory";
import { Avatar } from "@/components/player/Avatar";
import { RatingHistoryChart } from "@/components/player/RatingHistoryChart";

/*
 * Public profile view — read-only. "Your rating is the hero": the hero card
 * is rating, tier, calibration, ceiling; then the rating chart and match
 * history. The editable version of your own profile lives at /me.
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

  const verifiedMatches = (matchesQ.data ?? []).filter(
    (m) => m.status === "verified",
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 lg:max-w-5xl">
      {/* Header */}
      <header className="flex items-center gap-4">
        <Avatar src={player.avatar_url} name={player.display_name ?? player.name} size={64} />
        <div className="space-y-1">
          <p className="text-label uppercase text-text-secondary">Player</p>
          <h1 className="text-h1">{player.display_name ?? player.name}</h1>
          {(player.age != null || player.location) ? (
            <p className="text-caption text-text-secondary">
              {[player.age != null ? `${player.age}` : null, player.location]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </header>

      {/* Hero ratings — most-played format leads, the other tucked below */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-6 shadow-elevation-1">
        <FormatRatings ratings={player.ratings} ceiling />
      </section>

      {/* History chart */}
      <section className="mt-8 space-y-3">
        <h2 className="text-h3">Rating history</h2>
        {matchesQ.isPending ? (
          <div className="h-44 animate-pulse rounded-lg bg-surface-muted" />
        ) : (
          <RatingHistoryChart matches={verifiedMatches} viewerId={playerId} />
        )}
      </section>

      {/* Match history — recent by default, "Show all" to expand */}
      <MatchHistory playerId={playerId} />
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

function ErrorState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-h2">{title}</h1>
      <p className="mt-2 text-caption text-text-secondary">{detail}</p>
    </main>
  );
}
