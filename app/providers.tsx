"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useAuth } from "@clerk/nextjs";
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
  const { getToken, isSignedIn, userId } = useAuth();
  useEffect(() => {
    if (isSignedIn) {
      setTokenGetter(() => getToken());
      setUserId(userId ?? null);
    } else {
      setTokenGetter(null);
      setUserId(null);
    }
    return () => {
      setTokenGetter(null);
      setUserId(null);
    };
  }, [getToken, isSignedIn, userId]);
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
        {children}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
