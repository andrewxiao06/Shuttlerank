import type { CategoryMatch, RatingCategory } from "../api/types";

function match(
  id: number,
  category: RatingCategory,
  args: {
    played_at: string;
    a: number[];
    b: number[];
    scoreA: number;
    scoreB: number;
    deltas: Record<number, number>;
    pre: Record<number, number>;
    status?: CategoryMatch["status"];
    tournament_id?: number | null;
  },
): CategoryMatch {
  const { played_at, a, b, scoreA, scoreB, deltas, pre } = args;
  const status = args.status ?? "verified";
  const winner_team = scoreA > scoreB ? "A" : "B";
  const verified_at =
    status === "verified" ? `${played_at}T20:00:00Z` : null;
  const expires_at =
    status === "pending" ? `${played_at}T20:00:00Z` : null;

  return {
    id,
    category,
    status,
    played_at,
    team_a_score: scoreA,
    team_b_score: scoreB,
    winner_team,
    submitted_by_user_id: "user_demo_andrew",
    verified_at,
    expires_at,
    tournament_id: args.tournament_id ?? null,
    participants: [
      ...a.map((pid) => ({
        player_id: pid,
        team: "A" as const,
        pre_r: pre[pid],
        post_r: pre[pid] + deltas[pid],
        delta_r: deltas[pid],
        pre_display: pre[pid],
        post_display: pre[pid] + deltas[pid],
        delta_display: deltas[pid],
      })),
      ...b.map((pid) => ({
        player_id: pid,
        team: "B" as const,
        pre_r: pre[pid],
        post_r: pre[pid] + deltas[pid],
        delta_r: deltas[pid],
        pre_display: pre[pid],
        post_display: pre[pid] + deltas[pid],
        delta_display: deltas[pid],
      })),
    ],
  };
}

/*
 * Match history for player 1 (ME). Spans:
 *  - recent verified singles wins/losses (varied deltas)
 *  - a pending match awaiting opponent approval (drives Inbox state)
 *  - a tournament-tagged match (drives tournament cross-link in profile)
 */
export const MATCHES: CategoryMatch[] = [
  match(101, "mens_singles", {
    played_at: "2026-05-20",
    a: [1],
    b: [2],
    scoreA: 21,
    scoreB: 15,
    pre: { 1: 4.172, 2: 3.853 },
    deltas: { 1: 0.041, 2: -0.041 },
  }),
  match(102, "mens_singles", {
    played_at: "2026-05-18",
    a: [1],
    b: [5],
    scoreA: 18,
    scoreB: 21,
    pre: { 1: 4.198, 5: 5.961 },
    deltas: { 1: -0.026, 5: 0.026 },
  }),
  match(103, "mens_doubles", {
    played_at: "2026-05-15",
    a: [1, 5],
    b: [2, 6],
    scoreA: 21,
    scoreB: 19,
    pre: { 1: 4.494, 5: 6.084, 2: 3.991, 6: 4.502 },
    deltas: { 1: 0.018, 5: 0.018, 2: -0.019, 6: -0.019 },
  }),
  match(104, "mixed_doubles", {
    played_at: "2026-05-12",
    a: [1, 3],
    b: [5, 4],
    scoreA: 19,
    scoreB: 21,
    pre: { 1: 3.945, 3: 4.451, 5: 5.953, 4: 3.180 },
    deltas: { 1: -0.035, 3: -0.035, 5: 0.022, 4: 0.022 },
  }),
  // Pending — awaiting opponent approval. Drives Inbox + match detail banner.
  match(105, "mens_singles", {
    played_at: "2026-05-22",
    a: [1],
    b: [5],
    scoreA: 21,
    scoreB: 12,
    pre: { 1: 4.213, 5: 5.987 },
    deltas: { 1: 0, 5: 0 }, // no delta until verified
    status: "pending",
  }),
  // Tournament round 1
  match(201, "mens_singles", {
    played_at: "2026-05-04",
    a: [1],
    b: [4],
    scoreA: 21,
    scoreB: 8,
    pre: { 1: 4.150, 4: 3.220 },
    deltas: { 1: 0.011, 4: -0.011 },
    tournament_id: 901,
  }),
];

export function matchesForPlayer(playerId: number): CategoryMatch[] {
  return MATCHES.filter((m) =>
    m.participants.some((p) => p.player_id === playerId),
  );
}

export function pendingForUser(clerkUserId: string): CategoryMatch[] {
  // In the real API, "pending for me" = matches I'm in AND I haven't acted on.
  // For fixtures, we treat user_demo_andrew (player 1) as the inbox owner.
  if (clerkUserId !== "user_demo_andrew") return [];
  return MATCHES.filter(
    (m) => m.status === "pending" && m.participants.some((p) => p.player_id === 1),
  );
}

export function findMatch(id: number): CategoryMatch | undefined {
  return MATCHES.find((m) => m.id === id);
}
