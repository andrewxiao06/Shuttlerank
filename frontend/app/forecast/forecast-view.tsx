"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getForecast } from "@/lib/api";
import { type PlayerMe } from "@/lib/api/types";
import { PlayerSearch } from "@/components/player/PlayerSearch";
import { TierChip } from "@/components/rating/TierChip";
import { CalibrationDot } from "@/components/rating/CalibrationDot";
import { formatPercent, formatRating } from "@/lib/format";

/*
 * Forecast — DESIGN.md spec: two player pickers + the big "X%" number.
 * One universal rating means any two players can be compared. The locked
 * semantic for "forecast probability" is `info` (blue), not `accent`, so
 * the headline number uses that.
 *
 * Calibration warning fires when *either* side is still calibrating —
 * the forecast still renders, but the user is told the number is soft.
 */
export function ForecastView() {
  const [you, setYou] = useState<PlayerMe | null>(null);
  const [opp, setOpp] = useState<PlayerMe | null>(null);
  const [category, setCategory] = useState<"singles" | "doubles">("singles");

  const ready = you != null && opp != null && you.id !== opp.id;
  const q = useQuery({
    queryKey: ["forecast", you?.id, opp?.id, category],
    queryFn: () => getForecast(you!.id, opp!.id, category),
    enabled: ready,
  });

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="space-y-1">
        <p className="text-label uppercase text-text-secondary">Forecast</p>
        <h1 className="text-h1">Who wins?</h1>
      </header>

      {/* Singles / Doubles — uses each player's rating for that format */}
      <div className="mt-4 inline-flex rounded-lg border border-border bg-surface p-1">
        {(["singles", "doubles"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={
              "h-9 rounded-md px-4 text-body-md capitalize " +
              (category === c
                ? "bg-primary text-on-primary"
                : "text-text-secondary hover:bg-surface-muted")
            }
          >
            {c}
          </button>
        ))}
      </div>

      <section className="mt-5 space-y-4 rounded-lg border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PlayerSlot label="You" player={you} onPick={setYou} excludeIds={opp ? [opp.id] : []} />
          <PlayerSlot label="Opponent" player={opp} onPick={setOpp} excludeIds={you ? [you.id] : []} />
        </div>
      </section>

      {!ready ? (
        <p className="mt-8 text-center text-caption text-text-muted">
          Pick two players to see the forecast.
        </p>
      ) : q.isPending ? (
        <div className="mt-8 h-40 animate-pulse rounded-xl bg-surface-muted" />
      ) : q.isError ? (
        <p className="mt-8 rounded-lg border border-danger/30 bg-danger-soft p-4 text-caption text-danger">
          Couldn&apos;t calculate: {(q.error as Error).message}
        </p>
      ) : (
        <section className="mt-8 space-y-5">
          <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-elevation-1">
            <p className="text-label uppercase text-text-secondary">
              {you!.display_name ?? you!.name} wins
            </p>
            <p className="mt-2 text-display-xl text-info">
              {formatPercent(q.data.win_probability)}
            </p>
          </div>

          {(q.data.player_calibrating || q.data.opponent_calibrating) ? (
            <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-caption text-warning">
              <CalibrationDot show />
              <span>
                {q.data.player_calibrating && q.data.opponent_calibrating
                  ? "Both players are still calibrating — treat this number as a rough guess."
                  : q.data.player_calibrating
                    ? `${you!.display_name ?? you!.name} is still calibrating — the number will firm up with more matches.`
                    : `${opp!.display_name ?? opp!.name} is still calibrating — the number will firm up with more matches.`}
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Card label={you!.display_name ?? you!.name} rating={q.data.player_display} />
            <Card label={opp!.display_name ?? opp!.name} rating={q.data.opponent_display} />
          </div>
        </section>
      )}
    </main>
  );
}

function PlayerSlot({
  label,
  player,
  onPick,
  excludeIds,
}: {
  label: string;
  player: PlayerMe | null;
  onPick: (p: PlayerMe | null) => void;
  excludeIds: number[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-label uppercase text-text-secondary">{label}</p>
      {player ? (
        <div className="flex min-h-12 items-center justify-between gap-2 rounded-md border border-border bg-surface-muted/40 px-3 py-2">
          <span className="truncate text-body-md">
            {player.display_name ?? player.name}
          </span>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="text-caption text-text-secondary underline-offset-2 hover:underline"
          >
            Change
          </button>
        </div>
      ) : (
        <PlayerSearch onPick={onPick} excludeIds={excludeIds} />
      )}
    </div>
  );
}

function Card({ label, rating }: { label: string; rating: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="truncate text-caption text-text-secondary">{label}</p>
      <p className="mt-1 text-numeral-lg">{formatRating(rating)}</p>
      <div className="mt-2">
        <TierChip rating={rating} />
      </div>
    </div>
  );
}
