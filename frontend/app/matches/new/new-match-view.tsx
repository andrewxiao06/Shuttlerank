"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { createMatch } from "@/lib/api";
import {
  CATEGORY_LABEL,
  CategoryMatchCreateSchema,
  type PlayerMe,
  type RatingCategory,
} from "@/lib/api/types";
import { CategorySelector } from "@/components/rating/CategorySelector";
import { PlayerSearch } from "@/components/player/PlayerSearch";
import { rulesFor, validateTeam } from "@/lib/match-rules";
import { cn } from "@/lib/utils";

/*
 * Submit match — DESIGN.md north star: "Give me my rating change in
 * under 30 seconds." All three steps live on one page (no router push
 * between steps) so the user can scroll up and edit any field freely.
 *
 * Validation strategy: the form is always submittable iff the Zod schema
 * plus per-category gender rules pass. Errors render inline next to the
 * offending field so PLAN.md's "tied scores blocked inline" acceptance
 * is satisfied without a toast.
 */
export function NewMatchView() {
  const router = useRouter();
  const [category, setCategory] = useState<RatingCategory>("mens_singles");
  const rules = rulesFor(category);

  const [teamA, setTeamA] = useState<PlayerMe[]>([]);
  const [teamB, setTeamB] = useState<PlayerMe[]>([]);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [playedAt, setPlayedAt] = useState(() => isoToday());

  // Drop selected players whenever category rules change — avoids stale
  // ineligible picks (e.g. a male player carried into women's singles).
  const resetTeams = (next: RatingCategory) => {
    setCategory(next);
    setTeamA([]);
    setTeamB([]);
  };

  const teamAError = validateTeam(teamA, rules, "A");
  const teamBError = validateTeam(teamB, rules, "B");

  const payload = useMemo(
    () => ({
      category,
      played_at: playedAt,
      team_a_player_ids: teamA.map((p) => p.id),
      team_b_player_ids: teamB.map((p) => p.id),
      team_a_score: Number(scoreA),
      team_b_score: Number(scoreB),
    }),
    [category, playedAt, teamA, teamB, scoreA, scoreB],
  );

  const zod = CategoryMatchCreateSchema.safeParse(payload);
  const scoreError = zod.success
    ? null
    : zod.error.issues.find((i) => String(i.path[0]).startsWith("team_"))?.message ?? null;

  const blocked = teamAError ?? teamBError ?? scoreError;
  const ready = !blocked && scoreA !== "" && scoreB !== "";

  const submit = useMutation({
    mutationFn: () => createMatch(payload),
    onSuccess: (m) => router.push(`/matches/${m.id}`),
  });

  const isCasual = category === "casual";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-32 pt-6 sm:px-6">
      <header className="space-y-1">
        <p className="text-label uppercase text-text-secondary">Submit match</p>
        <h1 className="text-h1">Record a result</h1>
      </header>

      {/* Step 1 — category */}
      <Section title="1. Category">
        <CategorySelector value={category} onChange={resetTeams} />
        <p
          className={cn(
            "mt-3 rounded-md border px-3 py-2 text-caption",
            isCasual
              ? "border-accent/30 bg-accent-soft text-accent"
              : "border-warning/30 bg-warning-soft text-warning",
          )}
        >
          {isCasual
            ? "Casual matches verify instantly. Anyone in the match can report it later."
            : "Both teams will need to approve. Auto-verifies in 7 days if no one disputes."}
        </p>
        <p className="mt-2 text-caption text-text-muted">{rules.hint}</p>
      </Section>

      {/* Step 2 — teams */}
      <Section title="2. Players">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TeamPicker
            label="Team A"
            players={teamA}
            onChange={setTeamA}
            maxSize={rules.teamSize}
            eligibleGenders={rules.allowedGenders}
            excludeIds={teamB.map((p) => p.id)}
            error={teamAError}
          />
          <TeamPicker
            label="Team B"
            players={teamB}
            onChange={setTeamB}
            maxSize={rules.teamSize}
            eligibleGenders={rules.allowedGenders}
            excludeIds={teamA.map((p) => p.id)}
            error={teamBError}
          />
        </div>
      </Section>

      {/* Step 3 — score */}
      <Section title="3. Score">
        <div className="grid grid-cols-2 gap-4">
          <ScoreInput
            label="Team A"
            value={scoreA}
            onChange={setScoreA}
          />
          <ScoreInput
            label="Team B"
            value={scoreB}
            onChange={setScoreB}
          />
        </div>
        <label className="mt-4 block">
          <span className="text-caption text-text-secondary">Played on</span>
          <input
            type="date"
            value={playedAt}
            max={isoToday()}
            onChange={(e) => setPlayedAt(e.target.value)}
            className="mt-1 block h-12 w-full rounded-md border border-border bg-surface px-3 text-body-md outline-none focus:border-primary"
          />
        </label>
        {scoreError ? (
          <p className="mt-3 text-caption text-danger" role="alert">
            {scoreError}
          </p>
        ) : null}
      </Section>

      {/* Submit */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] pt-3 shadow-elevation-2 sm:static sm:mt-8 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 sm:px-0">
          <p className="text-caption text-text-secondary">
            {blocked ?? (ready
              ? `Ready to submit — ${CATEGORY_LABEL[category]}`
              : "Fill in scores to continue")}
          </p>
          <button
            type="button"
            disabled={!ready || submit.isPending}
            onClick={() => submit.mutate()}
            className="h-12 shrink-0 rounded-md bg-primary px-6 text-body-md text-on-primary disabled:opacity-40"
          >
            {submit.isPending ? "Submitting…" : "Submit match"}
          </button>
        </div>
        {submit.isError ? (
          <p className="mx-auto mt-2 max-w-2xl px-4 text-caption text-danger sm:px-0">
            Couldn&apos;t submit: {(submit.error as Error).message}
          </p>
        ) : null}
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-h3">{title}</h2>
      <div className="rounded-lg border border-border bg-surface p-4">
        {children}
      </div>
    </section>
  );
}

function TeamPicker({
  label,
  players,
  onChange,
  maxSize,
  eligibleGenders,
  excludeIds,
  error,
}: {
  label: string;
  players: PlayerMe[];
  onChange: (next: PlayerMe[]) => void;
  maxSize: 1 | 2;
  eligibleGenders: PlayerMe["gender"][] | null;
  excludeIds: number[];
  error: string | null;
}) {
  const canAdd = players.length < maxSize;

  return (
    <div className="space-y-2">
      <p className="text-label uppercase text-text-secondary">{label}</p>
      <ul className="space-y-2">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border bg-surface-muted/40 px-3 py-2 text-body-md"
          >
            <span className="truncate">{p.display_name ?? p.name}</span>
            <button
              type="button"
              onClick={() => onChange(players.filter((x) => x.id !== p.id))}
              className="text-caption text-text-secondary underline-offset-2 hover:underline"
              aria-label={`Remove ${p.name}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {canAdd ? (
        <PlayerSearch
          onPick={(p) => onChange([...players, p])}
          eligibleGenders={
            eligibleGenders ? (eligibleGenders.filter(Boolean) as ("M" | "W" | "X")[]) : null
          }
          excludeIds={[...excludeIds, ...players.map((p) => p.id)]}
          placeholder={maxSize === 1 ? "Add player" : "Add player…"}
        />
      ) : null}
      {error ? (
        <p className="text-caption text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ScoreInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-label uppercase text-text-secondary">{label}</span>
      {/*
       * Number-pad input on mobile (DESIGN.md Components → Score input)
       * but we don't auto-advance to the next field — coaches retype
       * after typos, per DESIGN.md "Don't auto-advance the score input."
       */}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        className="mt-1 block h-14 w-full rounded-md border border-border bg-surface text-center text-numeral-lg outline-none focus:border-primary"
        placeholder="0"
      />
    </label>
  );
}

function isoToday(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
