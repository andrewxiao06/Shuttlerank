"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useUser } from "@clerk/nextjs";
import { getMe, patchMe } from "@/lib/api";
import { PlayerGenderSchema, type PlayerGender, type CategoryRating } from "@/lib/api/types";
import { pickRatings } from "@/lib/ratings";
import { Avatar } from "@/components/player/Avatar";
import { MatchHistory } from "@/components/player/MatchHistory";
import { TierChip } from "@/components/rating/TierChip";
import { CalibrationDot } from "@/components/rating/CalibrationDot";
import { CeilingBar } from "@/components/rating/CeilingBar";
import { RatingHistoryChart } from "@/components/player/RatingHistoryChart";
import { listPlayerMatches } from "@/lib/api";
import { formatRating } from "@/lib/format";
import { isCalibrating } from "@/lib/tier";
import { cn } from "@/lib/utils";

/*
 * My Profile — the in-depth, editable own-profile page. Shows the rating
 * hero, history chart, and full match history (recent + all), plus an Edit
 * panel for display name, photo, age, location, gender, and (pre-first-match)
 * the starting level. Other players' read-only profile lives at /players/[id].
 */
const GENDER_OPTIONS: { value: PlayerGender; label: string }[] = [
  { value: "M", label: "Man" },
  { value: "W", label: "Woman" },
  { value: "X", label: "Prefer not to say" },
];

const LEVEL_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 1.0, label: "1.0 — Beginner", hint: "Just learning how to rally" },
  { value: 2.0, label: "2.0 — Amateur", hint: "Can play, but no advanced techniques yet" },
  { value: 3.0, label: "3.0 — Recreational", hint: "Can play somewhat competitive games" },
  { value: 3.5, label: "3.5 — Semi-advanced", hint: "Hangs with most except very advanced players" },
  { value: 4.0, label: "4.0 — Advanced", hint: "Plays genuinely competitive games" },
  { value: 4.5, label: "4.5 — Near-competitive", hint: "Almost competes with real competitors (cap)" },
];

export function MeSettingsView() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = params.get("next");

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: isLoaded && !!isSignedIn,
  });

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState<PlayerGender | "">("");
  const [level, setLevel] = useState<number | null>(null);
  const [age, setAge] = useState("");
  const [location, setLocation] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (meQ.data) {
      setDisplayName(meQ.data.display_name ?? meQ.data.name ?? "");
      setGender((meQ.data.gender as PlayerGender | null) ?? "");
      setLevel(meQ.data.ratings[0]?.display ?? null);
      setAge(meQ.data.age != null ? String(meQ.data.age) : "");
      setLocation(meQ.data.location ?? "");
    }
  }, [meQ.data]);

  // New players (no rated match yet) haven't been onboarded — open the editor
  // and route them onward after saving. Existing players land on view mode.
  const { singles, doubles } = pickRatings(meQ.data?.ratings ?? []);
  // Self-pick is allowed only before *any* format has been played.
  const canPickLevel =
    (meQ.data?.ratings ?? []).every((r) => r.match_count === 0);
  useEffect(() => {
    if (next && canPickLevel) setEditing(true);
  }, [next, canPickLevel]);

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
      setEditing(false);
      if (next) router.push(next);
    },
  });

  // Photo upload via Clerk (reuses Clerk's image hosting — no S3 needed),
  // then sync the new URL into our backend so it shows for everyone.
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setPhotoBusy(true);
    try {
      await user.setProfileImage({ file });
      // Reload so user.imageUrl is the FRESH url (Clerk rotates it on change),
      // then persist it and refresh everything that shows an avatar — match
      // rows embed the url too, so a "me"-only invalidation leaves them stale.
      await user.reload();
      await patchMe({ avatar_url: user.imageUrl });
      await qc.invalidateQueries();
    } catch {
      /* surfaced via the photo button staying available */
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!isLoaded || meQ.isPending) return <Skeleton />;
  if (!isSignedIn)
    return <Error title="You need to sign in" detail="Profiles are for signed-in players." />;
  if (meQ.isError)
    return <Error title="Couldn't load your profile" detail={(meQ.error as Error).message} />;

  const me = meQ.data;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 lg:max-w-5xl">
      {/* Header with avatar + change photo */}
      <header className="flex items-center gap-4">
        <div className="relative">
          <Avatar src={me.avatar_url} name={me.display_name ?? me.name} size={72} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-caption shadow-elevation-1 hover:bg-surface-muted disabled:opacity-50"
            aria-label="Change photo"
            title="Change photo"
          >
            {photoBusy ? "…" : "📷"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onPhoto}
            className="hidden"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-label uppercase text-text-secondary">My profile</p>
          <h1 className="text-h1">{me.display_name ?? me.name}</h1>
          {(me.age != null || me.location) ? (
            <p className="text-caption text-text-secondary">
              {[me.age != null ? `${me.age}` : null, me.location].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="h-10 shrink-0 rounded-md border border-border bg-surface px-4 text-body-md hover:bg-surface-muted"
        >
          {editing ? "Close" : "Edit profile"}
        </button>
      </header>

      {/* Edit panel */}
      {editing ? (
        <section className="mt-6 space-y-5 rounded-lg border border-border bg-surface p-5">
          <label className="block">
            <span className="text-label uppercase text-text-secondary">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 120))}
              placeholder="e.g. A. Xiao"
              className="mt-2 block h-12 w-full rounded-md border border-border bg-surface px-3 text-body-md outline-none focus:border-primary"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-label uppercase text-text-secondary">Age</span>
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
              <span className="text-label uppercase text-text-secondary">Location</span>
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
            <legend className="text-label uppercase text-text-secondary">Gender (optional)</legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {GENDER_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    "cursor-pointer rounded-md border p-3 text-center text-body-md",
                    gender === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-surface-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="gender"
                    checked={gender === opt.value}
                    onChange={() => setGender(opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          {canPickLevel ? (
            <fieldset>
              <legend className="text-label uppercase text-text-secondary">Starting level</legend>
              <p className="mt-1 text-caption text-text-muted">
                Rate yourself honestly — results adjust it quickly. You can&apos;t
                change this once you&apos;ve played a match.
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
            </fieldset>
          ) : null}

          {save.isError ? (
            <p className="text-caption text-danger" role="alert">
              Couldn&apos;t save: {(save.error as Error).message}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={!displayName.trim() || save.isPending}
              onClick={() => save.mutate()}
              className="h-11 rounded-md bg-primary px-5 text-body-md text-on-primary disabled:opacity-40"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      ) : null}

      {/* Rating heroes — Singles + Doubles */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <MeRating label="Singles" rating={singles} />
        <MeRating label="Doubles" rating={doubles} />
      </div>

      {/* History chart */}
      <RatingHistorySection playerId={me.id} />

      {/* Match history — recent + all, with rating changes per row */}
      <MatchHistory playerId={me.id} />
    </main>
  );
}

function RatingHistorySection({ playerId }: { playerId: number }) {
  const q = useQuery({
    queryKey: ["matches", playerId],
    queryFn: () => listPlayerMatches(playerId),
  });
  const verified = (q.data ?? []).filter((m) => m.status === "verified");
  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-h3">Rating history</h2>
      {q.isPending ? (
        <div className="h-44 animate-pulse rounded-lg bg-surface-muted" />
      ) : (
        <RatingHistoryChart matches={verified} viewerId={playerId} />
      )}
    </section>
  );
}

function MeRating({
  label,
  rating,
}: {
  label: string;
  rating: CategoryRating | null;
}) {
  const played = (rating?.match_count ?? 0) > 0;
  return (
    <section className="rounded-xl border border-border bg-surface p-6 shadow-elevation-1">
      <div className="flex items-center justify-between">
        <p className="text-label uppercase text-text-secondary">{label}</p>
        <CalibrationDot show={!!rating && isCalibrating(rating.rd)} />
      </div>
      <p className="mt-2 text-display-lg">
        {rating && played ? formatRating(rating.display) : "—"}
      </p>
      {rating ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TierChip rating={rating.display} />
            <span className="text-caption text-text-muted">
              {played
                ? `${rating.match_count} match${rating.match_count === 1 ? "" : "es"}`
                : "Not yet played"}
            </span>
          </div>
          <div className="mt-4">
            <CeilingBar display={rating.display} ceiling={rating.ceiling} />
            <p className="mt-1 text-caption text-text-muted">
              Rating cap {formatRating(rating.ceiling)}
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Skeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl animate-pulse space-y-4 p-6">
      <div className="h-16 w-2/3 rounded bg-surface-muted" />
      <div className="h-48 rounded-xl bg-surface-muted" />
      <div className="h-44 rounded-lg bg-surface-muted" />
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
