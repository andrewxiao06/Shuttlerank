import { useAuth, useUser } from "@clerk/clerk-expo";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { setTokenGetter } from "./api/auth-bridge";
import { bootstrapMe, getMe } from "./api/client";

/*
 * Bridges Clerk into the plain API-client module and auto-bootstraps the
 * player row on first sign-in. Mobile equivalent of the web app's
 * ClerkTokenBridge + PlayerAutoBootstrap (app/providers.tsx).
 *
 * Renders nothing — it's a side-effect component mounted under ClerkProvider.
 */
export function AuthSync() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const qc = useQueryClient();
  const bootstrappedFor = useRef<string | null>(null);

  // Push Clerk's token getter into the API client so every request carries
  // a fresh Bearer token. Tear down on sign-out.
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      setTokenGetter(() => getToken());
    } else {
      setTokenGetter(null);
      bootstrappedFor.current = null;
      qc.clear(); // drop the previous user's cached data on sign-out
    }
  }, [isLoaded, isSignedIn, getToken, qc]);

  // First authenticated load: ensure a Player row exists. /players/me 403s
  // with "no Player row" until bootstrap runs. Idempotent on the backend.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (bootstrappedFor.current === user.id) return;
    bootstrappedFor.current = user.id;

    (async () => {
      try {
        await getMe();
        return; // already exists
      } catch (err) {
        const msg = (err as Error)?.message ?? "";
        if (!msg.includes("no Player row")) {
          bootstrappedFor.current = null; // let a retry happen
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
          await qc.invalidateQueries();
        } catch {
          bootstrappedFor.current = null;
        }
      }
    })();
  }, [isLoaded, isSignedIn, user, qc]);

  return null;
}
