import type { PlayerMe, CategoryRating, RatingCategory } from "../api/types";

/*
 * Synthetic players for Phases 4-8 mock layer. Picked to cover:
 *  - A fully-calibrated player with a mix of high/low ratings across categories
 *  - A calibrating player (rd > 150) to exercise the calibration dot
 *  - A capped player whose display sits at the ceiling (ceiling bar = 100%)
 *  - A few opponents at varying tiers to populate the leaderboard
 *
 * Numbers are deliberately spread across the 2.0–8.0 scale so tier color
 * mapping (`lib/tier.ts`) is exercised end to end.
 */

function rating(
  category: RatingCategory,
  display: number,
  opts: { rd?: number; ceiling?: number; matches?: number; lastActive?: string } = {},
): CategoryRating {
  const rd = opts.rd ?? 80;
  return {
    category,
    r: 1500 + (display - 5) * 166.67, // rough inverse of display formula
    rd,
    display,
    tier: "",
    calibrating: rd > 150,
    ceiling: opts.ceiling ?? Math.max(display + 0.4, 4.0),
    match_count: opts.matches ?? 42,
    last_active: opts.lastActive ?? "2026-05-18",
  };
}

export const ME: PlayerMe = {
  id: 1,
  clerk_user_id: "user_demo_andrew",
  name: "Andrew Xiao",
  display_name: "A. Xiao",
  email: "andrewxiaotoo@gmail.com",
  gender: "M",
  created_at: "2026-02-01T12:00:00Z",
  ratings: [
    rating("mens_singles", 4.213, { matches: 68 }),
    rating("mens_doubles", 4.512, { matches: 51 }),
    rating("mixed_doubles", 3.910, { matches: 28 }),
    rating("casual", 4.301, { matches: 120 }),
    rating("womens_singles", 0, { matches: 0, rd: 350 }),
    rating("womens_doubles", 0, { matches: 0, rd: 350 }),
  ],
};

export const OPPONENTS: PlayerMe[] = [
  {
    id: 2,
    clerk_user_id: "user_demo_jpatel",
    name: "Jay Patel",
    display_name: "J. Patel",
    email: null,
    gender: "M",
    created_at: "2026-01-15T12:00:00Z",
    ratings: [
      rating("mens_singles", 3.812, { matches: 33 }),
      rating("mens_doubles", 4.001, { matches: 22 }),
    ],
  },
  {
    id: 3,
    clerk_user_id: "user_demo_mlee",
    name: "Mei Lee",
    display_name: "M. Lee",
    email: null,
    gender: "W",
    created_at: "2026-03-01T12:00:00Z",
    ratings: [
      rating("womens_singles", 5.105, { matches: 41 }),
      rating("mixed_doubles", 4.420, { matches: 18 }),
    ],
  },
  {
    id: 4,
    clerk_user_id: "user_demo_skim",
    name: "Sora Kim",
    display_name: "S. Kim",
    email: null,
    gender: "W",
    created_at: "2026-04-10T12:00:00Z",
    ratings: [
      rating("womens_singles", 3.205, { matches: 9, rd: 210 }), // calibrating
    ],
  },
  {
    id: 5,
    clerk_user_id: "user_demo_dnguyen",
    name: "David Nguyen",
    display_name: "D. Nguyen",
    email: null,
    gender: "M",
    created_at: "2025-11-20T12:00:00Z",
    ratings: [
      rating("mens_singles", 5.987, { matches: 142, ceiling: 5.987 }), // capped
      rating("mens_doubles", 6.110, { matches: 100 }),
    ],
  },
  {
    id: 6,
    clerk_user_id: "user_demo_organizer",
    name: "Coach Reyes",
    display_name: "Coach",
    email: null,
    gender: "X",
    created_at: "2025-09-01T12:00:00Z",
    ratings: [rating("casual", 4.500)],
  },
];

export const ALL_PLAYERS: PlayerMe[] = [ME, ...OPPONENTS];

export function findPlayer(id: number): PlayerMe | undefined {
  return ALL_PLAYERS.find((p) => p.id === id);
}
