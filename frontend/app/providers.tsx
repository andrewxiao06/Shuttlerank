"use client";

import { useEffect, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  bootstrapMe,
  getLeaderboard,
  getMe,
  listPendingForMe,
  listPlayerMatches,
  listTournaments,
} from "@/lib/api";
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
 * Drop every cached query whenever the signed-in Clerk user changes
 * (including sign-out). Without this, switching accounts in the same tab
 * serves the previous user's cached profile/matches for up to staleTime —
 * which looks exactly like two accounts being linked.
 */
function QueryCacheUserScope() {
  const { isLoaded, userId } = useAuth();
  const qc = useQueryClient();
  // undefined = identity not yet observed; null = confirmed signed out.
  const prev = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    const current = userId ?? null;
    if (prev.current !== undefined && prev.current !== current) {
      qc.clear();
    }
    prev.current = current;
  }, [isLoaded, userId, qc]);

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
            avatar_url: user.imageUrl ?? null,
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

/*
 * Warm the caches for the other tabs the moment the app loads, so the first
 * click into Leaderboard / Tournaments / Inbox is instant instead of showing
 * a loading state. Next already prefetches the route JS (static pages); this
 * prefetches their *data*. Fires once per signed-in session.
 */
function RoutePrefetch() {
  const { isLoaded, isSignedIn } = useAuth();
  const qc = useQueryClient();
  const done = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || done.current) return;
    done.current = true;
    void qc.prefetchQuery({
      queryKey: ["tournaments"],
      queryFn: listTournaments,
    });
    void qc.prefetchQuery({
      queryKey: ["pending"],
      queryFn: () => listPendingForMe(),
    });
    void qc.prefetchQuery({
      queryKey: ["leaderboard", 0, false, "singles"],
      queryFn: () =>
        getLeaderboard({
          limit: 25,
          offset: 0,
          hideProvisional: false,
          category: "singles",
        }),
    });
    // Profile (/me) needs the player's match history — warm it once we know
    // the player id (the ["me"] query is already fetched by the nav/banner).
    void (async () => {
      const me = await qc.ensureQueryData({ queryKey: ["me"], queryFn: getMe });
      void qc.prefetchQuery({
        queryKey: ["matches", me.id],
        queryFn: () => listPlayerMatches(me.id),
      });
    })();
  }, [isLoaded, isSignedIn, qc]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Hold data fresh for 5 min so navigating between tabs never
            // refetches within a session — instant, no flash of loading.
            staleTime: 5 * 60_000,
            gcTime: 30 * 60_000,
            refetchOnWindowFocus: false,
            // React Query's default 3x exponential backoff turned a transient
            // 401 into ~7s of "loading". A 401 right after load can be an auth
            // race straggler (Clerk finished hydrating a beat late) — retry it
            // a couple times *quickly*. Other 4xx won't fix via retry, so fail
            // fast. Server/network blips get a short retry.
            retry: (failureCount, error) => {
              const status = (error as { status?: number })?.status;
              if (status === 401) return failureCount < 2;
              if (status !== undefined && status >= 400 && status < 500) {
                return false;
              }
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 1500),
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        <ClerkTokenBridge />
        <QueryCacheUserScope />
        <PlayerAutoBootstrap />
        <RoutePrefetch />
        {children}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
