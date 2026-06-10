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
  getMe,
  getPlayer,
  listPendingForMe,
  validateMatch,
} from "@/lib/api";
import {
  CATEGORY_SHORT,
  type CategoryMatch,
  type ValidationAction,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

/*
 * Inbox — DESIGN.md north star: "Approve or dispute pending matches in
 * under 10 seconds." Each card shows the matchup, score, and the
 * auto-verify countdown so the user knows the consequence of doing
 * nothing. Dispute is a one-click action with an optional inline note;
 * we don't push the user into a modal for the common path.
 *
 * Empty state is encouraged ("All caught up!") per PLAN.md Phase A.
 */
export function InboxView() {
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });
  const pendingQ = useQuery({
    queryKey: ["pending"],
    queryFn: () => listPendingForMe(),
  });

  // Pre-fetch player names in parallel for the cards.
  const ids = unique(
    (pendingQ.data ?? []).flatMap((m) => m.participants.map((p) => p.player_id)),
  );
  const players = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["player", id],
      queryFn: () => getPlayer(id),
      enabled: pendingQ.isSuccess,
    })),
  });
  const nameById = (id: number): string => {
    const p = players.find((q) => q.data?.id === id)?.data;
    return p?.display_name ?? p?.name ?? `Player #${id}`;
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="space-y-1">
        <p className="text-label uppercase text-text-secondary">Inbox</p>
        <h1 className="text-h1">Pending matches</h1>
        <p className="text-caption text-text-secondary">
          Approve or dispute matches you&apos;re in before they auto-verify.
        </p>
      </header>

      {pendingQ.isPending ? (
        <SkeletonList />
      ) : pendingQ.isError ? (
        <p className="mt-6 rounded-lg border border-danger/30 bg-danger-soft p-4 text-caption text-danger">
          Couldn&apos;t load inbox: {(pendingQ.error as Error).message}
        </p>
      ) : (pendingQ.data?.length ?? 0) === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-6 space-y-3">
          {pendingQ.data!.map((m) => (
            <li key={m.id}>
              <PendingCard
                match={m}
                viewerId={meQ.data?.id ?? -1}
                nameOf={nameById}
                onActed={() => qc.invalidateQueries({ queryKey: ["pending"] })}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function PendingCard({
  match,
  viewerId,
  nameOf,
  onActed,
}: {
  match: CategoryMatch;
  viewerId: number;
  nameOf: (id: number) => string;
  onActed: () => void;
}) {
  const [showDisputeNote, setShowDisputeNote] = useState(false);
  const [note, setNote] = useState("");

  const me = match.participants.find((p) => p.player_id === viewerId);
  const ourSide = me?.team ?? "A";
  const ourTeam = match.participants
    .filter((p) => p.team === ourSide)
    .map((p) => p.player_id);
  const theirTeam = match.participants
    .filter((p) => p.team !== ourSide)
    .map((p) => p.player_id);
  const ourScore = ourSide === "A" ? match.team_a_score : match.team_b_score;
  const theirScore = ourSide === "A" ? match.team_b_score : match.team_a_score;

  const act = useMutation({
    mutationFn: (action: ValidationAction) =>
      validateMatch(match.id, { action, note: note.trim() || undefined }),
    onSuccess: () => {
      onActed();
      setShowDisputeNote(false);
      setNote("");
    },
  });

  return (
    <article className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-elevation-1">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-label uppercase text-text-secondary">
          {match.category ? CATEGORY_SHORT[match.category] : "Match"} ·{" "}
          {match.played_at}
        </p>
        <span className="text-caption text-warning">
          {autoVerifyIn(match.expires_at)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <SideBlock label="You" names={ourTeam.map(nameOf)} />
        <p className="text-numeral-lg">
          {ourScore}
          <span className="px-2 text-text-muted">–</span>
          {theirScore}
        </p>
        <SideBlock
          label="Them"
          names={theirTeam.map(nameOf)}
          align="right"
        />
      </div>

      {showDisputeNote ? (
        <div className="space-y-2 rounded-md border border-warning/30 bg-warning-soft p-3">
          <label className="block text-caption text-warning">
            Why are you disputing? (optional)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-body-md outline-none focus:border-primary"
              placeholder="e.g. Score was 21-19, not 21-15"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDisputeNote(false)}
              className="h-11 rounded-md border border-border px-3 text-body-md"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => act.mutate("disputed")}
              className="h-11 rounded-md bg-danger px-4 text-body-md text-on-accent disabled:opacity-40"
            >
              {act.isPending ? "Sending…" : "Send dispute"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/matches/${match.id}`}
            className="text-caption text-text-secondary underline-offset-2 hover:underline"
          >
            View match
          </Link>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => setShowDisputeNote(true)}
              className="h-11 rounded-md border border-danger px-4 text-body-md text-danger disabled:opacity-40"
            >
              Dispute
            </button>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => act.mutate("approved")}
              className="h-11 rounded-md bg-accent px-4 text-body-md text-on-accent disabled:opacity-40"
            >
              {act.isPending ? "Approving…" : "Approve"}
            </button>
          </div>
        </div>
      )}

      {act.isError ? (
        <p className="text-caption text-danger" role="alert">
          Couldn&apos;t submit: {(act.error as Error).message}
        </p>
      ) : null}
    </article>
  );
}

function SideBlock({
  label,
  names,
  align = "left",
}: {
  label: string;
  names: string[];
  align?: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className="text-label uppercase text-text-secondary">{label}</p>
      <ul className="mt-0.5 space-y-0.5">
        {names.map((n) => (
          <li key={n} className="truncate text-body-md">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-10 rounded-xl border border-dashed border-border bg-surface p-10 text-center">
      <p className="text-h2">All caught up!</p>
      <p className="mt-2 text-caption text-text-secondary">
        No pending matches need your eyes right now.
      </p>
      <Link
        href="/matches/new"
        className="mt-5 inline-flex h-11 items-center rounded-md bg-primary px-5 text-body-md text-on-primary"
      >
        Submit a match
      </Link>
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="mt-6 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="h-36 animate-pulse rounded-lg border border-border bg-surface-muted/40"
        />
      ))}
    </ul>
  );
}

function autoVerifyIn(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Auto-verifies any moment";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days >= 1) return `Auto-verifies in ${days}d`;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 1) return `Auto-verifies in ${hours}h`;
  return `Auto-verifies in ${Math.max(1, Math.floor(ms / 60000))}m`;
}

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
