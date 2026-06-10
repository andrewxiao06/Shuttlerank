import type { Tournament } from "../api/types";

export const TOURNAMENTS: Tournament[] = [
  {
    id: 901,
    name: "Edison Spring Open",
    format: "single_elim",
    category: "mens_singles",
    starts_at: "2026-05-04T09:00:00Z",
    ends_at: "2026-05-04T18:00:00Z",
    status: "completed",
    organizer_user_id: "user_demo_organizer",
    entries: [
      { id: 1, player_id: 1, seed: 2, withdrawn: false },
      { id: 2, player_id: 2, seed: 3, withdrawn: false },
      { id: 3, player_id: 4, seed: 4, withdrawn: false },
      { id: 4, player_id: 5, seed: 1, withdrawn: false },
    ],
  },
  {
    id: 902,
    name: "Princeton Club Round-Robin",
    format: "round_robin",
    category: "mixed_doubles",
    starts_at: "2026-06-08T10:00:00Z",
    ends_at: null,
    status: "open",
    organizer_user_id: "user_demo_organizer",
    entries: [
      { id: 5, player_id: 1, seed: null, withdrawn: false },
      { id: 6, player_id: 3, seed: null, withdrawn: false },
      { id: 7, player_id: 5, seed: null, withdrawn: false },
      { id: 8, player_id: 4, seed: null, withdrawn: false },
    ],
  },
];

export function findTournament(id: number): Tournament | undefined {
  return TOURNAMENTS.find((t) => t.id === id);
}
