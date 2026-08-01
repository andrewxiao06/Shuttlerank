import { clerkMiddleware } from "@clerk/nextjs/server";

/*
 * Clerk middleware — scoped to ONLY the routes that need server-side Clerk.
 *
 * The app is fully client-side auth (ClerkProvider + useAuth/useUser hooks);
 * no page uses server-side `auth()`/`currentUser()`. Running clerkMiddleware
 * on every page made each navigation's RSC request pass through Clerk's
 * production handshake, which returns a 307 redirect — and a 307 can't be
 * prefetched, so Next.js re-fetched every page live through the handshake on
 * each tab switch (the ~3s stall + freeze on bursts).
 *
 * Scoping the matcher to Clerk's own routes (sign-in/up, the __clerk handshake
 * callbacks) lets the app's static pages be prefetched and navigated instantly.
 * Client-side Clerk manages the session independently of this middleware, and
 * the API (separate FastAPI service) enforces auth on every endpoint.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/__clerk/(.*)",
    "/(api|trpc)(.*)",
  ],
};
