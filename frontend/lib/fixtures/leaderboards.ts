import type { Leaderboard, RatingCategory } from "../api/types";
import { ALL_PLAYERS } from "./players";

/*
 * Mock leaderboard: derive entries from the players fixture so any new
 * player is automatically rankable. Real backend returns rank+entries per
 * category; this mirrors that.
 */
export function leaderboardFor(
  category: RatingCategory,
  opts: { limit?: number; offset?: number; hideProvisional?: boolean } = {},
): Leaderboard {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const entries = ALL_PLAYERS.flatMap((p) =>
    p.ratings
      .filter((r) => r.category === category)
      .filter((r) => r.match_count > 0) // skip players who never played this category
      .filter((r) => !opts.hideProvisional || !r.calibrating)
      .map((r) => ({ player: p, r })),
  )
    .sort((a, b) => b.r.display - a.r.display)
    .map(({ player, r }, idx) => ({
      rank: offset + idx + 1,
      player_id: player.id,
      name: player.display_name ?? player.name,
      display: r.display,
      tier: r.tier,
      rd: r.rd,
      calibrating: r.calibrating,
      ceiling: r.ceiling,
      match_count: r.match_count,
    }));

  return {
    category,
    total: entries.length,
    limit,
    offset,
    entries: entries.slice(offset, offset + limit),
  };
}
