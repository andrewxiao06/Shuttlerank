"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { getMe, listPlayerMatches } from "@/lib/api";
import { FormatRatings } from "@/components/rating/FormatRatings";
import { MatchRow } from "@/components/match/MatchRow";

/*
 * Home dashboard — DESIGN.md Phase D spec: condensed profile hero,
 * three recent matches, three quick-action tiles. The hero promotes
 * the player's best-rated active category as the "headline" rating
 * (same selection rule as Profile screen so the two stay in sync).
 */
export function HomeView() {
  const { isLoaded, isSignedIn } = useAuth();

  // Bootstrap-on-first-load happens in `app/providers.tsx` so every screen
  // — not just home — sees a healthy Player row after sign-in.
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: isLoaded && !!isSignedIn,
    retry: false,
  });
  const playerId = meQ.data?.id;

  const matchesQ = useQuery({
    queryKey: ["matches", playerId],
    queryFn: () => listPlayerMatches(playerId!),
    enabled: playerId != null,
  });

  if (!isLoaded) return <Skeleton />;
  if (!isSignedIn) return <SignedOutHero />;
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
        <div className="mt-3">
          <FormatRatings ratings={me.ratings} />
        </div>
        <Link
          href={`/players/${me.id}`}
          className="mt-4 inline-block text-caption text-text-secondary underline-offset-2 hover:underline"
        >
          View full profile →
        </Link>
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

function SignedOutHero() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <p className="text-label uppercase text-primary">ShuttleRank</p>
      <h1 className="mt-3 text-display-lg">Badminton, rated.</h1>
      <p className="mt-4 max-w-md text-body-md text-text-secondary">
        One rating, every match. Play anyone, get your opponents to approve,
        and climb the ladder — official tournaments count the most.
      </p>
      <div className="mt-8 flex gap-3">
        <SignUpButton mode="modal">
          <button
            type="button"
            className="inline-flex h-12 items-center rounded-md bg-primary px-6 text-body-md text-on-primary hover:opacity-90"
          >
            Create an account
          </button>
        </SignUpButton>
        <SignInButton mode="modal">
          <button
            type="button"
            className="inline-flex h-12 items-center rounded-md border border-border bg-surface px-6 text-body-md text-text-primary hover:bg-surface-muted"
          >
            Sign in
          </button>
        </SignInButton>
      </div>
      <div className="mt-12 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/leaderboard"
          className="rounded-lg border border-border bg-surface p-4 text-left hover:bg-surface-muted"
        >
          <p className="text-h3">Leaderboard</p>
          <p className="text-caption text-text-muted">Browse the club</p>
        </Link>
        <Link
          href="/tournaments"
          className="rounded-lg border border-border bg-surface p-4 text-left hover:bg-surface-muted"
        >
          <p className="text-h3">Tournaments</p>
          <p className="text-caption text-text-muted">Upcoming + past events</p>
        </Link>
        <Link
          href="/forecast"
          className="rounded-lg border border-border bg-surface p-4 text-left hover:bg-surface-muted"
        >
          <p className="text-h3">Forecast</p>
          <p className="text-caption text-text-muted">Who wins?</p>
        </Link>
      </div>
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
