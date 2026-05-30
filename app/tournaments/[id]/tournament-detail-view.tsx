"use client";

import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  completeTournament,
  enterTournament,
  generatePairings,
  getMe,
  getTournament,
  withdrawFromTournament,
} from "@/lib/api";
import { CATEGORY_LABEL } from "@/lib/api/types";
import { EntryList } from "@/components/tournament/EntryList";
import { BracketView } from "@/components/tournament/BracketView";

/*
 * Tournament detail — public meta + entry list + bracket. Sign-up CTA
 * for the viewer when registration is open; organizer-only controls
 * (generate pairings, complete) appear when the viewer is the
 * `organizer_user_id`.
 */
export function TournamentDetailView({ tournamentId }: { tournamentId: number }) {
  const qc = useQueryClient();
  const tQ = useQuery({
    queryKey: ["tournament", tournamentId],
    queryFn: () => getTournament(tournamentId),
  });
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });

  const refetch = () =>
    qc.invalidateQueries({ queryKey: ["tournament", tournamentId] });

  const enter = useMutation({
    mutationFn: () => enterTournament(tournamentId),
    onSuccess: refetch,
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawFromTournament(tournamentId),
    onSuccess: refetch,
  });
  const generate = useMutation({
    mutationFn: () => generatePairings(tournamentId),
    onSuccess: refetch,
  });
  const complete = useMutation({
    mutationFn: () => completeTournament(tournamentId),
    onSuccess: refetch,
  });

  if (tQ.isPending) return <Skeleton />;
  if (tQ.isError)
    return (
      <ErrorState
        title="Couldn't load tournament"
        detail={(tQ.error as Error).message}
      />
    );

  const t = tQ.data;
  const myEntry = meQ.data
    ? t.entries.find((e) => e.player_id === meQ.data.id && !e.withdrawn)
    : null;
  const isOrganizer =
    meQ.data?.clerk_user_id != null &&
    t.organizer_user_id === meQ.data.clerk_user_id;

  const canEnter = (t.status === "open" || t.status === "draft") && !myEntry;
  const canWithdraw = !!myEntry && (t.status === "open" || t.status === "draft");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <Link
        href="/tournaments"
        className="inline-block text-caption text-text-secondary underline-offset-2 hover:underline"
      >
        ← All tournaments
      </Link>

      <header className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-label uppercase text-text-secondary">
            {CATEGORY_LABEL[t.category]} · {t.format.replace("_", "-")}
          </p>
          <h1 className="text-h1">{t.name}</h1>
          <p className="mt-1 text-caption text-text-secondary">
            {new Date(t.starts_at).toLocaleString()}
            {t.ends_at ? ` — ${new Date(t.ends_at).toLocaleString()}` : ""}
          </p>
        </div>
        <StatusPill status={t.status} />
      </header>

      <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <p className="text-body-md">
          {t.entries.filter((e) => !e.withdrawn).length} entrant
          {t.entries.filter((e) => !e.withdrawn).length === 1 ? "" : "s"}
        </p>
        <div className="flex gap-2">
          {canEnter ? (
            <button
              type="button"
              disabled={enter.isPending}
              onClick={() => enter.mutate()}
              className="h-11 rounded-md bg-primary px-4 text-body-md text-on-primary disabled:opacity-40"
            >
              {enter.isPending ? "Signing up…" : "Sign up"}
            </button>
          ) : null}
          {canWithdraw ? (
            <button
              type="button"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate()}
              className="h-11 rounded-md border border-border bg-surface px-4 text-body-md hover:bg-surface-muted disabled:opacity-40"
            >
              {withdraw.isPending ? "Withdrawing…" : "Withdraw"}
            </button>
          ) : null}
        </div>
      </section>

      {isOrganizer ? (
        <section className="mt-4 rounded-lg border border-info/30 bg-info/10 p-4">
          <p className="text-label uppercase text-info">Organizer controls</p>
          <p className="mt-1 text-caption text-text-secondary">
            Generating pairings locks registration. Completing the tournament
            triggers ceiling updates for every entrant.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={generate.isPending || t.status !== "open"}
              onClick={() => generate.mutate()}
              className="h-11 rounded-md bg-primary px-4 text-body-md text-on-primary disabled:opacity-40"
            >
              Generate pairings
            </button>
            <button
              type="button"
              disabled={complete.isPending || t.status === "completed"}
              onClick={() => complete.mutate()}
              className="h-11 rounded-md border border-border bg-surface px-4 text-body-md hover:bg-surface-muted disabled:opacity-40"
            >
              Mark complete
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-8 space-y-3">
        <h2 className="text-h3">Entries</h2>
        <EntryList entries={t.entries} />
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-h3">Bracket</h2>
        <BracketView tournament={t} />
      </section>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "border-border bg-surface-muted text-text-secondary",
    open: "border-accent/30 bg-accent-soft text-accent",
    in_progress: "border-info/30 bg-info/10 text-info",
    completed: "border-border bg-surface-muted text-text-secondary",
  };
  const label: Record<string, string> = {
    draft: "Draft",
    open: "Open",
    in_progress: "In progress",
    completed: "Completed",
  };
  return (
    <span
      className={`rounded-full border px-3 py-1 text-label uppercase ${map[status] ?? ""}`}
    >
      {label[status] ?? status}
    </span>
  );
}

function Skeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl animate-pulse space-y-4 p-6">
      <div className="h-8 w-40 rounded bg-surface-muted" />
      <div className="h-24 rounded-lg bg-surface-muted" />
      <div className="h-40 rounded-lg bg-surface-muted" />
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
