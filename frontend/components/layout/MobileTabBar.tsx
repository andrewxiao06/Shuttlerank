"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listPendingForMe } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * Mobile bottom tab bar. DESIGN.md "Don't" list bans the iPhone home
 * indicator overlap — we pad the container with safe-area-inset-bottom.
 *
 * Center Submit tile sits visually on top via a -translate-y lift so it
 * reads as the FAB the design spec asks for. Inbox tab shows a red dot
 * (not a count number) when pending > 0 — keeps the bar scannable.
 */
type Tab = { href: string; label: string; icon: string; fab?: boolean };

const TABS: readonly Tab[] = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/leaderboard", label: "Board", icon: "☷" },
  { href: "/matches/new", label: "Submit", icon: "+", fab: true },
  { href: "/inbox", label: "Inbox", icon: "⚑" },
  { href: "/players/1", label: "Profile", icon: "◉" },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const pendingQ = useQuery({
    queryKey: ["pending"],
    queryFn: () => listPendingForMe(),
    refetchOnMount: false,
  });
  const hasPending = (pendingQ.data?.length ?? 0) > 0;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-elevation-2 md:hidden">
      <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around px-2">
        {TABS.map((t) => {
          const active = isActive(pathname, t.href);
          const showDot = t.href === "/inbox" && hasPending;

          if (t.fab) {
            return (
              <li key={t.href} className="flex items-center justify-center">
                <Link
                  href={t.href}
                  aria-label={t.label}
                  className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-elevation-2"
                >
                  <span className="text-2xl leading-none">{t.icon}</span>
                </Link>
              </li>
            );
          }

          return (
            <li key={t.href} className="flex flex-1 items-center justify-center">
              <Link
                href={t.href}
                aria-label={t.label}
                className={cn(
                  "relative flex h-full min-w-11 flex-col items-center justify-center gap-0.5 px-2",
                  active ? "text-text-primary" : "text-text-secondary",
                )}
              >
                <span aria-hidden className="text-lg leading-none">
                  {t.icon}
                </span>
                <span className="text-[10px] uppercase tracking-wider">
                  {t.label}
                </span>
                {showDot ? (
                  <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-danger" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
