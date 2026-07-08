"use client";

import { useQuery } from "@tanstack/react-query";
import { getPlayer, listPlayerMatches } from "@/lib/api";
import { type CategoryRating } from "@/lib/api/types";
import { pickRatings } from "@/lib/ratings";
import { MatchHistory } from "@/components/player/MatchHistory";
import { Avatar } from "@/components/player/Avatar";
import { TierChip } from "@/components/rating/TierChip";
import { CalibrationDot } from "@/components/rating/CalibrationDot";
import { CeilingBar } from "@/components/rating/CeilingBar";
import { RatingHistoryChart } from "@/components/player/RatingHistoryChart";
import { formatRating } from "@/lib/format";
import { isCalibrating } from "@/lib/tier";

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
  const { singles, doubles } = pickRatings(player.ratings);

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

      {/* Hero ratings — Singles + Doubles are independent */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <FormatRating label="Singles" rating={singles} />
        <FormatRating label="Doubles" rating={doubles} />
      </div>

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

function FormatRating({
  label,
  rating,
}: {
  label: string;
  rating: CategoryRating | null;
}) {
  const played = (rating?.match_count ?? 0) > 0;
  return (
    <section className="rounded-xl border border-border bg-surface p-6 shadow-elevation-1">
      <div className="flex items-center justify-between">
        <p className="text-label uppercase text-text-secondary">{label}</p>
        <CalibrationDot show={!!rating && isCalibrating(rating.rd)} />
      </div>
      <p className="mt-2 text-display-lg">
        {rating && played ? formatRating(rating.display) : "—"}
      </p>
      {rating ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TierChip rating={rating.display} />
            <span className="text-caption text-text-muted">
              {played
                ? `${rating.match_count} match${rating.match_count === 1 ? "" : "es"}`
                : "Not yet played"}
            </span>
          </div>
          <div className="mt-4">
            <CeilingBar display={rating.display} ceiling={rating.ceiling} />
            <p className="mt-1 text-caption text-text-muted">
              Rating cap {formatRating(rating.ceiling)}
            </p>
          </div>
        </>
      ) : null}
    </section>
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
