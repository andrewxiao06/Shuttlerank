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
 * Clerk sign-up can pick their display name. Gender is optional profile
 * metadata — anyone can play anyone, it gates nothing.
 *
 * Banner-driven onboarding: `?next=...` carries the URL the user was
 * trying to reach. After save we route them back so setup never costs
 * them more than one extra tap.
 */
const GENDER_OPTIONS: { value: PlayerGender; label: string }[] = [
  { value: "M", label: "Man" },
  { value: "W", label: "Woman" },
  { value: "X", label: "Prefer not to say" },
];

/*
 * Starting-level guide. Players self-rate 1.0–4.5; their pick is a starting
 * point with high uncertainty, so results correct it quickly. 5.0+ is
 * locked — it's earned through ranked tournaments or set by an admin.
 */
const LEVEL_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 1.0, label: "1.0 — Beginner", hint: "Just learning how to rally" },
  { value: 2.0, label: "2.0 — Amateur", hint: "Can play, but no advanced techniques yet" },
  { value: 3.0, label: "3.0 — Recreational", hint: "Can play somewhat competitive games" },
  { value: 3.5, label: "3.5 — Semi-advanced", hint: "Can hang with most except very advanced players" },
  { value: 4.0, label: "4.0 — Advanced", hint: "Plays genuinely competitive games" },
  { value: 4.5, label: "4.5 — Near-competitive", hint: "Almost competes with real competitors (casual cap)" },
];

const LOCKED_LEVELS: { label: string; hint: string }[] = [
  { label: "5.0 — Semi-pro", hint: "Coaches, retired athletes, former serious competitors" },
  { label: "6.0 — Pro", hint: "They compete, and they're genuinely good" },
  { label: "6.0+ — Elite", hint: "A league of its own, up to 8.0 (e.g. Viktor Axelsen)" },
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
  const [level, setLevel] = useState<number | null>(null);
  const [age, setAge] = useState("");
  const [location, setLocation] = useState("");

  // Hydrate the form once the player loads. Empty form fields stay empty
  // intentionally — we don't want to overwrite a user's in-progress edit.
  useEffect(() => {
    if (meQ.data) {
      setDisplayName(meQ.data.display_name ?? meQ.data.name ?? "");
      setGender((meQ.data.gender as PlayerGender | null) ?? "");
      setLevel(meQ.data.ratings[0]?.display ?? null);
      setAge(meQ.data.age != null ? String(meQ.data.age) : "");
      setLocation(meQ.data.location ?? "");
    }
  }, [meQ.data]);

  // Self-pick is only allowed before the first rated match.
  const rating = meQ.data?.ratings[0];
  const canPickLevel = (rating?.match_count ?? 0) === 0;

  const save = useMutation({
    mutationFn: () =>
      patchMe({
        display_name: displayName.trim() || null,
        gender: gender ? PlayerGenderSchema.parse(gender) : null,
        age: age.trim() ? Number(age) : null,
        location: location.trim() || null,
        starting_rating: canPickLevel && level != null ? level : undefined,
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

  const blocked = !displayName.trim();

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

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-label uppercase text-text-secondary">
              Age (optional)
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="e.g. 27"
              className="mt-2 block h-12 w-full rounded-md border border-border bg-surface px-3 text-body-md outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="text-label uppercase text-text-secondary">
              Location (optional)
            </span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value.slice(0, 120))}
              placeholder="e.g. NJ, US"
              className="mt-2 block h-12 w-full rounded-md border border-border bg-surface px-3 text-body-md outline-none focus:border-primary"
            />
          </label>
        </div>

        <fieldset>
          <legend className="text-label uppercase text-text-secondary">
            Gender (optional)
          </legend>
          <p className="mt-1 text-caption text-text-muted">
            Shown on your profile. It doesn&apos;t limit who you can play —
            anyone can play anyone.
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
                <p className="text-body-md">{opt.label}</p>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-label uppercase text-text-secondary">
            Starting level
          </legend>
          {canPickLevel ? (
            <>
              <p className="mt-1 text-caption text-text-muted">
                Rate yourself honestly — it&apos;s just a starting point, and
                your results will adjust it quickly. You can&apos;t change this
                once you&apos;ve played a match.
              </p>
              <div className="mt-3 space-y-2">
                {LEVEL_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                      level === opt.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-surface-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name="level"
                      checked={level === opt.value}
                      onChange={() => setLevel(opt.value)}
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <div>
                      <p className="text-body-md">{opt.label}</p>
                      <p className="text-caption text-text-muted">{opt.hint}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="mt-4 text-label uppercase text-text-secondary">
                Earned only through tournaments
              </p>
              <div className="mt-2 space-y-2 opacity-60">
                {LOCKED_LEVELS.map((opt) => (
                  <div
                    key={opt.label}
                    className="flex items-start gap-3 rounded-md border border-dashed border-border p-3"
                  >
                    <span aria-hidden className="mt-0.5 text-text-muted">🔒</span>
                    <div>
                      <p className="text-body-md">{opt.label}</p>
                      <p className="text-caption text-text-muted">{opt.hint}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-1 text-caption text-text-muted">
              Your level is now set by your match results
              {rating ? ` (currently ${rating.display.toFixed(1)})` : ""}. Play
              ranked tournaments to climb above the 4.5 casual cap.
            </p>
          )}
        </fieldset>

        {save.isError ? (
          <p className="text-caption text-danger" role="alert">
            Couldn&apos;t save: {(save.error as Error).message}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-caption text-text-secondary">
            {blocked ? "Display name is required." : "Ready to save."}
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
