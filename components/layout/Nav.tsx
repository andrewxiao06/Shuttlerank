"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { listPendingForMe } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * Top nav (desktop). Mobile uses MobileTabBar; this component hides at
 * <md so the two never compete for vertical real estate.
 */
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/forecast", label: "Forecast" },
  { href: "/inbox", label: "Inbox" },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const pendingQ = useQuery({
    queryKey: ["pending"],
    queryFn: () => listPendingForMe(),
    refetchOnMount: false,
  });
  const inboxCount = pendingQ.data?.length ?? 0;

  return (
    <header className="sticky top-0 z-30 hidden h-16 border-b border-border bg-background/95 backdrop-blur md:block">
      <nav className="mx-auto flex h-full max-w-5xl items-center justify-between gap-6 px-6">
        <Link href="/" className="text-h3 font-semibold tracking-tight">
          DUBR
        </Link>
        <ul className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            const showBadge = l.href === "/inbox" && inboxCount > 0;
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={cn(
                    "relative inline-flex h-10 items-center rounded-md px-3 text-body-md",
                    active
                      ? "bg-surface-muted text-text-primary"
                      : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
                  )}
                >
                  {l.label}
                  {showBadge ? (
                    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-label text-on-accent">
                      {inboxCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3">
          <Link
            href="/matches/new"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-md text-on-primary hover:opacity-90"
          >
            Submit
          </Link>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button
                type="button"
                className="inline-flex h-10 items-center rounded-md px-4 text-body-md text-text-primary hover:bg-surface-muted"
              >
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button
                type="button"
                className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-md text-on-primary hover:opacity-90"
              >
                Sign up
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </nav>
    </header>
  );
}
