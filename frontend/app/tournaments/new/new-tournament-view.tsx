"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createTournament, getMe } from "@/lib/api";
import { type TournamentFormat } from "@/lib/api/types";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";

/*
 * Host a tournament. Anyone can host a casual tournament; the Ranked
 * toggle only appears for admins (backend enforces it regardless —
 * ranked tournaments carry full rating weight and unlock ceilings).
 */
const FORMAT_OPTIONS: SearchableOption<TournamentFormat>[] = [
  { value: "single_elim", label: "Single elimination", hint: "Bracket, lose once and you're out" },
  { value: "round_robin", label: "Round robin", hint: "Everyone plays everyone" },
  { value: "swiss", label: "Swiss", hint: "Paired by record each round" },
];

export function NewTournamentView() {
  const router = useRouter();
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });
  const isAdmin = meQ.data?.is_admin ?? false;

  const [name, setName] = useState("");
  const [format, setFormat] = useState<TournamentFormat | null>(null);
  const [ranked, setRanked] = useState(false);
  const [startsAt, setStartsAt] = useState("");

  const ready = name.trim().length > 0 && format != null && startsAt !== "";

  const submit = useMutation({
    mutationFn: () =>
      createTournament({
        name: name.trim(),
        format: format!,
        ranked: isAdmin && ranked,
        starts_at: new Date(startsAt).toISOString(),
      }),
    onSuccess: (t) => router.push(`/tournaments/${t.id}`),
  });

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-6 sm:px-6">
      <header className="space-y-1">
        <p className="text-label uppercase text-text-secondary">Tournaments</p>
        <h1 className="text-h1">Host a tournament</h1>
        <p className="text-caption text-text-secondary">
          Anyone can host a casual tournament. Ranked tournaments are run by
          administrators and count the most toward ratings.
        </p>
      </header>

      <section className="mt-6 space-y-5 rounded-lg border border-border bg-surface p-5">
        <label className="block">
          <span className="text-label uppercase text-text-secondary">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 200))}
            placeholder="e.g. Friday Night Smash"
            className="mt-2 block h-12 w-full rounded-md border border-border bg-surface px-3 text-body-md outline-none focus:border-primary"
          />
        </label>

        <div>
          <p className="text-label uppercase text-text-secondary">Format</p>
          <SearchableSelect
            className="mt-2"
            value={format}
            options={FORMAT_OPTIONS}
            onChange={setFormat}
            placeholder="Pick a format…"
          />
        </div>

        <label className="block">
          <span className="text-label uppercase text-text-secondary">
            Starts
          </span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="mt-2 block h-12 w-full rounded-md border border-border bg-surface px-3 text-body-md outline-none focus:border-primary"
          />
        </label>

        {isAdmin ? (
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border p-3",
              ranked
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-surface-muted",
            )}
          >
            <input
              type="checkbox"
              checked={ranked}
              onChange={(e) => setRanked(e.target.checked)}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <div>
              <p className="text-body-md">Ranked tournament</p>
              <p className="text-caption text-text-muted">
                Full rating weight; completing it raises entrants&apos; rating
                ceilings. Admin only.
              </p>
            </div>
          </label>
        ) : (
          <p className="rounded-md border border-border bg-surface-muted/40 p-3 text-caption text-text-muted">
            This will be a casual tournament. Ranked tournaments are created
            by administrators.
          </p>
        )}

        {submit.isError ? (
          <p className="text-caption text-danger" role="alert">
            Couldn&apos;t create: {(submit.error as Error).message}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-caption text-text-secondary">
            {ready ? "Ready to create." : "Name, format, and start time are required."}
          </p>
          <button
            type="button"
            disabled={!ready || submit.isPending}
            onClick={() => submit.mutate()}
            className="h-11 rounded-md bg-primary px-5 text-body-md text-on-primary disabled:opacity-40"
          >
            {submit.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </section>
    </main>
  );
}
