import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Phases 4-8 run unauthenticated against mocks; phases A-D require auth.
const isProtectedRoute = createRouteMatcher([
  "/inbox(.*)",
  "/matches/new(.*)",
  "/players/me(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
