"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMe, listPlayerMatches } from "@/lib/api";
import {
  CATEGORY_LABEL,
  type CategoryRating,
} from "@/lib/api/types";
import { TierChip } from "@/components/rating/TierChip";
import { CalibrationDot } from "@/components/rating/CalibrationDot";
import { MatchRow } from "@/components/match/MatchRow";
import { formatRating } from "@/lib/format";
import { isCalibrating } from "@/lib/tier";

/*
 * Home dashboard — DESIGN.md Phase D spec: condensed profile hero,
 * three recent matches, three quick-action tiles. The hero promotes
 * the player's best-rated active category as the "headline" rating
 * (same selection rule as Profile screen so the two stay in sync).
 */
export function HomeView() {
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });
  const playerId = meQ.data?.id;

  const matchesQ = useQuery({
    queryKey: ["matches", playerId],
    queryFn: () => listPlayerMatches(playerId!),
    enabled: playerId != null,
  });

  const hero: CategoryRating | null = useMemo(() => {
    const played = (meQ.data?.ratings ?? []).filter((r) => r.match_count > 0);
    if (played.length === 0) return meQ.data?.ratings[0] ?? null;
    return played.reduce((a, b) => (b.display > a.display ? b : a));
  }, [meQ.data]);

  if (meQ.isPending) return <Skeleton />;
  if (meQ.isError)
    return (
      <ErrorState
        title="Couldn't load your profile"
        detail={(meQ.error as Error).message}
      />
    );

  const me = meQ.data;
  const recent = (matchesQ.data ?? [])
    .slice()
    .sort((a, b) => b.played_at.localeCompare(a.played_at))
    .slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6 sm:px-6">
      {/* Hero — condensed profile */}
      <section className="rounded-xl border border-border bg-surface p-6 shadow-elevation-1">
        <p className="text-label uppercase text-text-secondary">
          {me.display_name ?? me.name}
        </p>
        {hero ? (
          <>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <p className="text-display-lg">
                {hero.match_count > 0 ? formatRating(hero.display) : "—"}
              </p>
              <CalibrationDot show={isCalibrating(hero.rd)} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <TierChip rating={hero.display} />
              <span className="text-caption text-text-muted">
                {CATEGORY_LABEL[hero.category]} · {hero.match_count} match
                {hero.match_count === 1 ? "" : "es"}
              </span>
            </div>
            <Link
              href={`/players/${me.id}`}
              className="mt-4 inline-block text-caption text-text-secondary underline-offset-2 hover:underline"
            >
              View full profile →
            </Link>
          </>
        ) : null}
      </section>

      {/* Quick actions */}
      <section className="mt-6 grid grid-cols-3 gap-3">
        <QuickAction href="/matches/new" label="Submit" hint="Record a result" />
        <QuickAction href="/leaderboard" label="Board" hint="Who's on top" />
        <QuickAction href="/forecast" label="Forecast" hint="Who wins?" />
      </section>

      {/* Recent matches */}
      <section className="mt-8 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-h3">Recent matches</h2>
          <Link
            href={`/players/${me.id}`}
            className="text-caption text-text-secondary underline-offset-2 hover:underline"
          >
            See all
          </Link>
        </div>
        {matchesQ.isPending ? (
          <SkeletonList />
        ) : recent.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-caption text-text-muted">
            No matches yet — submit your first one.
          </p>
        ) : (
          <ul className="space-y-2">
            {recent.map((m) => (
              <li key={m.id}>
                <MatchRow
                  match={m}
                  viewerId={me.id}
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

function QuickAction({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex h-24 flex-col justify-between rounded-lg border border-border bg-surface p-3 hover:bg-surface-muted"
    >
      <span className="text-h3">{label}</span>
      <span className="text-caption text-text-muted">{hint}</span>
    </Link>
  );
}

function Skeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl animate-pulse space-y-4 p-6">
      <div className="h-40 rounded-xl bg-surface-muted" />
      <div className="grid grid-cols-3 gap-3">
        <div className="h-24 rounded-lg bg-surface-muted" />
        <div className="h-24 rounded-lg bg-surface-muted" />
        <div className="h-24 rounded-lg bg-surface-muted" />
      </div>
    </main>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="h-20 animate-pulse rounded-lg bg-surface-muted/40"
        />
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
