/*
 * Team-composition rules. The backend (services/categories.py) is the
 * authoritative gatekeeper; this mirror keeps the submit form from
 * POSTing combinations that would 400.
 *
 * Anyone can play anyone — the only rule left is team size, driven by
 * the singles/doubles format toggle.
 */

import type { PlayerMe } from "./api/types";

export type MatchFormat = "singles" | "doubles";

export interface FormatRules {
  teamSize: 1 | 2;
  hint: string;
}

export function rulesFor(format: MatchFormat): FormatRules {
  return format === "singles"
    ? { teamSize: 1, hint: "Singles — one player per side." }
    : { teamSize: 2, hint: "Doubles — two players per side." };
}

/** Validate a single team against the format. Returns a human error or null. */
export function validateTeam(
  team: PlayerMe[],
  rules: FormatRules,
  side: "A" | "B",
): string | null {
  if (team.length === 0) return `Pick at least one player for Team ${side}.`;
  if (team.length > rules.teamSize)
    return `Team ${side} has too many players.`;
  if (team.length < rules.teamSize)
    return `Team ${side} needs ${rules.teamSize} players.`;
  return null;
}
