import type { CategoryRating } from "@/lib/api/types";

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

export type LabeledRating = { label: "Singles" | "Doubles"; rating: CategoryRating | null };

// Order the two formats by how much the player actually plays them, so the
// most-played rating leads. Singles wins ties (stable sort keeps it first).
export function orderedByPlay(ratings: CategoryRating[]): [LabeledRating, LabeledRating] {
  const { singles, doubles } = pickRatings(ratings);
  const items: LabeledRating[] = [
    { label: "Singles", rating: singles },
    { label: "Doubles", rating: doubles },
  ];
  items.sort((a, b) => (b.rating?.match_count ?? 0) - (a.rating?.match_count ?? 0));
  return [items[0], items[1]];
}
