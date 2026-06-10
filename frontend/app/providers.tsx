"use client";

import { useEffect, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useAuth, useUser } from "@clerk/nextjs";
import { bootstrapMe, getMe } from "@/lib/api";
import { setTokenGetter, setUserId } from "@/lib/api/auth-bridge";

/*
 * Bridges Clerk's `getToken()` and `userId` (both hook-only) into
 * module-level slots the Phase 9 client can read. Re-runs whenever the
 * signed-in state flips so sign-out tears them back down to null.
 *
 * `userId` is the literal Clerk user id (e.g. `user_2abc…`) — the
 * backend dev stub at `api/auth.py` reads this from the
 * `X-Clerk-User-Id` header and looks up the matching Player row.
 */
function ClerkTokenBridge() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  useEffect(() => {
    // Wait for Clerk to settle — calling setUserId(null) prematurely
    // would mark auth-ready and release pending API calls before we
    // know whether a session exists.
    if (!isLoaded) return;
    if (isSignedIn) {
      setTokenGetter(() => getToken());
      setUserId(userId ?? null);
    } else {
      setTokenGetter(null);
      setUserId(null);
    }
  }, [getToken, isLoaded, isSignedIn, userId]);
  return null;
}

/*
 * Site-wide player auto-bootstrap. Runs once whenever a signed-in user
 * is detected; if the backend has no Player row for them
 * (`/players/me` → 403), POST `/v1/players/bootstrap` with their Clerk
 * profile data so they land on a working app instead of a 403.
 *
 * Production: the Clerk `user.created` webhook is the primary path —
 * this hook is a safety net for missed webhooks and a necessity for
 * local dev where Clerk can't reach localhost. The bootstrap endpoint
 * is idempotent, so racing the webhook is harmless.
 */
function PlayerAutoBootstrap() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();
  const qc = useQueryClient();
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId || !user) return;
    if (ranFor.current === userId) return;
    ranFor.current = userId;

    (async () => {
      try {
        await getMe();
        // Player already exists — done.
        return;
      } catch (err) {
        const msg = (err as Error)?.message ?? "";
        // ONLY treat the explicit "no Player row" 403 as bootstrap-worthy.
        // 401s, 5xxs, network errors all fall through — bootstrapping
        // them would loop. Manual refresh re-arms via ranFor reset below.
        if (!msg.includes("no Player row")) {
          ranFor.current = null;
          return;
        }
        try {
          await bootstrapMe({
            name:
              [user.firstName, user.lastName].filter(Boolean).join(" ") ||
              user.username ||
              user.primaryEmailAddress?.emailAddress?.split("@")[0] ||
              "Player",
            display_name: user.firstName ?? null,
            email: user.primaryEmailAddress?.emailAddress ?? null,
          });
          // Invalidate cached queries so screens refetch with the new
          // Player row in scope. Cheaper + safer than a full reload.
          await qc.invalidateQueries();
        } catch {
          // Reset so a manual refresh can retry. Don't auto-loop.
          ranFor.current = null;
        }
      }
    })();
  }, [isLoaded, isSignedIn, userId, user, qc]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        <ClerkTokenBridge />
        <PlayerAutoBootstrap />
        {children}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
