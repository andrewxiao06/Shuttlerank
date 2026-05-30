"use client";

import Link from "next/link";
import { useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getMatch,
  getMe,
  getPlayer,
  validateMatch,
} from "@/lib/api";
import {
  CATEGORY_LABEL,
  type MatchParticipant,
} from "@/lib/api/types";
import { StatusBanner } from "@/components/match/StatusBanner";
import { ReportModal } from "@/components/match/ReportModal";
import { DeltaPill } from "@/components/match/DeltaPill";
import { cn } from "@/lib/utils";
import { formatRating } from "@/lib/format";

/*
 * Match detail — DESIGN.md spec:
 *   • scoreboard at the top
 *   • status banner with auto-verify countdown
 *   • approve/dispute controls when the viewer is a pending participant
 *   • per-participant rating change rows (pre → post + delta pill)
 *   • report button → ReportModal
 *
 * Player names are fetched per participant via parallel `getPlayer`
 * queries. With the mock there are at most four participants per match;
 * Phase 9 will swap to a batch endpoint if the real backend supports it.
 */
export function MatchDetailView({ matchId }: { matchId: number }) {
  const qc = useQueryClient();
  const [reportOpen, setReportOpen] = useState(false);

  const matchQ = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => getMatch(matchId),
  });
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });

  const participantIds = matchQ.data?.participants.map((p) => p.player_id) ?? [];
  const playerQs = useQueries({
    queries: participantIds.map((id) => ({
      queryKey: ["player", id],
      queryFn: () => getPlayer(id),
      enabled: matchQ.isSuccess,
    })),
  });
  const playerNameById = (id: number): string => {
    const found = playerQs.find((q) => q.data?.id === id)?.data;
    return found?.display_name ?? found?.name ?? `Player #${id}`;
  };

  const validate = useMutation({
    mutationFn: (action: "approved" | "disputed") =>
      validateMatch(matchId, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["match", matchId] }),
  });

  if (matchQ.isPending) return <Skeleton />;
  if (matchQ.isError)
    return (
      <ErrorState
        title="Couldn't load this match"
        detail={(matchQ.error as Error).message}
      />
    );

  const match = matchQ.data;
  const teamA = match.participants.filter((p) => p.team === "A");
  const teamB = match.participants.filter((p) => p.team === "B");
  const winnerSide = match.winner_team;
  const meIsParticipant =
    meQ.data != null &&
    match.participants.some((p) => p.player_id === meQ.data.id);
  const canValidate = match.status === "pending" && meIsParticipant;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <Link
        href="/leaderboard"
        className="inline-block text-caption text-text-secondary underline-offset-2 hover:underline"
      >
        ← Back
      </Link>

      <header className="mt-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-label uppercase text-text-secondary">
            {match.category ? CATEGORY_LABEL[match.category] : "Match"}
          </p>
          <h1 className="text-h1">Match #{match.id}</h1>
        </div>
        <p className="text-caption text-text-muted">{match.played_at}</p>
      </header>

      {/* Scoreboard */}
      <section className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border bg-surface p-5 shadow-elevation-1">
        <Side
          label="Team A"
          names={teamA.map((p) => playerNameById(p.player_id))}
          won={winnerSide === "A"}
        />
        <div className="text-center">
          <p className="text-display-lg">
            {match.team_a_score}
            <span className="px-2 text-text-muted">–</span>
            {match.team_b_score}
          </p>
        </div>
        <Side
          label="Team B"
          names={teamB.map((p) => playerNameById(p.player_id))}
          won={winnerSide === "B"}
          align="right"
        />
      </section>

      {/* Status */}
      <div className="mt-4">
        <StatusBanner status={match.status} expiresAt={match.expires_at} />
      </div>

      {/* Validation actions — only when viewer can act */}
      {canValidate ? (
        <section className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-md">
            Does this match record look right?
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={validate.isPending}
              onClick={() => validate.mutate("disputed")}
              className="h-11 rounded-md border border-danger px-4 text-body-md text-danger disabled:opacity-40"
            >
              Dispute
            </button>
            <button
              type="button"
              disabled={validate.isPending}
              onClick={() => validate.mutate("approved")}
              className="h-11 rounded-md bg-accent px-4 text-body-md text-on-accent disabled:opacity-40"
            >
              Approve
            </button>
          </div>
        </section>
      ) : null}

      {/* Per-participant rating changes */}
      <section className="mt-6 space-y-3">
        <h2 className="text-h3">Rating changes</h2>
        <ul className="overflow-hidden rounded-lg border border-border bg-surface">
          {match.participants.map((p) => (
            <li
              key={`${p.team}-${p.player_id}`}
              className="grid grid-cols-[2.5rem_1fr_auto_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span className="text-label uppercase text-text-secondary">
                {p.team}
              </span>
              <Link
                href={`/players/${p.player_id}`}
                className="truncate text-body-md hover:underline"
              >
                {playerNameById(p.player_id)}
              </Link>
              <span className="text-caption text-text-secondary tabular-nums">
                {formatPrePost(p)}
              </span>
              {match.status === "verified" ? (
                <DeltaPill delta={p.delta_r} />
              ) : (
                <span className="text-caption text-text-muted">—</span>
              )}
            </li>
          ))}
        </ul>
        {match.status === "pending" ? (
          <p className="text-caption text-text-muted">
            Rating changes are calculated when the match verifies.
          </p>
        ) : null}
      </section>

      {/* Report */}
      <section className="mt-8 flex items-center justify-between rounded-lg border border-dashed border-border p-4">
        <p className="text-caption text-text-secondary">
          Something off with this match?
        </p>
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="h-11 rounded-md border border-border bg-surface px-4 text-body-md hover:bg-surface-muted"
        >
          Report
        </button>
      </section>

      <ReportModal
        matchId={matchId}
        open={reportOpen}
        onClose={() => setReportOpen(false)}
      />
    </main>
  );
}

function Side({
  label,
  names,
  won,
  align = "left",
}: {
  label: string;
  names: string[];
  won: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0 space-y-1", align === "right" && "text-right")}>
      <p
        className={cn(
          "text-label uppercase",
          won ? "text-accent" : "text-text-secondary",
        )}
      >
        {label} {won ? "· won" : ""}
      </p>
      <ul className="space-y-0.5">
        {names.length === 0 ? (
          <li className="truncate text-body-md text-text-muted">…</li>
        ) : (
          names.map((n) => (
            <li key={n} className="truncate text-body-md">
              {n}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function formatPrePost(p: MatchParticipant): string {
  if (p.pre_r === p.post_r) return formatRating(p.pre_r);
  return `${formatRating(p.pre_r)} → ${formatRating(p.post_r)}`;
}

function Skeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl animate-pulse space-y-4 p-6">
      <div className="h-8 w-40 rounded bg-surface-muted" />
      <div className="h-40 rounded-xl bg-surface-muted" />
      <div className="h-16 rounded-lg bg-surface-muted" />
      <div className="h-64 rounded-lg bg-surface-muted" />
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

