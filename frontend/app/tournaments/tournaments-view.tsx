"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listTournaments } from "@/lib/api";
import { type Tournament } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/*
 * Tournaments browse — split into upcoming and past. Each card surfaces
 * the format, ranked/casual badge, date, and entrant count — enough to
 * decide whether to tap through. Anyone can host a casual tournament.
 */
export function TournamentsView() {
  const q = useQuery({
    queryKey: ["tournaments"],
    queryFn: listTournaments,
  });

  const all = q.data ?? [];
  const upcoming = all.filter((t) => t.status === "open" || t.status === "draft");
  const live = all.filter((t) => t.status === "in_progress");
  const past = all.filter((t) => t.status === "completed");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-label uppercase text-text-secondary">
            Tournaments
          </p>
          <h1 className="text-h1">Find a tournament</h1>
        </div>
        <Link
          href="/tournaments/new"
          className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-body-md text-on-primary"
        >
          Host one
        </Link>
      </header>

      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <p className="mt-6 rounded-lg border border-danger/30 bg-danger-soft p-4 text-caption text-danger">
          Couldn&apos;t load: {(q.error as Error).message}
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          <Group title="Live" tournaments={live} emptyText="Nothing playing right now." />
          <Group title="Upcoming" tournaments={upcoming} emptyText="No tournaments accepting signups." />
          <Group title="Past" tournaments={past} emptyText="No completed tournaments yet." />
        </div>
      )}
    </main>
  );
}

function Group({
  title,
  tournaments,
  emptyText,
}: {
  title: string;
  tournaments: Tournament[];
  emptyText: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-h3">{title}</h2>
      {tournaments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-caption text-text-muted">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-2">
          {tournaments.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tournaments/${t.id}`}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted",
                )}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-h3">
                    {t.name}
                    <RankedBadge ranked={t.ranked} />
                  </p>
                  <p className="text-caption text-text-secondary">
                    {t.format.replace("_", "-")} ·{" "}
                    {new Date(t.starts_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-numeral-md">
                    {t.entries.filter((e) => !e.withdrawn).length}
                  </p>
                  <p className="text-caption text-text-muted">entrants</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RankedBadge({ ranked }: { ranked: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-label uppercase",
        ranked
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-border bg-surface-muted text-text-secondary",
      )}
    >
      {ranked ? "Ranked" : "Casual"}
    </span>
  );
}

function SkeletonList() {
  return (
    <ul className="mt-6 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="h-20 animate-pulse rounded-lg border border-border bg-surface-muted/40"
        />
      ))}
    </ul>
  );
}
