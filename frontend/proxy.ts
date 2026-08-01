import { clerkMiddleware } from "@clerk/nextjs/server";

/*
 * Clerk middleware — establishes auth context, but intentionally does NOT
 * server-side redirect ("protect") the app routes.
 *
 * Why: production Clerk runs a strict cross-domain session handshake. When the
 * served domain and Clerk's configured domain differ (e.g. Vercel serving
 * `www.` while Clerk is bound to the apex), a server-side `auth.protect()`
 * can't confirm the session on the "wrong" domain and redirects to sign-in —
 * which redirects back — an infinite loop that blanks protected pages
 * (Submit, Inbox). The client-side Clerk session works fine, and every API
 * endpoint independently requires a valid Clerk token (401 otherwise), so
 * gating is enforced without a fragile server-side redirect.
 *
 * The proper alignment fix is to make the served domain match Clerk's domain
 * (apex vs www) in Vercel's domain settings; removing the redirect here keeps
 * the app usable regardless.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
