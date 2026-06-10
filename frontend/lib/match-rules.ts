/*
 * Per-category team-composition rules. The backend
 * (services/categories.py) is the authoritative gatekeeper; this mirror
 * keeps the submit form from POSTing combinations that would 422.
 *
 * Mixed doubles requires 1M + 1W per team — locked by V1 product req #2.
 * Casual accepts any gender mix (the "we just want to play" use case).
 */

import type { PlayerGender, PlayerMe, RatingCategory } from "./api/types";

export interface CategoryRules {
  teamSize: 1 | 2;
  /** Genders allowed on a team. null = any (casual). */
  allowedGenders: PlayerGender[] | null;
  /** Mixed-doubles: each team must include both genders listed. */
  requireBothGenders: boolean;
  hint: string;
}

export function rulesFor(category: RatingCategory): CategoryRules {
  switch (category) {
    case "mens_singles":
      return {
        teamSize: 1,
        allowedGenders: ["M"],
        requireBothGenders: false,
        hint: "Men's singles — one player per side.",
      };
    case "womens_singles":
      return {
        teamSize: 1,
        allowedGenders: ["W"],
        requireBothGenders: false,
        hint: "Women's singles — one player per side.",
      };
    case "mens_doubles":
      return {
        teamSize: 2,
        allowedGenders: ["M"],
        requireBothGenders: false,
        hint: "Men's doubles — two men per side.",
      };
    case "womens_doubles":
      return {
        teamSize: 2,
        allowedGenders: ["W"],
        requireBothGenders: false,
        hint: "Women's doubles — two women per side.",
      };
    case "mixed_doubles":
      return {
        teamSize: 2,
        allowedGenders: ["M", "W"],
        requireBothGenders: true,
        hint: "Mixed doubles — each side must have one man and one woman.",
      };
    case "casual":
      return {
        teamSize: 2, // start at doubles; submit allows reducing to 1 each
        allowedGenders: null,
        requireBothGenders: false,
        hint: "Casual — any combination of genders, singles or doubles.",
      };
  }
}

/** Validate a single team against the category. Returns a human error or null. */
export function validateTeam(
  team: PlayerMe[],
  rules: CategoryRules,
  side: "A" | "B",
): string | null {
  if (team.length === 0) return `Pick at least one player for Team ${side}.`;
  if (team.length > 2) return `Team ${side} has too many players.`;
  if (rules.teamSize === 1 && team.length !== 1)
    return `Team ${side} must have exactly one player.`;

  if (rules.allowedGenders) {
    const bad = team.find(
      (p) => p.gender == null || !rules.allowedGenders!.includes(p.gender),
    );
    if (bad)
      return `${bad.display_name ?? bad.name} isn't eligible for this category.`;
  }

  if (rules.requireBothGenders) {
    const hasM = team.some((p) => p.gender === "M");
    const hasW = team.some((p) => p.gender === "W");
    if (!hasM || !hasW)
      return `Team ${side} must include one man and one woman.`;
  }

  return null;
}
