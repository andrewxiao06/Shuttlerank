"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { getMe, patchMe } from "@/lib/api";
import { PlayerGenderSchema, type PlayerGender } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/*
 * Settings page — `/me`. The minimum onboarding surface so a brand-new
 * Clerk sign-up can pick their display name and gender, which unlocks
 * every gender-filtered ranked category (M/W Singles, M/W Doubles,
 * Mixed). Casual is open to anyone regardless.
 *
 * Banner-driven onboarding: `?next=...` carries the URL the user was
 * trying to reach. After save we route them back so the gender prompt
 * never costs them more than one extra tap.
 */
const GENDER_OPTIONS: { value: PlayerGender; label: string; hint: string }[] = [
  { value: "M", label: "Men's", hint: "M Singles, M Doubles, Mixed Doubles" },
  { value: "W", label: "Women's", hint: "W Singles, W Doubles, Mixed Doubles" },
  { value: "X", label: "Prefer not to say", hint: "Casual only" },
];

export function MeSettingsView() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = params.get("next") || "/";

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: isLoaded && !!isSignedIn,
  });

  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState<PlayerGender | "">("");

  // Hydrate the form once the player loads. Empty form fields stay empty
  // intentionally — we don't want to overwrite a user's in-progress edit.
  useEffect(() => {
    if (meQ.data) {
      setDisplayName(meQ.data.display_name ?? meQ.data.name ?? "");
      setGender((meQ.data.gender as PlayerGender | null) ?? "");
    }
  }, [meQ.data]);

  const save = useMutation({
    mutationFn: () =>
      patchMe({
        display_name: displayName.trim() || null,
        gender: gender ? PlayerGenderSchema.parse(gender) : null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.push(next);
    },
  });

  if (!isLoaded) return <Skeleton />;
  if (!isSignedIn)
    return (
      <Error
        title="You need to sign in"
        detail="Settings are only available to signed-in players."
      />
    );
  if (meQ.isPending) return <Skeleton />;
  if (meQ.isError)
    return (
      <Error
        title="Couldn't load your profile"
        detail={(meQ.error as Error).message}
      />
    );

  const blocked = !displayName.trim() || !gender;

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-6 sm:px-6">
      <header className="space-y-1">
        <p className="text-label uppercase text-text-secondary">Settings</p>
        <h1 className="text-h1">Your player profile</h1>
        <p className="text-caption text-text-secondary">
          Set how you appear to other players. You can change this at any time.
        </p>
      </header>

      <section className="mt-6 space-y-5 rounded-lg border border-border bg-surface p-5">
        <label className="block">
          <span className="text-label uppercase text-text-secondary">
            Display name
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 120))}
            placeholder="e.g. A. Xiao"
            className="mt-2 block h-12 w-full rounded-md border border-border bg-surface px-3 text-body-md outline-none focus:border-primary"
          />
          <p className="mt-1 text-caption text-text-muted">
            Shown on the leaderboard, in match cards, and on your profile.
          </p>
        </label>

        <fieldset>
          <legend className="text-label uppercase text-text-secondary">
            Category eligibility
          </legend>
          <p className="mt-1 text-caption text-text-muted">
            Picks which ranked categories you can play in. You can always
            play Casual regardless.
          </p>
          <div className="mt-3 space-y-2">
            {GENDER_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                  gender === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-surface-muted",
                )}
              >
                <input
                  type="radio"
                  name="gender"
                  value={opt.value}
                  checked={gender === opt.value}
                  onChange={() => setGender(opt.value)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <div>
                  <p className="text-body-md">{opt.label}</p>
                  <p className="text-caption text-text-muted">{opt.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {save.isError ? (
          <p className="text-caption text-danger" role="alert">
            Couldn&apos;t save: {(save.error as Error).message}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-caption text-text-secondary">
            {blocked
              ? "Display name and category are both required."
              : "Ready to save."}
          </p>
          <button
            type="button"
            disabled={blocked || save.isPending}
            onClick={() => save.mutate()}
            className="h-11 rounded-md bg-primary px-5 text-body-md text-on-primary disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </section>
    </main>
  );
}

function Skeleton() {
  return (
    <main className="mx-auto w-full max-w-xl animate-pulse space-y-4 p-6">
      <div className="h-8 w-40 rounded bg-surface-muted" />
      <div className="h-72 rounded-lg bg-surface-muted" />
    </main>
  );
}

function Error({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-h2">{title}</h1>
      <p className="mt-2 text-caption text-text-secondary">{detail}</p>
    </main>
  );
}
