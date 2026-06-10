"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPlayer, listPlayerMatches } from "@/lib/api";
import {
  CATEGORY_LABEL,
  type RatingCategory,
  type CategoryRating,
} from "@/lib/api/types";
import { RatingTile } from "@/components/rating/RatingTile";
import { MatchRow } from "@/components/match/MatchRow";
import { TierChip } from "@/components/rating/TierChip";
import { CalibrationDot } from "@/components/rating/CalibrationDot";
import { RatingHistoryChart } from "@/components/player/RatingHistoryChart";
import { formatRating } from "@/lib/format";
import { isCalibrating } from "@/lib/tier";

/*
 * Profile view — DESIGN.md "Your rating is the hero" applied across the
 * six categories. Layout:
 *
 *   Mobile (<sm):      hero rating + horizontal-scroll rating tiles, then
 *                      chart, then match list.
 *   md ≥ tablet:       same hero, 2-col tile grid.
 *   lg ≥ desktop:      3-col tile grid.
 *
 * Category selector lives on the tiles themselves — tapping a tile
 * promotes that category into the hero spot and re-filters the chart +
 * match list without a route change.
 */
export function ProfileView({ playerId }: { playerId: number }) {
  const playerQ = useQuery({
    queryKey: ["player", playerId],
    queryFn: () => getPlayer(playerId),
  });

  // Default to the player's best-rated active category. Recomputed once
  // when the player loads so first paint shows a meaningful hero.
  const [selected, setSelected] = useState<RatingCategory | null>(null);
  const active: RatingCategory | null = useMemo(() => {
    if (selected) return selected;
    const ratings = playerQ.data?.ratings ?? [];
    const played = ratings.filter((r) => r.match_count > 0);
    if (played.length === 0) return ratings[0]?.category ?? null;
    return played.reduce((a, b) => (b.display > a.display ? b : a)).category;
  }, [playerQ.data, selected]);

  const matchesQ = useQuery({
    queryKey: ["matches", playerId, active],
    queryFn: () => listPlayerMatches(playerId, active ?? undefined),
    enabled: active != null,
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
  const heroRating: CategoryRating | undefined = player.ratings.find(
    (r) => r.category === active,
  );

  const verifiedMatches = (matchesQ.data ?? []).filter(
    (m) => m.status === "verified",
  );
  const recentDeltaFor = (cat: RatingCategory): number | null => {
    const last = (matchesQ.data ?? [])
      .filter((m) => m.category === cat && m.status === "verified")
      .at(-1);
    if (!last) return null;
    return last.participants.find((p) => p.player_id === playerId)?.delta_r ?? null;
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 lg:max-w-5xl">
      {/* Header */}
      <header className="space-y-1">
        <p className="text-label uppercase text-text-secondary">
          {player.gender === "M" ? "Men" : player.gender === "W" ? "Women" : "Player"}
        </p>
        <h1 className="text-h1">{player.display_name ?? player.name}</h1>
      </header>

      {/* Hero rating */}
      {heroRating ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-6 shadow-elevation-1">
          <div className="flex items-center justify-between">
            <p className="text-label uppercase text-text-secondary">
              {CATEGORY_LABEL[heroRating.category]}
            </p>
            <CalibrationDot show={isCalibrating(heroRating.rd)} />
          </div>
          <p className="mt-2 text-display-lg sm:text-display-xl">
            {heroRating.match_count > 0 ? formatRating(heroRating.display) : "—"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TierChip rating={heroRating.display} />
            <span className="text-caption text-text-muted">
              {heroRating.match_count} match{heroRating.match_count === 1 ? "" : "es"}
              {heroRating.last_active ? ` · last ${heroRating.last_active}` : ""}
            </span>
          </div>
        </section>
      ) : null}

      {/* Category grid */}
      <section className="mt-8 space-y-3">
        <h2 className="text-h3">All categories</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {player.ratings.map((r) => (
            <RatingTile
              key={r.category}
              rating={r}
              recentDelta={recentDeltaFor(r.category)}
              selected={r.category === active}
              onSelect={setSelected}
            />
          ))}
        </div>
      </section>

      {/* History chart */}
      <section className="mt-8 space-y-3">
        <h2 className="text-h3">
          Rating history
          {active ? (
            <span className="ml-2 text-caption font-normal text-text-muted">
              — {CATEGORY_LABEL[active]}
            </span>
          ) : null}
        </h2>
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
            No matches yet in this category.
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
      <div className="h-40 rounded-xl bg-surface-muted" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl bg-surface-muted" />
        ))}
      </div>
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
