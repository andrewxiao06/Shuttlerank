"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { reportMatch } from "@/lib/api";
import {
  ReportReasonSchema,
  type ReportReason,
} from "@/lib/api/types";

/*
 * Report modal — Phase C, called from any match-detail surface. Reason
 * radios + optional 200-char note (per PLAN.md Phase C). After submit
 * the report POSTs and we close; the caller may invalidate match queries
 * to refresh the "reported by you" indicator.
 *
 * Built as a focus-trapped fixed overlay rather than a shadcn Dialog —
 * keeps the dependency footprint minimal and stays readable on mobile.
 */
const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "wrong_score", label: "Wrong score", hint: "Points or games don't match what was played." },
  { value: "wrong_players", label: "Wrong players", hint: "Someone in this match wasn't actually on court." },
  { value: "never_happened", label: "Never happened", hint: "This match wasn't played at all." },
  { value: "other", label: "Other", hint: "Use the note field to explain." },
];

export function ReportModal({
  matchId,
  open,
  onClose,
}: {
  matchId: number;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>("wrong_score");
  const [description, setDescription] = useState("");

  const submit = useMutation({
    mutationFn: () => reportMatch(matchId, { reason, description }),
    onSuccess: () => onClose(),
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report match"
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md space-y-4 rounded-t-xl border border-border bg-surface p-5 shadow-elevation-3 sm:rounded-xl">
        <header className="flex items-start justify-between">
          <div>
            <h2 className="text-h3">Report this match</h2>
            <p className="text-caption text-text-secondary">
              An organizer will review. Ratings stay frozen meanwhile.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-11 w-11 rounded-md text-text-secondary hover:bg-surface-muted"
          >
            ×
          </button>
        </header>

        <fieldset className="space-y-2">
          <legend className="sr-only">Reason</legend>
          {REASONS.map((r) => (
            <label
              key={r.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-surface-muted"
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() =>
                  setReason(ReportReasonSchema.parse(r.value))
                }
                className="mt-1 h-4 w-4 accent-primary"
              />
              <div className="flex-1">
                <p className="text-body-md">{r.label}</p>
                <p className="text-caption text-text-muted">{r.hint}</p>
              </div>
            </label>
          ))}
        </fieldset>

        <label className="block">
          <span className="text-caption text-text-secondary">
            Note (optional, max 200 chars)
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 200))}
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-body-md outline-none focus:border-primary"
          />
          <p className="mt-1 text-right text-caption text-text-muted">
            {description.length}/200
          </p>
        </label>

        {submit.isError ? (
          <p className="text-caption text-danger" role="alert">
            Couldn&apos;t send: {(submit.error as Error).message}
          </p>
        ) : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-md border border-border px-4 text-body-md"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submit.isPending}
            onClick={() => submit.mutate()}
            className="h-11 rounded-md bg-danger px-4 text-body-md text-on-accent disabled:opacity-40"
          >
            {submit.isPending ? "Sending…" : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}
