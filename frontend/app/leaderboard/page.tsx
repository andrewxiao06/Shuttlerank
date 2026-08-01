import { Suspense } from "react";
import { LeaderboardView } from "./leaderboard-view";

// LeaderboardView reads useSearchParams (category/page state), so it needs a
// Suspense boundary now that the page is statically prerendered.
export default function LeaderboardPage() {
  return (
    <Suspense>
      <LeaderboardView />
    </Suspense>
  );
}
