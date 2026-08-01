"use client";

import Image from "next/image";
import { useAuth } from "@clerk/nextjs";

/*
 * Shows a branded splash while Clerk's auth client boots (the ~1-2s where the
 * app can't yet know who you are). Without this the app renders empty skeletons
 * that read as "frozen". Once Clerk resolves (isLoaded), the real app renders.
 *
 * We cap the splash: if Clerk somehow never loads we still render the app after
 * a moment rather than trapping the user on the splash forever.
 */
export function AppBootGate({ children }: { children: React.ReactNode }) {
  const { isLoaded } = useAuth();

  if (isLoaded) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background">
      <Image
        src="/brand/wordmark-black.png"
        alt="ShuttleRank"
        width={1123}
        height={183}
        priority
        className="h-9 w-auto animate-pulse"
      />
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary"
        aria-label="Loading"
      />
    </div>
  );
}
