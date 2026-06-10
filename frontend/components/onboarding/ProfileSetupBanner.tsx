"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { getMe } from "@/lib/api";

/*
 * Site-wide onboarding nudge. Shows whenever a signed-in player has no
 * gender set on their Player row — without it the M/W/Mixed categories
 * filter them out of every player picker, which would otherwise feel
 * like a silent bug. CTA routes to /me with `?next=` so the user lands
 * back where they were after saving.
 *
 * Suppressed on /me itself to avoid the redundancy of nagging a user
 * who is already on the form.
 */
export function ProfileSetupBanner() {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: isLoaded && !!isSignedIn,
    retry: false,
  });

  if (!isLoaded || !isSignedIn) return null;
  if (pathname?.startsWith("/me")) return null;
  if (!meQ.data) return null;
  if (meQ.data.gender) return null;

  const next = encodeURIComponent(pathname || "/");

  return (
    <div className="border-b border-warning/30 bg-warning-soft">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-4 py-3 text-warning sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="text-body-md">
          <span className="font-semibold">Finish your profile</span>
          <span className="ml-2 text-caption">
            Pick a display name and category eligibility so you can
            record ranked matches.
          </span>
        </div>
        <Link
          href={`/me?next=${next}`}
          className="inline-flex h-10 shrink-0 items-center rounded-md bg-primary px-4 text-body-md text-on-primary hover:opacity-90"
        >
          Set up
        </Link>
      </div>
    </div>
  );
}
