import type { CategoryRating } from "./api/types";

// Players carry two independent ratings. Pull them out by format, tolerating
// order and (defensively) a legacy single-rating response.
export function pickRatings(ratings: CategoryRating[]): {
  singles: CategoryRating | null;
  doubles: CategoryRating | null;
} {
  const singles =
    ratings.find((r) => r.category === "singles") ?? ratings[0] ?? null;
  const doubles =
    ratings.find((r) => r.category === "doubles") ?? ratings[1] ?? null;
  return { singles, doubles };
}
